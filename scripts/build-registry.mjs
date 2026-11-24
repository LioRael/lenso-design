import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createDesign } from "../dist/index.js";
import config from "../design.config.ts";

const result = await (await createDesign(config)).build();
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
for (const file of result.artifacts) {
  if (file.path === "examples/generated/tokens.css") await writeFile("dist/theme.css", file.content);
  if (file.path === "examples/generated/tailwind.css") await writeFile("dist/tailwind.css", file.content);
  const prefix = "examples/generated/components/";
  if (!file.path.startsWith(prefix) || !file.path.endsWith("/registry.json")) continue;
  const path = join("dist/registry", file.path.slice(prefix.length));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.content);
}
