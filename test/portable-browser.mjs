import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { transformSync } from "@babel/core";
import stylexPlugin from "@stylexjs/babel-plugin";
import { compile } from "@tailwindcss/node";
import solid from "@solidjs/vite-plugin";
import { build, preview } from "vite";
import { chromium } from "playwright-core";
import { createDesign } from "@lenso/design";
import example from "../design.config.ts";

const root = await mkdtemp(join(tmpdir(), "lenso-design-browser-"));
let browser, server;
try {
  await symlink(fileURLToPath(new URL("../node_modules", import.meta.url)), join(root, "node_modules"));
  const design = await createDesign(example);
  const { artifacts, diagnostics } = await design.build();
  assert.deepEqual(diagnostics, []);
  const file = suffix => artifacts.find(entry => entry.path.endsWith(suffix)).content;
  const targets = ["css-modules", "tailwind", "stylex"];
  let stylesheet = file("/tokens.css");
  async function prepare(target, id) {
    const folder = join(root, target, id);
    await mkdir(folder, { recursive: true });
    const item = JSON.parse(file(`/${target}/${id}/registry.json`));
    const path = name => item.files.find(entry => entry.target === `src/components/${id}/${name}`).content;
    await writeFile(join(folder, "index.tsx"), path("index.tsx"));
    let recipe = path("recipe.ts");
    if (target === "css-modules") await writeFile(join(folder, "recipe.module.css"), path("recipe.module.css"));
    if (target === "stylex") {
      const result = transformSync(recipe, {
        filename: join(folder, "recipe.ts"), configFile: false, babelrc: false,
        plugins: [[stylexPlugin, { runtimeInjection: false }]],
      });
      stylesheet += stylexPlugin.processStylexRules(result.metadata.stylex);
      recipe = result.code;
    }
    if (target === "tailwind") {
      const compiler = await compile("@tailwind utilities;", { base: root, onDependency() {} });
      const { root: classes, parts = {} } = await import("data:text/javascript," + encodeURIComponent(recipe));
      stylesheet += compiler.build([classes, ...Object.values(parts)].join(" ").split(" "));
    }
    await writeFile(join(folder, "recipe.ts"), recipe);
  }
  for (const target of targets) {
    await prepare(target, "bold-toggle");
    await prepare(target, "details-dialog");
  }
  // Reuse the component and usage returned by the same declarative query available to agents.
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const task = "project details";
  const query = JSON.parse(execFileSync(process.execPath, [cli, "query", task, "--json"], { encoding: "utf8" }));
  assert.deepEqual(query.components.map(c => c.id), ["details-dialog"]);
  const [component] = query.components;
  assert.deepEqual(query.usages.map(u => u.component), [component.id]);
  const [usage] = query.usages;
  const pageSource = await readFile(usage.path, "utf8");
  assert.ok(pageSource.includes(usage.reference));
  assert.ok(pageSource.includes(`import { ${component.export} } from "${component.import}"`));
  await mkdir(join(root, "components"));
  await symlink(join(root, "css-modules", component.id), join(root, "components", component.id));
  await writeFile(join(root, "project-details.tsx"), pageSource);
  await writeFile(join(root, "agent.html"), '<main data-theme="dark"><div id="app"></div><div id="portal"></div></main><script type="module" src="/agent.tsx"></script>');
  await writeFile(join(root, "agent.tsx"), [
    'import { render } from "@solidjs/web";', 'import "./theme.css";',
    'import { ProjectDetails } from "./project-details";',
    'render(() => <ProjectDetails portal={document.querySelector("#portal")}/>, document.querySelector("#app"));',
  ].join("\n"));
  await writeFile(join(root, "theme.css"), stylesheet);
  await writeFile(join(root, "index.html"), '<section data-theme="dark"><div id="app"></div><div id="portal"></div></section><script type="module" src="/main.tsx"></script>');
  const imports = targets.flatMap((target, index) => [
    `import { BoldToggle as Toggle${index} } from "./${target}/bold-toggle";`,
    `import { DetailsDialog as Dialog${index} } from "./${target}/details-dialog";`,
  ]);
  await writeFile(join(root, "main.tsx"), [
    'import { render } from "@solidjs/web";', 'import "./theme.css";', ...imports,
    'import { checkRenderedTheme } from "@lenso/design/rendered-theme";',
    `window.auditPanel = () => checkRenderedTheme(document.querySelector("section"), document.querySelector('[role="dialog"], dialog'), ["--ds-surface-canvas"]);`,
    `render(() => <><Toggle0/><Toggle1/><Toggle2/>${targets.map((_, i) => `<Dialog${i} container={document.querySelector("#portal")}/>`).join("")}</>, document.querySelector("#app"));`,
  ].join("\n"));
  await build({ root, configFile: false, resolve: { alias: { "@lenso/design/rendered-theme": fileURLToPath(new URL("../dist/rendered-theme.js", import.meta.url)) } }, plugins: [solid()], build: { rollupOptions: { input: [join(root, "index.html"), join(root, "agent.html")] } }, logLevel: "warn" });
  server = await preview({ root, configFile: false, preview: { host: "127.0.0.1", port: 0 } });
  browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || "chrome" });
  const page = await browser.newPage();
  page.setDefaultTimeout(6000);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  const buttons = page.getByRole("button", { name: "Bold" });
  await buttons.first().waitFor();
  assert.equal(await buttons.count(), 3);
  for (const [theme, background] of [["light", "rgb(255, 255, 255)"], ["dark", "rgb(17, 17, 19)"]]) {
    await page.locator("section").evaluate((html, value) => html.dataset.theme = value, theme);
    for (const button of await buttons.all()) {
      assert.deepEqual(await button.evaluate(element => {
        const style = getComputedStyle(element);
        return [style.backgroundColor, style.borderRadius];
      }), [background, "8px"]);
    }
  }
  for (const button of await buttons.all()) {
    await button.focus();
    await button.press("Space");
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    await button.press("Enter");
    assert.equal(await button.getAttribute("aria-pressed"), "false");
  }
  const triggers = page.getByRole("button", { name: "Show details" });
  assert.equal(await triggers.count(), targets.length);
  for (const trigger of await triggers.all()) {
    await trigger.focus();
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Project details" });
    await dialog.waitFor();
    assert.equal(await dialog.evaluate(el => document.querySelector("#portal").contains(el)), true);
    const close = dialog.getByRole("button", { name: "Close details" });
    await page.waitForFunction(el => el === document.activeElement, await close.elementHandle());
    for (const [theme, panel, action] of [
      ["dark", "rgb(17, 17, 19)", "rgb(244, 244, 245)"],
      ["light", "rgb(255, 255, 255)", "rgb(39, 39, 42)"],
    ]) {
      await page.locator("section").evaluate((el, theme) => el.dataset.theme = theme, theme);
      assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), panel);
      assert.equal(await close.evaluate(el => getComputedStyle(el).backgroundColor), action);
    }
    // Semantic compatibility alone cannot see where the application mounted its portal.
    assert.equal(design.compatibility.check({ requirements: [{ role: "surface.canvas", type: "color" }] }).status, "compatible");
    await page.locator("section").evaluate(scope => scope.dataset.theme = "dark");
    assert.deepEqual(await page.evaluate(() => window.auditPanel()), []);
    await close.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.locator("#portal").evaluate(portal => document.body.append(portal));
    await trigger.press("Enter");
    await dialog.waitFor();
    assert.deepEqual((await page.evaluate(() => window.auditPanel())).map(d => d.code),
      ["theme.portal-scope", "theme.variable-mismatch"]);
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
    await close.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.locator("#portal").evaluate(portal => document.querySelector("section").append(portal));
    await trigger.press("Enter");
    await dialog.waitFor();
    await dialog.evaluate(el => el.style.setProperty("--ds-surface-canvas", "#ff0000"));
    assert.deepEqual((await page.evaluate(() => window.auditPanel())).map(d => d.code), ["theme.variable-mismatch"]);
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 0, 0)");
    await dialog.evaluate(el => el.style.setProperty("--ds-surface-canvas", "initial"));
    assert.deepEqual((await page.evaluate(() => window.auditPanel())).map(d => [d.code, d.path]),
      [["theme.variable-missing", "--ds-surface-canvas"]]);
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
    await dialog.evaluate(el => el.style.removeProperty("--ds-surface-canvas"));
    assert.deepEqual(await page.evaluate(() => window.auditPanel()), []);
    await close.focus();
    await close.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(el => el === document.activeElement, await trigger.elementHandle());
    await trigger.press("Enter");
    await close.waitFor();
    await close.press("Enter");
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(el => el === document.activeElement, await trigger.elementHandle());
  }
  await page.goto(new URL("agent.html", page.url()).href);
  const opener = page.getByRole("button", { name: "Show details" });
  await opener.focus();
  await opener.press("Enter");
  const reused = page.getByRole("dialog", { name: "Project details" });
  await reused.waitFor();
  assert.equal(await reused.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(17, 17, 19)");
  // A CSS blur is an observable material capability. Glass fidelity needs a separate visual benchmark.
  const blur = "material.backdrop-blur";
  const request = { requirements: [], capabilities: [{ id: blur }] };
  const unsupported = design.compatibility.check(request);
  assert.equal(unsupported.status, "unsupported");
  assert.equal(unsupported.diagnostics[0].code, "capability.missing");
  assert.equal(await reused.evaluate(el => getComputedStyle(el).backdropFilter), "none");
  const native = await createDesign({ capabilities: [blur] });
  assert.equal(native.compatibility.check(request).status, "compatible");
  await page.addStyleTag({ content: '#portal [role="dialog"], #portal dialog { backdrop-filter: blur(6px); }' });
  assert.equal(await reused.evaluate(el => getComputedStyle(el).backdropFilter), "blur(6px)");
  await reused.getByRole("button", { name: "Close details" }).press("Escape");
  await reused.waitFor({ state: "hidden" });
  await page.waitForFunction(el => el === document.activeElement, await opener.elementHandle());
  console.log("Three Dialog targets passed scope and missing-variable counterexamples. The query-selected project page passed keyboard and material checks.");
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
