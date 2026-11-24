import { Console } from "node:console";
import { readFileSync } from "node:fs";
import { runDesignCommand } from "./command.js";
import { hostCommands, switches } from "./host-commands.js";
import { DesignError, fail } from "./model.js";

async function execute() {
  const name = process.argv[2];
  const spec = Object.hasOwn(hostCommands, name) && hostCommands[name];
  const { abi_version, input, answers } = JSON.parse(readFileSync(0, "utf8"));
  if (!spec || abi_version !== 1 || !input || typeof input !== "object" || Array.isArray(input)) {
    fail("request.input", "Expected a Lenso ABI v1 command request.");
  }
  const args = [name, "--json"];
  const positional = spec.positional && input[spec.positional];
  if (spec.positional && (typeof positional !== "string" || !positional)) fail("request.input", "Missing " + spec.positional);
  for (const [key, value] of Object.entries(input)) {
    if (key === spec.positional) continue;
    if (!spec.options.includes(key)) fail("request.input", "Unknown option " + key);
    if (switches.has(key)) {
      if (typeof value !== "boolean") fail("request.input", "Expected boolean " + key);
      if (value) args.push("--" + key);
    } else {
      const values = key === "context" && Array.isArray(value) ? value : [value];
      for (const text of values) {
        if (typeof text !== "string") fail("request.input", "Expected text for " + key);
        args.push(key === "appearance" ? "--context=appearance=" + text : "--" + key + "=" + text);
      }
    }
  }
  if (positional) args.push("--", positional);
  if (name === "install") {
    const { installFromHost } = await import("./host-install.js");
    return installFromHost(positional, input.from, input.target, input["dry-run"], input.diff, answers ?? {});
  }
  let output: unknown;
  await runDesignCommand(args, value => { output = value; });
  if (process.exitCode) {
    process.exitCode = 0;
    return { status: "failed", code: "design.invalid", details: { result: output } };
  }
  return { status: "complete", output };
}

globalThis.console = new Console(process.stderr);
try {
  process.stdout.write(JSON.stringify(await execute()));
} catch (error) {
  const diagnostic = error instanceof DesignError ? error.diagnostic : {
    code: "design.error", message: error instanceof Error ? error.message : String(error),
  };
  process.stdout.write(JSON.stringify({ status: "failed", code: diagnostic.code, details: { message: diagnostic.message } }));
}
