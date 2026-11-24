import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformSync } from "@babel/core";
import stylexPlugin from "@stylexjs/babel-plugin";
import { compile } from "@tailwindcss/node";
import { color, createDesign, defineIntegration, dimension, token } from "@lenso/design";
import { css, cssSource } from "@lenso/design/css";
import { dtcg, parseDtcg } from "@lenso/design/dtcg";
import { shadcn } from "@lenso/design/shadcn";
import example from "../design.config.ts";

const dark = { appearance: "dark" };

test("resolves contexts, aliases, provenance, and design knowledge", async () => {
  const design = await createDesign(example);
  const radius = design.tokens.resolve("control.radius", { ...dark, density: "compact" });
  assert.equal(radius.source, "project");
  assert.deepEqual(radius.path, ["control.radius", "radius.medium"]);
  assert.equal(design.tokens.resolve("motion.fast", { ...dark, motion: "reduced" }).value, "0ms");
  assert.deepEqual(design.tokens.resolve("brand.accent-hover").path, ["brand.accent-hover", "brand.accent"]);
  assert.throws(() => design.tokens.resolve("control.radius", { appearance: "sepia" }), { name: "DesignError" });

  const result = await design.query("primary action", dark);
  assert.equal(result.components[0].import, "@/components/ui/acme-button");
  assert.equal(result.patterns[0].id, "primary-action");
  assert.equal(result.tokens.find(({ id }) => id === "action.primary.background").value, "#f4f4f5");
  assert.ok(result.usages.some(({ reference }) => reference === "bg-primary"));
  assert.ok(result.usages.some(({ reference }) => reference === "var(--ds-control-radius)"));
});

test("reports cyclic and mistyped references in contextual overlays", async () => {
  const design = await createDesign({
    dimensions: { appearance: { default: "light", values: ["light", "dark"] } },
    tokens: { a: color("#fff"), b: color(token("a")), c: dimension(token("a")) },
    variants: [{ when: dark, tokens: { a: color(token("b")) } }],
    integrations: [css()],
  });
  const { artifacts, diagnostics } = await design.build();
  assert.deepEqual(artifacts, []);
  assert.ok(diagnostics.some(d => d.code === "token.cycle" && d.context.appearance === "dark"));
  assert.ok(diagnostics.some(d => d.code === "token.alias-type" && d.path === "c"));
  await assert.rejects(createDesign({ tokens: { invalid: color("banana") } }), { name: "DesignError" });
});

test("rejects ambiguous overlays and resolves explicit combined variants", async () => {
  const dimensions = {
    appearance: { default: "light", values: ["light", "dark"] },
    density: { default: "comfortable", values: ["comfortable", "compact"] },
  };
  const compact = { density: "compact" };
  const ambiguous = [
    { when: dark, tokens: { value: dimension("2px") } },
    { when: compact, tokens: { value: dimension("3px") } },
  ];
  await assert.rejects(
    createDesign({ dimensions, tokens: { value: dimension("1px") }, variants: ambiguous }),
    error => error.diagnostic?.code === "context.conflict",
  );
  const design = await createDesign({
    dimensions, tokens: { value: dimension("1px") },
    variants: [ambiguous[0], { when: { ...dark, ...compact }, tokens: { value: dimension("4px") } }],
  });
  assert.equal(design.tokens.resolve("value", dark).value, "2px");
  assert.equal(design.tokens.resolve("value", { ...dark, ...compact }).value, "4px");
});

test("round-trips the supported DTCG subset with inherited and inferred types", async () => {
  const value = { colorSpace: "display-p3", components: [0.2, 0.3, 0.4], alpha: 0.8 };
  const tokens = parseDtcg({
    color: {
      $type: "color",
      $root: { $value: value, $extensions: { "dev.lenso.test": { source: "fixture" } } },
      accent: { $value: "{color.$root}" },
    },
  });
  const design = await createDesign({ tokens, integrations: [dtcg.output()] });
  assert.equal(design.tokens.resolve("color.accent").value, "color(display-p3 0.2 0.3 0.4 / 0.8)");
  const result = await design.build();
  assert.deepEqual(result.diagnostics, []);
  const tree = JSON.parse(result.artifacts[0].content);
  assert.deepEqual(tree.color.$root.$value, value);
  assert.deepEqual(tree.color.$root.$extensions, { "dev.lenso.test": { source: "fixture" } });
  assert.equal(tree.color.accent.$value, "{color.$root}");
  assert.deepEqual(parseDtcg(tree), tokens);
  assert.throws(() => parseDtcg({ group: { $extends: "{other}" } }), { name: "DesignError" });
});

test("reads existing CSS variables without requiring a preset", async t => {
  const cwd = await mkdtemp(join(tmpdir(), "lenso-design-css-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "theme.css"), ":root { --primary: #fff; --accent: var(--primary); }\n.dark { --primary: #111; }");
  const design = await createDesign({
    dimensions: { appearance: { default: "light", values: ["light", "dark"] } },
    sources: [cssSource("theme.css", {
      themes: [{ selector: ".dark", context: dark }], types: { primary: "color", accent: "color" },
    })],
  }, { cwd });
  assert.equal(design.tokens.resolve("accent", dark).value, "#111");
});

test("detects missing role and material; distinguishes explicit fallbacks", async () => {
  const design = await createDesign(example);
  const fallback = design.compatibility.check({
    requirements: [{ role: "button.secondary", type: "color", fallback: "text.secondary" }],
    mapping: "neutral", contexts: [{}, dark],
  });
  assert.equal(fallback.status, "compatible-with-fallback");
  assert.equal(fallback.bindings["button.secondary"], "text.secondary");
  const unsupported = design.compatibility.check({
    requirements: [{ role: "button.brand", type: "duration" }],
    mapping: "neutral", capabilities: [{ id: "material.refracting" }],
  });
  assert.equal(unsupported.status, "unsupported");
  assert.deepEqual(unsupported.diagnostics.map(d => d.code), ["mapping.unsatisfied", "capability.missing"]);
});

test("a Registry target needs stylesheet evidence for its semantic bindings", async () => {
  const requirements = [{ role: "primary", type: "color", variable: "--acme-primary" }];
  const registry = shadcn({
    items: [{
      item: { name: "button", type: "registry:ui", files: [{ path: "button.tsx", content: "<button />" }] },
      selector: ".acme-button", requirements,
    }],
    targets: [{ id: "consumer", stylesheets: [{ artifact: "theme.css" }] }],
  });
  const make = content => createDesign({
    tokens: { primary: color("#fff") },
    integrations: [registry, defineIntegration({
      name: "theme",
      generate(ctx) {
        if (content !== undefined) ctx.emit({ path: "theme.css", content });
      },
    })],
  });

  const unresolved = await make(":root { --ds-primary: var(--missing); }");
  assert.equal(unresolved.compatibility.check({ requirements }).status, "compatible");
  const unavailable = await unresolved.build();
  assert.equal(unavailable.ok, false);
  assert.deepEqual(unavailable.artifacts, []);
  assert.equal(unavailable.diagnostics[0].code, "shadcn.target-variable");
  assert.equal((await (await make()).check()).diagnostics[0].code, "shadcn.stylesheet");
  assert.equal((await (await make(":root { --ds-primary: var(--brand); --brand: #fff; }")).build()).ok, true);
});

test("rejects output collisions and malformed CSS values", async () => {
  const conflicting = await createDesign({ integrations: [css(), css()] });
  assert.equal((await conflicting.build()).diagnostics[0].code, "artifact.conflict");
  const invalid = await createDesign({
    tokens: { "unsafe.value": { type: "string", value: "red; display: block" } }, integrations: [css()],
  });
  assert.equal((await invalid.build()).diagnostics[0].code, "css.value");
  const escape = await createDesign({
    integrations: [defineIntegration({ name: "bad", generate: ctx => ctx.emit({ path: "../outside", content: "" }) })],
  });
  assert.equal((await escape.build()).diagnostics[0].code, "file.path");
});

test("generates native Tailwind and StyleX output and preserves Registry source", async t => {
  const design = await createDesign(example);
  const { artifacts, diagnostics } = await design.build();
  assert.deepEqual(diagnostics, []);
  const byPath = suffix => artifacts.find(({ path }) => path.endsWith(suffix));
  const tokens = byPath("/tokens.css");
  assert.match(tokens.content, /\[data-theme="dark"\][\s\S]*--ds-action-primary-background: #f4f4f5/);
  const tailwind = await compile(`${tokens.content}\n${byPath("/tailwind.css").content}\n@tailwind utilities;`, { base: process.cwd(), onDependency() {} });
  const built = tailwind.build(["bg-primary", "rounded-control"]);
  assert.match(built, /background-color: var\(--ds-action-primary-background\)/);
  assert.match(built, /border-radius: var\(--ds-control-radius\)/);

  const cwd = await mkdtemp(join(tmpdir(), "lenso-design-stylex-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const stylexNames = ["tokens.stylex.ts", "dark.stylex.ts"];
  await mkdir(join(cwd, "generated"));
  await Promise.all(stylexNames.map(name => writeFile(join(cwd, "generated", name), byPath("/" + name).content)));
  function transformStylex(name, content) {
    return transformSync(content, {
      filename: join(cwd, "generated", name),
      babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript"] },
      plugins: [[stylexPlugin, { unstable_moduleResolution: { type: "commonJS" }, runtimeInjection: false }]],
    });
  }
  const compiled = stylexNames.map(name => transformStylex(name, byPath("/" + name).content));
  compiled.push(transformStylex("consumer.ts", `
    import * as stylex from "@stylexjs/stylex";
    import { tokens } from "./tokens.stylex";
    export const styles = stylex.create({
      button: { backgroundColor: tokens["action-primary-background"] },
    });
  `));
  assert.ok(compiled.every(result => result.metadata.stylex.length > 0));
  const stylexCss = stylexPlugin.processStylexRules(compiled.flatMap(result => result.metadata.stylex));
  assert.match(stylexCss, /#27272a/);
  assert.match(stylexCss, /#f4f4f5/);
  assert.match(stylexCss, /background-color:\s*var\(--/);

  const registry = JSON.parse(byPath("/neutral/acme-button.json").content);
  assert.equal(registry.files[0].content, await readFile(new URL("../examples/acme-button.tsx", import.meta.url), "utf8"));
  assert.deepEqual(registry.css[".acme-button"], {
    "--acme-brand": "var(--ds-action-primary-background)",
    "--acme-on-brand": "var(--ds-action-primary-foreground)",
    "--acme-radius": "var(--ds-control-radius)",
  });
  const brand = JSON.parse(byPath("/brand/acme-button.json").content);
  assert.equal(brand.files[0].content, registry.files[0].content);
  assert.equal(brand.css[".acme-button"]["--acme-brand"], "var(--primary)");
});

test("CLI dry runs and refuses to overwrite changed files by default", async t => {
  const cwd = await mkdtemp(join(tmpdir(), "lenso-design-cli-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const config = new URL("../dist/css.js", import.meta.url).href;
  await writeFile(join(cwd, "design.config.ts"), `
    import { css } from ${JSON.stringify(config)};
    export default { tokens: { primary: { type: "color", value: "#000" } }, integrations: [css()] };
  `);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, "--json"], { cwd, encoding: "utf8" });
  const destination = join(cwd, "generated/tokens.css");
  assert.equal(run("build", "--dry-run").status, 0);
  await assert.rejects(readFile(destination, "utf8"), { code: "ENOENT" });
  assert.equal(run("build").status, 0);
  await writeFile(destination, "existing");
  const conflict = run("build");
  assert.equal(conflict.status, 1);
  assert.equal(JSON.parse(conflict.stdout).diagnostics[0].code, "file.exists");
  assert.equal(await readFile(destination, "utf8"), "existing");
  assert.equal(run("build", "--overwrite").status, 0);
  assert.match(await readFile(destination, "utf8"), /--ds-primary: #000/);
});

test("the library and CLI resolve current TypeScript configuration with the same provenance", async t => {
  const cwd = await mkdtemp(join(tmpdir(), "lenso-design-resolve-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const project = join(cwd, "project");
  await mkdir(project);
  await writeFile(join(project, "package.json"), '{"type":"module"}');
  const config = join(project, "design.config.ts");
  const css = join(project, "theme.css");
  const api = new URL("../dist/index.js", import.meta.url).href;
  const cssModule = new URL("../dist/css.js", import.meta.url).href;
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

  const writeConfig = id => writeFile(config, `
    import { color, defineDesign, token } from ${JSON.stringify(api)};
    import { cssSource } from ${JSON.stringify(cssModule)};
    console.log("Loading design configuration");
    export default defineDesign({
      dimensions: { appearance: { default: "light", values: ["light", "dark"] } },
      sources: [cssSource("theme.css", {
        types: { primary: "color", accent: "color" },
        themes: [{ selector: ".dark", context: { appearance: "dark" } }],
      })],
      tokens: { "action.primary": color(token(${JSON.stringify(id)})) },
    });
  `);
  await writeFile(css, ":root { --primary: #111; --accent: #222; } .dark { --primary: #eee; --accent: #ace; }");

  for (const [id, color] of [["primary", "#eee"], ["accent", "#ace"]]) {
    await writeConfig(id);
    const options = { cwd, encoding: "utf8" };
    const result = spawnSync(process.execPath, [
      cli, "resolve", "action.primary", "--config", config, "--context", "appearance=dark", "--json",
    ], options);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Loading design configuration/);

    const library = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { loadDesign } from ${JSON.stringify(api)};
      const design = await loadDesign(process.argv[1]);
      console.log(JSON.stringify(design.tokens.resolve("action.primary", { appearance: "dark" })));
    `, config], options);
    assert.equal(library.status, 0, library.stderr);
    const resolved = JSON.parse(result.stdout);
    assert.deepEqual(resolved, JSON.parse(library.stdout.trim().split("\n").at(-1)));
    assert.deepEqual(resolved, {
      type: "color", id: "action.primary", value: color,
      source: "project", valueSource: "source:theme.css", path: ["action.primary", id],
    });
  }

  const invalid = spawnSync(process.execPath, [
    cli, "resolve", "action.primary", "--config", config, "--context", "appearance=unknown", "--json",
  ], { cwd, encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stdout).diagnostics[0].code, "context.unknown");

});

test("the standalone CLI uses the same live declarative kernel as the Wasm extension", async t => {
  const cwd = await mkdtemp(join(tmpdir(), "lenso-design-contract-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const file = join(cwd, "design.json");
  const config = JSON.parse(await readFile(new URL("../design.json", import.meta.url), "utf8"));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, "--json"], { cwd, encoding: "utf8" });
  for (const color of ["#eee", "#ace"]) {
    config.variants[0].tokens["brand.ink"].value = color;
    await writeFile(file, JSON.stringify(config));
    const response = run("resolve", "action.primary.background", "--context", "appearance=dark");
    assert.equal(response.status, 0, response.stderr);
    assert.deepEqual(JSON.parse(response.stdout), {
      ok: true, id: "action.primary.background", type: "color", value: color,
      path: ["action.primary.background", "brand.ink"], source: "design.json", valueSource: "design.json",
    });
  }
  assert.equal(JSON.parse(run("check").stdout).checkedContexts, 2);
  const query = JSON.parse(run("query", "primary action").stdout);
  assert.equal(query.components[0].id, "acme-button");
  assert.deepEqual(query.missing, ["usages"]);
  const invalid = run("resolve", "unavailable");
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stdout).diagnostics[0].code, "token.missing");
});
