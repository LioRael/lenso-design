# Lenso Design

Open design infrastructure for humans, tools, and agents. Resolve design tokens for a project and generate native CSS, Tailwind, StyleX, and shadcn Registry artifacts. The generated artifacts can be used with the target tools directly.

## Run the example

Use Node.js 22.18 or newer, pnpm, and the Rust toolchain pinned in the extension directory.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm example
node dist/cli.js resolve action.primary.background --context appearance=dark --json
node dist/cli.js query "primary action" --context appearance=dark --json
pnpm test
```

The [author configuration](design.config.ts) loads [design.json](design.json), then adds the Neutral preset, a DTCG token file, and an existing CSS theme for artifact generation. The build writes these files to `examples/generated`:

- `tokens.css` provides CSS custom properties for light and dark themes. Set `data-theme="dark"` on a theme root.
- `tailwind.css` provides Tailwind v4 theme mappings. Import `tokens.css` and `tailwind.css` in your Tailwind entry stylesheet alongside Tailwind itself. Use classes such as `bg-primary` and `rounded-control`.
- `stylex/tokens.stylex.ts` and `stylex/dark.stylex.ts` provide a static variable group and a dark theme for the StyleX compiler. Import the group and use `tokens["action-primary-background"]` inside `stylex.create`.
- `registry/{neutral,brand}/acme-button.json` contains the same [button source](examples/acme-button.tsx) with different scoped CSS-variable bindings. Use the generated CSS with the Neutral item and [the existing CSS theme](examples/brand.css) with the Brand item.

From an initialized shadcn project, install either generated item with
`shadcn add /absolute/path/to/examples/generated/registry/brand/acme-button.json`.
The Brand item expects `--primary`, `--primary-foreground`, and `--radius` in the consuming CSS.

## Author a design contract

Use `design.json` for the shared project contract. Its version 1 fields cover
typed tokens, references, dimensions, variants, components, patterns, policies,
and capabilities. See the [project example](design.json). The standalone CLI and
the Lenso extension use the same Wasm module for `inspect`, `resolve`,
`query`, and `check` against this file. Edits are visible on the next invocation.

For artifact generation, an optional `design.config.ts` can call
`readDesignContract(new URL("./design.json", import.meta.url))` from
`@lenso/design/contract` and spread the result into `defineDesign`. That helper
checks the contract with the shared module before handing its data to the author
tooling. The author API can also build from executable TypeScript configurations
with sources, presets, and adapters. For example:

```ts
import { color, createDesign, defineDesign, token } from "@lenso/design";
import { css } from "@lenso/design/css";

const config = defineDesign({
  contractVersion: 1,
  tokens: {
    "brand.ink": color("#25253a"),
    "text.primary": color(token("brand.ink")),
  },
  dimensions: { appearance: { default: "light", values: ["light", "dark"] } },
  variants: [{ when: { appearance: "dark" }, tokens: { "brand.ink": color("#f0f0fa") } }],
  integrations: [css({ themes: [{ selector: '[data-theme="dark"]', context: { appearance: "dark" } }] })],
});

const design = await createDesign(config);
const ink = design.tokens.resolve("text.primary", { appearance: "dark" });
const { artifacts, diagnostics } = await design.build();
```

A token has an ID, a type, and a literal value or a reference to another token of the same type. Resolution returns the actual value, the requested token's declaration source (`source`), the final value's declaration source (`valueSource`), and the alias path. Projects choose their own token names and opt into profiles to enforce role types. Neutral supplies foundation roles, light and dark colors, typography, layout, density, motion, feedback, and other common design values.

Preset and source declarations establish the base. The project may replace an existing base token with the same type. Variants override existing tokens and apply after the base. More specific conditions take priority. Across sources of equal specificity, preset, source, and project order applies. Within one source, overlapping equally specific variants that assign the same token are rejected. CSS theme selectors emit complete context snapshots. To style combinations of dimensions, declare each desired combined scope and order the selectors accordingly.

`design.validate()` checks the design model. `design.build()` also checks the configured output targets and returns artifacts in memory. `design.compatibility.check()` validates explicit role and capability requirements across the requested contexts. Shadcn bridges scope aliases to an existing component class and expect the target variables to be present in the consuming theme. Components using portals must arrange for the bridge scope to cover their portal content.

Use `await loadDesign(path)` to load the same project configuration as the CLI. The loaded design exposes `inspect()`, `diff(before, context)`, and the other design operations. Each CLI invocation loads the configuration in a fresh Node process. In a long-running library consumer, executable config modules and their imports follow Node's module cache. Use a fresh process to pick up edits to those modules. Source adapters read their files again when loading a design.

## Command line

The package exposes `lenso-design`. A project can run `lenso-design init` to create a starter config, then `check`, `build`, `inspect`, `tokens`, `resolve`, `query`, or `diff`. Use `--json` for structured standalone CLI output. In JSON mode, global console messages from configuration and integrations go to stderr. `--config` selects a configuration file, with source and output paths resolved from its parent directory. Use `build --dry-run` to preview output paths and `build --overwrite` to replace changed artifacts.

For the four shared operations, the standalone CLI looks for `design.json` by
default. Pass `--config design.config.ts` to run an author-side operation
explicitly. The author-side `build` and its integration checks use the Node
configuration.

### Install the Lenso extension

The [Design manifest](extensions/lenso-cli/extension.toml) follows Lenso's
[Wasm Release packaging](https://github.com/LioRael/lenso-cli/blob/main/docs/github-distribution.md).
A consumer uses Lenso 1.1.2 and a project `design.json`. Node, npm, and Rust are
author/build tools for this package.

Prepare the distributable assets with the published host:

```sh
pnpm build:wasm
lenso package --id design --out .release/lenso
```

The [author descriptor](lenso.registry.toml) defines the `design-v{version}` tag.
Install the first preview in a project and review its read grant for `design.json`:

```sh
lenso ext add github-release:LioRael/lenso-design/design --id design --constraint "=0.1.0-preview.1"
lenso design inspect --json
lenso design resolve action.primary.background --appearance dark --json
lenso design query "primary action" --appearance dark --json
lenso design check --json
```

Each command reads the current contract through the Host. Look for the result in
`outputs.<operation>`, with `ok` and diagnostics for domain failures. The published
Host reports a completed Wasm call as a completed workflow. In automation, use
`outputs.check.ok` for the validation result. The standalone CLI also sets exit
code 1 for a failed contract operation. Declarative checks cover references,
shape, types, and configured context combinations. Browser CSS syntax and native
artifact/Registry validation are author-side checks. Declarative queries report
unmatched categories in `missing`, including adapter usages unavailable from the
contract.

## Current integration scope

- DTCG 2025.10 Format support covers color, dimension, duration, number, font family, font weight, and cubic Bézier values, along with group type inheritance, root tokens, and whole-token aliases. Export produces one selected context and preserves token descriptions and extensions. Full Resolver documents, group inheritance through `$extends`, JSON Pointer references, and composite types are follow-up work. [Format specification](https://www.designtokens.org/tr/2025.10/format/)
- CSS sources read custom properties from explicitly selected rules. Configured types enable validation and mapping. Tailwind output targets v4, and StyleX output provides static theme modules. [Tailwind theme variables](https://tailwindcss.com/docs/theme) · [StyleX variables](https://stylexjs.com/docs/api/javascript/defineVars)
- Registry output supports local CSS-variable bridges for built shadcn items with inline source. Each target declares the stylesheets its consumer loads with `stylesheets: [{ artifact: "generated/tokens.css" }]` or `stylesheets: [{ source: "src/theme.css" }]`. The check verifies each target variable in an unconditional `:root` rule, including simple aliases between these rules. The consuming application still owns stylesheet imports, scoped overrides, and browser cascade behavior. Portable Recipe compilation, cross-framework distribution, and UI SDK, Lenso Docs, and Figma integrations are follow-up work. [shadcn Registry item schema](https://ui.shadcn.com/schema/registry-item.json)
