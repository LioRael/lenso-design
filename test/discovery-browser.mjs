import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import solid from "@solidjs/vite-plugin";
import { build, preview } from "vite";
import { chromium } from "playwright-core";

const project = process.argv[2];
if (!project) throw new Error("Pass a Lenso Docs project with its dependencies installed.");
const cwd = resolve(project);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const query = JSON.parse(execFileSync(process.execPath, [cli, "discover", "Advanced options", "--json"], { cwd }));
const hit = query.matches[0];
assert.equal(hit.exported, "Disclosure");
const usage = await readFile(join(cwd, hit.file), "utf8");
assert.ok(usage.split("\n")[hit.line - 1].includes('title="Advanced options"'));
const root = await mkdtemp(join(tmpdir(), "design-discover-"));
let server, browser;
try {
  await symlink(join(cwd, "node_modules"), join(root, "node_modules"));
  await writeFile(join(root, "disclosure.tsx"), await readFile(join(cwd, hit.source)));
  await writeFile(join(root, "main.tsx"), [
    'import { render } from "@solidjs/web";',
    `import { ${hit.exported} } from "./disclosure";`,
    'render(() => <Disclosure title="Publishing options"><p>Preview releases only</p></Disclosure>, document.querySelector("main"));',
  ].join("\n"));
  await writeFile(join(root, "index.html"), '<main></main><script type="module" src="/main.tsx"></script>');
  await build({ root, configFile: false, plugins: [solid()], logLevel: "warn" });
  server = await preview({ root, configFile: false, preview: { host: "127.0.0.1", port: 0 } });
  browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || "chrome" });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  const summary = page.locator("summary", { hasText: "Publishing options" });
  const content = page.getByText("Preview releases only");
  await summary.waitFor();
  assert.equal(await content.isVisible(), false);
  await summary.press("Enter");
  await content.waitFor();
  await summary.press("Space");
  await content.waitFor({ state: "hidden" });
  console.log(JSON.stringify({ task: "Reuse the disclosure for publishing options", result: hit, keyboard: "passed" }));
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
