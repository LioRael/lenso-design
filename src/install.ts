import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "./model.js";

export async function selectComponent(id: string, from?: string, target?: string) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) fail("install.item", "Expected a component ID.");
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  const targets = ["css-modules", "stylex", "tailwind"];
  const detected = [deps["@stylexjs/stylex"] && "stylex", deps.tailwindcss && "tailwind"].filter(Boolean);
  if (!target && detected.length > 1) fail("install.target", "Both StyleX and Tailwind are present. Select --target.");
  const selected = target ?? detected[0] ?? "css-modules";
  if (!targets.includes(selected)) fail("install.target", "Choose css-modules, stylex or tailwind.");
  const directory = from ?? fileURLToPath(new URL("./registry/", import.meta.url));
  const item = resolve(directory, selected, id, "registry.json");
  try { await access(item); } catch { fail("install.item", `Missing ${id} for ${selected} in ${directory}.`); }
  const manifest = JSON.parse(await readFile(item, "utf8"));
  if (manifest.dependencies?.some((dep: string) => dep.startsWith("@ui-sdk/solid")) &&
      (deps.react || deps.vue || deps.svelte) && !deps["solid-js"]) {
    fail("install.framework", "This component requires a Solid project. No Solid dependency was found.");
  }
  const binary = process.platform === "win32" ? "shadcn.cmd" : "shadcn";
  const local = resolve("node_modules", ".bin", binary);
  const executable = await access(local).then(() => local, () => binary);
  return { executable, item, selected, manifest };
}

export async function installComponent(id: string, from: string | undefined, target: string | undefined, preview: boolean, diff: boolean) {
  const { executable, item, selected } = await selectComponent(id, from, target);
  console.error(`Selected ${selected}: ${id}`);
  const child = spawnSync(executable, ["add", item, ...(diff ? ["--diff"] : preview ? ["--dry-run"] : [])], { stdio: "inherit" });
  if (child.error) fail("install.shadcn", "Install the shadcn CLI in this project or place it on PATH.");
  process.exitCode = child.status ?? 1;
}
