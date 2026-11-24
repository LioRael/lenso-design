// Run after pnpm build. Requires the published lenso CLI and npm registry access.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "@babel/core";
import stylex from "@stylexjs/babel-plugin";
import { compile } from "@tailwindcss/node";
import solid from "@solidjs/vite-plugin";
import { build, preview } from "vite";
import { chromium } from "playwright-core";
import { createDesign } from "@lenso/design";
import { codeModules } from "@lenso/design/code";

const root = await realpath(await mkdtemp(join(tmpdir(), "design-code-")));
const repo = fileURLToPath(new URL("../", import.meta.url));
function command(cwd, args, expect = "complete") {
  const p = spawnSync("lenso", [...args, "--json"], { cwd, encoding: "utf8" });
  const r = JSON.parse(p.stdout || "{}");
  assert.equal(r.status, expect, JSON.stringify({ args, status: r.status, message: r.message, stderr: p.stderr }));
  if (expect === "complete") assert.equal(p.status, 0);
  return r;
}

async function release(cwd, version, token) {
  const design = await createDesign({
    tokens: { light: { type: "color", value: "#fff" }, dark: { type: "color", value: "#222" } },
    integrations: [codeModules({
      namespace: "demo", output: "author", reference: "v" + version, version, runtime: "node26", framework: "solid",
      components: [{ component: "examples/button/index.tsx", description: "Action button", dependencies: ["solid-js@2.0.3", "@solidjs/web@2.0.3"],
        recipe: { id: "button", base: { color: { ref: token } } } }],
    })],
  }, { cwd: repo });
  const result = await design.build();
  assert.deepEqual(result.diagnostics, []);
  for (const artifact of result.artifacts) {
    const path = join(cwd, artifact.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, artifact.content);
  }
}

const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const target of ["tailwind", "stylex", "css-modules"]) {
    const cwd = join(root, target);
    await release(cwd, "0.1.0", "light");
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "button-consumer", private: true, type: "module" }));
    const setup = { author_root: "author", target: "src", format: "lenso-modules-v1", native: { npm: { manifest: "package.json" } } };
    command(cwd, ["ext", "add", "github-release:LioRael/lenso-cli/code", "--id", "code", "--constraint", "=0.3.8",
      ...(process.env.DESIGN_CODE_TOKEN ? ["--token-env", "DESIGN_CODE_TOKEN"] : []), "--yes", "--input", JSON.stringify(setup)]);
    command(cwd, ["code", "config", "--language", "typescript", "--runtime", "node26", "--convention", "framework=solid", "styles=" + target, "--yes"]);
    const address = "@demo/button";
    assert.equal(command(cwd, ["code", "search", "button"]).outputs.search.results[0].id, address);
    command(cwd, ["code", "preview", address]);
    const receipt = join(cwd, "src/code.modules.json");
    await assert.rejects(readFile(receipt), { code: "ENOENT" });
    command(cwd, ["code", "add", address, "--yes"]);
    const deps = JSON.parse(await readFile(join(cwd, "package.json"))).dependencies;
    assert.equal(deps["solid-js"], "2.0.3");
    assert.equal(Object.hasOwn(deps, "@stylexjs/stylex"), target === "stylex");
    const folder = join(cwd, "src/generated/button");
    const file = join(folder, "modules/button/recipe.ts");
    const original = await readFile(file, "utf8");
    assert.equal(original, await readFile(join(cwd, "author/button", target, "recipe.ts"), "utf8"));
    const plugins = [solid()];
    let css = ":root { --ds-light: #fff; --ds-dark: #222; }";
    if (target === "stylex") {
      const compiled = transformSync(original, { filename: file, babelrc: false, configFile: false,
        plugins: [[stylex, { runtimeInjection: false }]] });
      css += stylex.processStylexRules(compiled.metadata.stylex);
      plugins.unshift({ name: "compile-installed-stylex", enforce: "pre", transform(_, path) {
        if (path === file) return compiled.code;
      } });
    } else if (target === "tailwind") {
      const compiler = await compile("@tailwind utilities;", { base: cwd, onDependency() {} });
      const { root } = await import("data:text/javascript," + encodeURIComponent(original));
      css += compiler.build(root.split(" "));
    }
    await writeFile(join(cwd, "theme.css"), css);
    await writeFile(join(cwd, "index.html"), '<main></main><script type="module" src="/main.tsx"></script>');
    await writeFile(join(cwd, "main.tsx"), [
      'import { render } from "@solidjs/web";', 'import "./theme.css";',
      'import { Button } from "./src/generated/button/assembly";',
      'render(() => <Button onClick={() => document.title = "clicked"}>Publish</Button>, document.querySelector("main"));',
    ].join("\n"));
    await build({ root: cwd, configFile: false, plugins, logLevel: "error" });
    const server = await preview({ root: cwd, configFile: false, preview: { port: 0, host: "127.0.0.1" } });
    try {
      const page = await browser.newPage();
      page.on("pageerror", error => console.error(error.message));
      await page.goto("http://127.0.0.1:" + server.httpServer.address().port);
      const button = page.getByRole("button", { name: "Publish" });
      assert.equal(await button.evaluate(el => getComputedStyle(el).color), "rgb(255, 255, 255)");
      await button.press("Enter");
      assert.equal(await page.title(), "clicked");
      await page.close();
    } finally {
      await server.close();
    }
    const changedFile = target === "css-modules" ? join(dirname(file), "recipe.module.css") : file;
    const old = await readFile(changedFile, "utf8");
    const local = target === "stylex" ? old + "// Local note\n" : old.replace("--ds-light", "--ds-local");
    await writeFile(changedFile, local);
    await release(cwd, "0.1.1", "dark");
    if (target === "stylex") {
      command(cwd, ["code", "update", address, "--yes"]);
      assert.equal(await readFile(changedFile, "utf8"), local.replace("--ds-light", "--ds-dark"));
    } else {
      const conflict = command(cwd, ["code", "update", address, "--yes"], "needs_input");
      assert.match(conflict.question.message, /recipe/);
      assert.equal(await readFile(changedFile, "utf8"), local);
      const keep = target === "tailwind";
      await writeFile(join(cwd, "answers.json"), JSON.stringify({ [conflict.question.id]: keep ? "keep" : "overwrite" }));
      command(cwd, ["code", "update", address, "--answers", "answers.json", "--yes"]);
      assert.equal(await readFile(changedFile, "utf8"), keep ? local : old.replace("--ds-light", "--ds-dark"));
    }
    const installed = JSON.parse(await readFile(receipt)).modules[address];
    assert.equal(installed.version, "0.1.1");
    assert.deepEqual(installed.when, { framework: "solid", styles: target });
    console.log(target, "installed, rendered, keyboard activated and upgraded");
  }
} finally {
  await browser.close();
  await rm(root, { recursive: true, force: true });
}
