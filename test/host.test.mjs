import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const host = fileURLToPath(new URL("../dist/host.js", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../dist/extension.json", import.meta.url)));
const invoke = (cwd, name, input) => {
  const child = spawnSync(process.execPath, [host, name], {
    cwd, encoding: "utf8", input: JSON.stringify({ abi_version: 1, input, answers: {} }),
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
};

test("packaged Design commands have exact grants and share the author and contract behavior", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lenso-design-host-"));
  try {
    for (const cmd of manifest.commands) {
      const [namespace, name] = cmd.path;
      assert.equal(namespace, "design");
      const { type, ...spec } = manifest.handlers[cmd.workflow];
      assert.equal(type, "json_process");
      assert.deepEqual(spec.args, ["node_modules/@lenso/design/dist/host.js", name]);
      assert.ok(manifest.setup.defaults.json_processes.some(g => JSON.stringify(g) === JSON.stringify(spec)));
    }
    assert.equal(invoke(cwd, "init", {}).status, "complete");
    assert.equal(invoke(cwd, "resolve", { id: "surface.canvas", appearance: "dark" }).output.value, "#18181b");
    assert.equal(invoke(cwd, "resolve", { id: "absent" }).status, "failed");
    assert.equal(invoke(cwd, "build", { "dry-run": "false" }).code, "request.input");
    assert.equal(invoke(cwd, "check", { unexpected: true }).code, "request.input");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
