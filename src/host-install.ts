import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { selectComponent } from "./install.js";
import { fail } from "./model.js";

type ItemFile = { target?: string; content?: string; type: string };

export async function installFromHost(id: string, from: string | undefined, target: string | undefined,
  dryRun: boolean, diff: boolean, answers: Record<string, unknown>) {
  const { executable, item, selected, manifest } = await selectComponent(id, from, target);
  const run = (path: string, flags: string[]) => {
    const child = spawnSync(executable, ["add", path, ...flags], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (child.error) fail("install.shadcn", child.error.message);
    if (child.status !== 0) fail("install.shadcn", child.stderr.trim() || child.stdout.trim() || "shadcn add failed.");
    return { target: selected, item: id, report: (child.stdout + child.stderr).trim() };
  };
  if (dryRun || diff) return { status: "complete", output: run(item, [diff ? "--diff" : "--dry-run"]) };

  // Generated Registry items have explicit project-relative targets. Host questions
  // replace terminal prompts, so interactive and --answers calls share the same plan.
  const files: ItemFile[] = [];
  const root = await realpath(".");
  if (manifest.registryDependencies?.length || !Array.isArray(manifest.files)) {
    fail("install.plan", "Host installation requires a generated item with explicit file targets.");
  }
  const replacements: ItemFile[] = [];
  for (const file of manifest.files as ItemFile[]) {
    if (!file.target || file.type !== "registry:file" || typeof file.content !== "string" ||
        !file.target.split("/").every(part => /^[a-z0-9_.-]+$/i.test(part) && part !== "." && part !== "..")) {
      fail("install.plan", "Expected a project-relative registry:file target with inline content.");
    }
    const path = resolve(root, file.target);
    let ancestor = path;
    while (ancestor !== root) {
      const stat = await lstat(ancestor).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
        return undefined;
      });
      if (stat?.isSymbolicLink() || !path.startsWith(root + sep)) fail("install.path", "Unexpected registry target: " + file.target);
      ancestor = dirname(ancestor);
    }
    const existing = await readFile(path, "utf8").catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
      return undefined;
    });
    if (existing !== undefined && existing !== file.content) {
      const key = "replace-" + createHash("sha256").update(JSON.stringify([file.target, existing, file.content])).digest("hex").slice(0, 24);
      if (typeof answers[key] !== "boolean") return { status: "needs_input", question: {
        id: key, message: "Replace the local file " + file.target + "?", kind: { type: "confirm" },
      } };
      if (!answers[key]) continue;
      replacements.push(file);
      continue;
    }
    if (existing !== file.content) files.push(file);
  }
  const temp = await mkdtemp(join(tmpdir(), "lenso-design-item-"));
  try {
    const path = join(temp, "registry.json");
    // Only approved replacements may be passed to a command with --overwrite.
    const reports: string[] = [];
    if (files.length || !replacements.length) {
      await writeFile(path, JSON.stringify({ ...manifest, files }));
      reports.push(run(path, ["--yes"]).report);
    }
    if (replacements.length) {
      await writeFile(path, JSON.stringify({ ...manifest, files: replacements }));
      reports.push(run(path, ["--yes", "--overwrite"]).report);
    }
    return { status: "complete", output: { target: selected, item: id, report: reports.join("\n") } };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
