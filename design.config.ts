import { readFile } from "node:fs/promises";
import { defineDesign, defineMapping } from "@lenso/design";
import { readDesignContract } from "@lenso/design/contract";
import { codeModules } from "@lenso/design/code";
import { css, cssSource } from "@lenso/design/css";
import { dtcg } from "@lenso/design/dtcg";
import { neutral } from "@lenso/design/presets";
import { defineRecipe, portableRecipe } from "@lenso/design/recipe";
import { shadcn } from "@lenso/design/shadcn";
import { stylex } from "@lenso/design/stylex";
import { tailwind } from "@lenso/design/tailwind";

const button = await readFile(new URL("./examples/acme-button.tsx", import.meta.url), "utf8");
const separator = JSON.parse(await readFile(new URL("./examples/shadcn/separator.json", import.meta.url), "utf8"));
const dark = { appearance: "dark" };
const output = "examples/generated";

const contract = await readDesignContract(new URL("./design.json", import.meta.url));

export default defineDesign({
  ...contract,
  presets: [neutral()],
  sources: [
    dtcg.source("./examples/brand.tokens.json"),
    cssSource("./examples/brand.css", {
      types: { primary: "color", "primary-foreground": "color", radius: "dimension" },
      themes: [{ selector: '[data-theme="dark"]', context: dark }],
    }),
  ],
  mappings: [
    ...contract.mappings ?? [],
    defineMapping({
      id: "brand",
      roles: {
        "button.brand": "primary",
        "button.on-brand": "primary-foreground",
        "button.radius": "radius",
      },
    }),
  ],
  integrations: [
    codeModules({
      namespace: "design", output: `${output}/code`, version: "0.1.0",
      reference: "button-v0.1.0", framework: "solid", runtime: "node26",
      components: [{
        component: "examples/button/index.tsx", description: "Solid action button",
        dependencies: ["solid-js@2.0.3", "@solidjs/web@2.0.3"],
        recipe: defineRecipe({
          id: "button",
          base: { backgroundColor: { ref: "action.primary.background" }, color: { ref: "action.primary.foreground" } },
          states: { "focus-visible": { outlineColor: { ref: "focus.ring" } } },
        }),
      }],
    }),
    portableRecipe({
      component: "examples/toggle/index.tsx",
      dependencies: ["@ui-sdk/solid@0.1.0-beta.14", "solid-js@2.0.3", "@solidjs/web@2.0.3"],
      output: `${output}/components`,
      recipe: defineRecipe({
        id: "bold-toggle",
        base: { backgroundColor: { ref: "surface.canvas" }, color: { ref: "text.primary" }, borderRadius: { ref: "control.radius" } },
        states: {
          hover: { backgroundColor: { ref: "surface.raised" } },
          "focus-visible": { outlineColor: { ref: "focus.ring" } },
        },
      }),
    }),
    portableRecipe({
      component: "examples/dialog/index.tsx",
      dependencies: ["@ui-sdk/solid@0.1.0-beta.14", "solid-js@2.0.3", "@solidjs/web@2.0.3"],
      output: `${output}/components`,
      recipe: defineRecipe({
        id: "details-dialog",
        base: { backgroundColor: { ref: "surface.canvas" }, color: { ref: "text.primary" }, borderRadius: { ref: "control.radius" } },
        parts: { action: { base: { backgroundColor: { ref: "action.primary.background" }, color: { ref: "action.primary.foreground" } } } },
      }),
    }),
    shadcn({
      output: `${output}/registry`,
      items: [{
        item: separator,
        selector: '[data-slot="separator"]',
        requirements: [{ role: "border.default", type: "color", variable: "--border" }],
      }],
      targets: [{ id: "neutral", stylesheets: [{ artifact: `${output}/tokens.css` }] }],
    }),
    css({ output: `${output}/tokens.css`, themes: [{ selector: '[data-theme="dark"]', context: dark }] }),
    tailwind({
      output: `${output}/tailwind.css`,
      mapping: { "color-primary": "action.primary.background", "radius-control": "control.radius" },
    }),
    stylex({ output: `${output}/stylex`, themes: { dark } }),
    shadcn({
      output: `${output}/registry`,
      items: [{
        item: {
          $schema: "https://ui.shadcn.com/schema/registry-item.json",
          name: "acme-button",
          type: "registry:ui",
          files: [{ path: "acme-button.tsx", type: "registry:ui", content: button }],
        },
        selector: ".acme-button",
        requirements: [
          { role: "button.brand", type: "color", variable: "--acme-brand" },
          { role: "button.on-brand", type: "color", variable: "--acme-on-brand" },
          { role: "button.radius", type: "dimension", variable: "--acme-radius" },
        ],
        capabilities: [{ id: "material.solid" }],
      }],
      targets: [
        { id: "neutral", mapping: "neutral", contexts: [{}, dark], stylesheets: [{ artifact: `${output}/tokens.css` }] },
        { id: "brand", mapping: "brand", prefix: "", contexts: [{}, dark], stylesheets: [{ source: "./examples/brand.css" }] },
      ],
    }),
  ],
});
