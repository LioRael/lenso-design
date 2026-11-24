import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
  const { artifacts, diagnostics } = await (await createDesign(example)).build();
  assert.deepEqual(diagnostics, []);
  const file = suffix => artifacts.find(entry => entry.path.endsWith(suffix)).content;
  const targets = ["css-modules", "tailwind", "stylex"];
  let stylesheet = file("/tokens.css");
  for (const target of targets) {
    const folder = join(root, target);
    await mkdir(folder);
    const path = name => file(`/${target}/bold-toggle/${name}`);
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
      const { root: classes } = await import("data:text/javascript," + encodeURIComponent(recipe));
      stylesheet += compiler.build(classes.split(" "));
    }
    await writeFile(join(folder, "recipe.ts"), recipe);
  }
  await writeFile(join(root, "theme.css"), stylesheet);
  await writeFile(join(root, "index.html"), '<div id="app"></div><script type="module" src="/main.tsx"></script>');
  const imports = targets.map((target, index) => `import { BoldToggle as Toggle${index} } from "./${target}";`);
  await writeFile(join(root, "main.tsx"), [
    'import { render } from "@solidjs/web";', 'import "./theme.css";', ...imports,
    'render(() => <><Toggle0/><Toggle1/><Toggle2/></>, document.querySelector("#app"));',
  ].join("\n"));
  await build({ root, configFile: false, plugins: [solid()], logLevel: "warn" });
  server = await preview({ root, configFile: false, preview: { host: "127.0.0.1", port: 0 } });
  browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || "chrome" });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  const buttons = page.getByRole("button", { name: "Bold" });
  await buttons.first().waitFor();
  assert.equal(await buttons.count(), 3);
  for (const [theme, background] of [["light", "rgb(255, 255, 255)"], ["dark", "rgb(17, 17, 19)"]]) {
    await page.locator("html").evaluate((html, value) => html.dataset.theme = value, theme);
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
  console.log("Three native Solid targets passed theme, radius, accessible name, Space and Enter checks.");
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
