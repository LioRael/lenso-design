import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const crate = new URL("../extensions/lenso-cli/", import.meta.url);
const target = new URL("target/", crate);
const build = spawnSync("cargo", [
  "build", "--locked", "--release", "--target", "wasm32-unknown-unknown",
  "--target-dir", fileURLToPath(target),
], { cwd: crate, stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const wasm = new URL("wasm32-unknown-unknown/release/lenso_design_wasm.wasm", target);
const dist = new URL("../dist/", import.meta.url);
mkdirSync(dist, { recursive: true });
copyFileSync(wasm, new URL("design.wasm", crate));
copyFileSync(wasm, new URL("design.wasm", dist));
copyFileSync(new URL("../LICENSE", import.meta.url), new URL("LICENSE", crate));

const metadata = spawnSync("cargo", [
  "metadata", "--locked", "--format-version", "1", "--filter-platform", "wasm32-unknown-unknown",
], { cwd: crate, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
if (metadata.error) throw metadata.error;
if (metadata.status !== 0) process.exit(metadata.status ?? 1);
const notices = JSON.parse(metadata.stdout).packages.filter(pkg => pkg.source !== null).map(pkg => {
  const source = dirname(pkg.manifest_path);
  const files = readdirSync(source, { withFileTypes: true })
    .filter(file => file.isFile() && /^(license|licence|copying|notice)([._-].*)?$/i.test(file.name))
    .map(file => join(source, file.name)).sort();
  if (pkg.license_file && !files.includes(join(source, pkg.license_file))) {
    files.push(join(source, pkg.license_file));
  }
  // The Extism runtime crates ship license metadata but omit the upstream text.
  if (files.length === 0 && pkg.repository === "https://github.com/extism/extism" && pkg.version === "1.41.0") {
    files.push(new URL("../licenses/extism-BSD-3-Clause.txt", import.meta.url));
  }
  if (files.length === 0) throw new Error(`Missing license text for ${pkg.name} ${pkg.version}.`);
  return [`## ${pkg.name} ${pkg.version} (${pkg.license ?? "see license text"})`, ...files.map(path => readFileSync(path, "utf8").trim())].join("\n\n");
});
writeFileSync(new URL("THIRD_PARTY_LICENSES.txt", crate), notices.join("\n\n") + "\n");
copyFileSync(new URL("THIRD_PARTY_LICENSES.txt", crate), new URL("THIRD_PARTY_LICENSES.txt", dist));
