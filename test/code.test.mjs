import assert from "node:assert/strict";
import test from "node:test";
import { createDesign } from "@lenso/design";
import { codeModules } from "@lenso/design/code";
import { portableRecipe } from "@lenso/design/recipe";

const source = {
  description: "Solid button", recipe: { id: "button", base: {} },
  component: "examples/button/index.tsx", dependencies: ["solid-js@2.0.3"],
};
const options = { namespace: "demo", version: "1.0.0", reference: "v1", runtime: "node26", framework: "solid", output: "code", components: [source] };

test("Code and shadcn distribution share identical compiled component files", async () => {
  const design = await createDesign({ integrations: [codeModules(options), portableRecipe({ ...source, output: "registry" })] });
  const { artifacts, diagnostics } = await design.build();
  assert.deepEqual(diagnostics, []);
  const byPath = new Map(artifacts.map(file => [file.path, file.content]));
  for (const style of ["tailwind", "stylex", "css-modules"]) {
    const item = JSON.parse(byPath.get(`registry/${style}/button/registry.json`));
    for (const file of item.files) assert.equal(byPath.get(`code/button/${style}/${file.path}`), file.content);
  }
});

test("invalid module identities or releases produce diagnostics without partial output", async () => {
  for (const changes of [{ version: "latest" }, { components: [source, source] }, { namespace: "../x" }]) {
    const design = await createDesign({ integrations: [codeModules({ ...options, ...changes })] });
    const result = await design.build();
    assert.equal(result.ok, false);
    assert.deepEqual(result.artifacts, []);
    assert.match(result.diagnostics[0].code, /^code\./);
  }
});
