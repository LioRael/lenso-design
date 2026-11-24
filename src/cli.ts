#!/usr/bin/env node
import { Console } from "node:console";
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { runDesignContract } from "./contract.js";
import { loadDesign, projectPath } from "./index.js";
import { DesignError, fail } from "./model.js";
import type { Artifact, Context } from "./model.js";

const help = `Usage: lenso-design <command> [options]

Commands:
  init            Create a starter design.config.ts
  check           Validate tokens, mappings, and output generation
  build           Validate and write generated artifacts
  inspect         Show contexts, profiles, components, and mappings
  tokens          List resolved tokens
  capabilities    List declared design capabilities
  resolve <id>    Resolve one token
  query <task>    Search project design knowledge
  diff <config>   Compare resolved tokens with another config

Options:
  --config <path>      Project config (design.json for contract commands, otherwise design.config.ts)
  --context <k=v>      Select a context dimension (repeatable)
  --json               Emit structured JSON
  --overwrite          Allow build to replace changed artifacts
  --dry-run            Show the build artifacts without writing
  --help, -h           Show usage`;

const starter = `import { defineDesign } from "@lenso/design";
import { css } from "@lenso/design/css";
import { neutral } from "@lenso/design/presets";

export default defineDesign({
  presets: [neutral()],
  integrations: [css({ themes: [{ selector: '[data-theme="dark"]', context: { appearance: "dark" } }] })],
});
`;

const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

async function fileContents(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile()) fail("file.type", `Expected a regular file at "${path}".`, path);
    return await readFile(path, "utf8");
  } catch (error) {
    if (!missing(error)) throw error;
    return undefined;
  }
}

async function writeArtifacts(root: string, artifacts: readonly Artifact[], overwrite: boolean) {
  const pending: { target: string; content: string; existing?: string }[] = [];
  for (const { path, content } of artifacts) {
    const target = projectPath(root, path);
    let parent = root;
    for (const segment of relative(root, dirname(target)).split(sep).filter(Boolean)) {
      parent = join(parent, segment);
      try {
        if (!(await lstat(parent)).isDirectory()) fail("file.type", `Expected a directory at "${parent}".`, path);
      } catch (error) {
        if (!missing(error)) throw error;
        break;
      }
    }
    const existing = await fileContents(target);
    if (existing === content) continue;
    if (existing !== undefined && !overwrite) {
      fail("file.exists", `"${path}" already exists with different content. Use --overwrite to replace it.`, path);
    }
    pending.push({ target, content, existing });
  }

  for (const { target, content, existing } of pending) {
    const parent = dirname(target);
    await mkdir(parent, { recursive: true });
    if (await realpath(parent) !== parent) fail("file.type", `Output directory changed: "${parent}".`, parent);
    const temporary = join(parent, `.lenso-design-${randomUUID()}.tmp`);
    await writeFile(temporary, content, { flag: "wx" });
    try {
      if (existing === undefined) {
        await link(temporary, target);
      } else {
        if (await fileContents(target) !== existing) fail("file.changed", `"${target}" changed during build.`, target);
        await rename(temporary, target);
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

function selectedContext(values: readonly string[]): Context {
  const dimensions = new Map<string, string>();
  for (const entry of values) {
    const index = entry.indexOf("=");
    const key = entry.slice(0, index);
    if (index < 1 || index === entry.length - 1 || dimensions.has(key)) {
      fail("cli.context", `Expected a unique --context key=value, received "${entry}".`);
    }
    dimensions.set(key, entry.slice(index + 1));
  }
  return Object.fromEntries(dimensions);
}

async function run(args: string[]) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: {
      config: { type: "string" },
      context: { type: "string", multiple: true, default: [] },
      json: { type: "boolean" },
      overwrite: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, argument, extra] = positionals;
  if (values.help || !command || command === "help") {
    console.log(help);
    return;
  }
  if (values.json) globalThis.console = new Console(process.stderr);
  const print = (value: unknown) => process.stdout.write(JSON.stringify(value, null, values.json ? undefined : 2) + "\n");
  const withArgument = ["resolve", "query", "diff"].includes(command);
  const commands = ["init", "check", "build", "inspect", "tokens", "capabilities", "resolve", "query", "diff"];
  if (!commands.includes(command) || extra !== undefined || withArgument !== (argument !== undefined)) {
    fail("cli.command", "Invalid command or arguments. Run lenso-design --help.");
  }

  if ((values.overwrite || values["dry-run"]) && command !== "build") {
    fail("cli.options", "--overwrite and --dry-run apply to build.");
  }
  if (values.context.length && !["tokens", "resolve", "query", "diff"].includes(command)) {
    fail("cli.options", "--context applies to tokens, resolve, query, and diff.");
  }
  if (command === "init") {
    const path = resolve(values.config ?? "design.config.ts");
    await writeArtifacts(await realpath(dirname(path)), [{ path: path.split(sep).at(-1)!, content: starter }], false);
    print({ path });
    return;
  }

  const context = selectedContext(values.context);
  if (command === "inspect" || command === "resolve" || command === "query" || command === "check") {
    if (values.config === undefined || values.config.endsWith(".json")) {
      const config = await fileContents(values.config ?? "design.json");
      if (config !== undefined || values.config !== undefined) {
        const input = command === "resolve" ? { id: argument, context }
          : command === "query" ? { task: argument, context } : {};
        const result = await runDesignContract(config ?? null, command, input);
        if (!result.ok) process.exitCode = 1;
        print(result);
        return;
      }
    }
  }
  const design = await loadDesign(values.config);
  switch (command) {
    case "inspect":
      print(design.inspect());
      break;
    case "capabilities":
      print(design.capabilities);
      break;
    case "tokens":
      print(design.tokens.resolveAll(context));
      break;
    case "resolve":
      print(design.tokens.resolve(argument, context));
      break;
    case "query": {
      const result = await design.query(argument, context);
      if (result.diagnostics.some(({ severity }) => severity === "error")) process.exitCode = 1;
      print(result);
      break;
    }
    case "diff":
      print(design.diff(await loadDesign(argument), context));
      break;
    case "check": {
      const result = await design.check();
      if (!result.ok) process.exitCode = 1;
      print(result);
      break;
    }
    case "build": {
      const { ok, artifacts, diagnostics } = await design.build();
      if (!ok) process.exitCode = 1;
      if (ok && !values["dry-run"]) {
        await writeArtifacts(design.root, artifacts, values.overwrite ?? false);
      }
      print({ ok, diagnostics, artifacts: artifacts.map(({ path }) => path) });
      break;
    }
  }
}

try {
  await run(process.argv.slice(2));
} catch (error) {
  const diagnostic = error instanceof DesignError ? error.diagnostic : {
    code: "cli.error", severity: "error", message: error instanceof Error ? error.message : String(error),
  };
  const args = process.argv.slice(2);
  if (args.includes("--json") || args.includes("--json=true")) {
    process.stdout.write(JSON.stringify({ ok: false, diagnostics: [diagnostic] }) + "\n");
  } else {
    console.error(`${diagnostic.code}: ${diagnostic.message}`);
  }
  process.exitCode = 1;
}
