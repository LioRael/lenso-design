import { readFile } from "node:fs/promises";
import { defineDesign, defineMapping } from "@lenso/design";
import { readDesignContract } from "@lenso/design/contract";
import { css, cssSource } from "@lenso/design/css";
import { dtcg } from "@lenso/design/dtcg";
import { neutral } from "@lenso/design/presets";
import { shadcn } from "@lenso/design/shadcn";
import { stylex } from "@lenso/design/stylex";
import { tailwind } from "@lenso/design/tailwind";

const button = await readFile(new URL("./examples/acme-button.tsx", import.meta.url), "utf8");
const dark = { appearance: "dark" };
const output = "examples/generated";

export default defineDesign({
  ...await readDesignContract(new URL("./design.json", import.meta.url)),
  presets: [neutral()],
  sources: [
    dtcg.source("./examples/brand.tokens.json"),
    cssSource("./examples/brand.css", {
      types: { primary: "color", "primary-foreground": "color", radius: "dimension" },
      themes: [{ selector: '[data-theme="dark"]', context: dark }],
    }),
  ],
  mappings: [
    defineMapping({
      id: "neutral",
      roles: {
        "button.brand": "action.primary.background",
        "button.on-brand": "action.primary.foreground",
        "button.radius": "control.radius",
      },
    }),
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
