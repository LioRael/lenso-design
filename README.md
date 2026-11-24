# Lenso Design

Open design infrastructure for humans, tools, and agents. Resolve design tokens for a project and generate native CSS, Tailwind, StyleX, and shadcn Registry artifacts. The generated artifacts can be used with the target tools directly.

## Use the published Wasm extension

In an empty project with Lenso 1.1.2, save this as `design.json`:

```json
{
  "contractVersion": 1,
  "tokens": { "surface": { "type": "color", "value": "#fff" } },
  "dimensions": { "appearance": { "default": "light", "values": ["light", "dark"] } },
  "variants": [{ "when": { "appearance": "dark" }, "tokens": { "surface": { "type": "color", "value": "#222" } } }]
}
```

```sh
lenso ext add github-release:LioRael/lenso-design/design --id design --constraint '=0.1.0-preview.5'
lenso design resolve surface --context appearance=dark --json
```

Review the read grant for `design.json`. The value at `outputs.resolve.value` is `#222`. The command works with a locked, cached extension offline. The [contract reference](spec/contract-v1.md) documents this checkout's schema, CI checks and context limits. New optional fields, usage references and repeatable context options require preview.2.

## Use the full `lenso design` command set (preview.4)

The npm author extension exposes all 13 commands under `lenso design`. It requires Node.js 22.18+ and a Lenso host with the `json_process` handler and `json_processes` installation grants. The public Lenso 1.1.2 release supports the Wasm setup above. On Lenso 1.1.2, the npm package provides the compatibility executable `lenso-design` for author commands.

In a project using a compatible host, install the package and register its manifest.

```sh
npm install @lenso/design@0.1.0-preview.5
lenso ext add node_modules/@lenso/design/dist/extension.json --id design --constraint '=0.1.0-preview.5'
lenso design --help
lenso design init
lenso design check
lenso design build
```

Choose one Design extension per project. To switch an existing Wasm-only project, run `lenso ext remove design` before registering the new manifest. The Wasm-only installation needs a read grant for `design.json`. The author installation runs project-local Node handlers under your OS account, including executable author configurations and shadcn. Review the proposed process grants when registering it. Both installations expose contract operations under the same command names.

### Find and reuse an existing component

Run `lenso design discover "Advanced options" --json` in an existing JSX or TSX project. The command searches imported JSX tags and their opening attributes and returns ranked usage locations, local names, module specifiers, exports, and resolvable declarations. It reads tsconfig when present. No Design contract is needed. The [browser acceptance case](test/discovery-browser.mjs) exercises a real Lenso Docs component from an unannotated project.

### Install a native component

In a Solid project configured for shadcn, install the shadcn CLI locally or put it on PATH. The npm package includes the bold-toggle and details-dialog Registry items. Preview, compare, then install or upgrade with:

```sh
lenso design install details-dialog --dry-run
lenso design install details-dialog --diff
lenso design install details-dialog
```

A direct Tailwind or StyleX dependency selects its target. With neither present the CLI offers the CSS Modules item, which requires a CSS Modules compiler. Choose `--target css-modules|stylex|tailwind` explicitly when both are present. Use `--from <components-directory>` for your own generated items. shadcn previews the file plan. Lenso asks before replacing each changed file in a generated item with explicit targets; use `--json` and `--answers` to review and resume from automation. The structured host allows 30 seconds per handler invocation. For the bundled items, import `@lenso/design/theme.css` in your consumer stylesheet. For Tailwind, also import `@lenso/design/tailwind.css` after Tailwind itself. Custom registries can supply their own theme.

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

With the author extension, run `lenso design init` to create a shared contract and an ES-module author config (`design.config.mts`), then `check`, `build`, `inspect`, `tokens`, `resolve`, `query`, or `diff`. Use `--json` and read `outputs.<command>` for a successful host result. In JSON mode, global console messages from configuration and integrations go to stderr. `--config` selects a configuration file, with source and output paths resolved from its parent directory. Use `build --dry-run` to preview output paths and `build --overwrite` to replace changed artifacts.

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

This checkout declares the local Wasm extension. Refresh the local module pin after rebuilding, then run:

```sh
lenso update
lenso design inspect --json
lenso design resolve action.primary.background --context appearance=dark --json
lenso design query "primary action" --context appearance=dark --json
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

- DTCG 2025.10 Format support covers color, dimension, duration, number, font family, font weight, and cubic Bézier values, along with group type inheritance, root tokens, and whole-token aliases. Export produces one selected context and preserves token descriptions and extensions. Use `dtcg.resolver(path, context)` to import a selected DTCG 2025.10 Resolver permutation. The adapter uses the project file reader. For structured values and reference metadata, `resolveDtcg(path, read, context)` returns the resolved graph before projection into the scalar contract. [Format specification](https://www.designtokens.org/tr/2025.10/format/)
- CSS sources read custom properties from explicitly selected rules. Configured types enable validation and mapping. Tailwind output targets v4, and StyleX output provides static theme modules. [Tailwind theme variables](https://tailwindcss.com/docs/theme) · [StyleX variables](https://stylexjs.com/docs/api/javascript/defineVars)
- Registry output supports local CSS-variable bridges for built shadcn items with inline source. Each target declares the stylesheets its consumer loads with `stylesheets: [{ artifact: "generated/tokens.css" }]` or `stylesheets: [{ source: "src/theme.css" }]`. The check verifies each target variable in an unconditional `:root` rule, including simple aliases between these rules. The consuming application still owns stylesheet imports, scoped overrides, and browser cascade behavior. The [upstream Separator example](examples/shadcn/README.md) uses the component’s data slot. Items may select target-specific native sources via `targets`; `strategy: "rewrite"` supports CSS files with whole-value variable references. [shadcn Registry item schema](https://ui.shadcn.com/schema/registry-item.json)

## Migrate and verify

In a project with an existing author config, run `lenso design migrate --config design.config.ts` to materialize a v1 contract. The command checks the result and refuses to replace a different existing file. It preserves aliases and exports contextual differences. Review before adopting the JSON as the source of truth. Keep generators in the author config and remove equivalent declarations from other inputs. Use `lenso design diff old.json --config design.json` to compare resolved values and `lenso design impact <token> --config design.json` to trace affected aliases, components, patterns and declared source references.

## Native component distribution

The [Solid Toggle](examples/toggle/index.tsx) uses UI SDK for its accessible behavior. One recipe in the [example config](design.config.ts) generates three source variants. Each variant has an installable Registry item at `examples/generated/components/<target>/bold-toggle/registry.json`. Choose `tailwind`, `stylex` or `css-modules` to match the consumer's configured compiler. Import the theme CSS into the app. Use the ordinary shadcn CLI to add the chosen item. For upgrades, review the file diff and keep locally modified files at the overwrite prompt.

Portable rules currently bind background, foreground, corner radius, inline padding, minimum height and outline color to typed tokens. States include hover, focus-visible and disabled. For other properties or layout/interaction models, provide a native implementation. Run `pnpm test:browser` with Chrome installed to compile all three variants and exercise the same Toggle in light and dark themes with the keyboard.

### Distribute a component through Lenso Code

The optional `codeModules` integration from `@lenso/design/code` builds a Code module directory. The [Button configuration](design.config.ts) compiles a single Solid implementation to Tailwind, StyleX and CSS Modules. The generated `lenso.modules.toml` indexes one component address with a language, runtime and two Code project conventions, `framework` and `styles`. Each matching catalog contains the native source files and its npm requirements. Code owns search, installation, file ownership and upgrades. Other Design integrations work independently.

In a Solid project with a package.json, register the published Button catalog and choose your styling convention:

```sh
lenso ext add github-release:LioRael/lenso-cli/code --id code --constraint '=0.3.8' --input '{"repo":"LioRael/lenso-design","ref":"code-catalog","catalog":"lenso.modules.toml","format":"lenso-modules-v1","target":"src","native":{"npm":{"manifest":"package.json"}}}'
lenso code config --language typescript --runtime node26 --convention framework=solid styles=tailwind
lenso code preview @design/button
lenso code add @design/button
```

Import `Button` from `./generated/button/assembly` in a file under `src/`. Configure your project's Solid and styling compilers, and load the theme variables used by the recipe (the Button release includes [theme.css](https://github.com/LioRael/lenso-design/blob/button-v0.1.0/theme.css)). In another project, set `styles=stylex` or `styles=css-modules` to install the same address with that implementation. A consumer needs Code and the selected native dependencies; Design runs in the author's build.

After the author publishes a newer module version, run `lenso code update @design/button`. Code merges independent changes and asks how to resolve overlapping edits. For a GitHub-backed Code source, place the exported directory contents at the root of the configured repository and make the declared release reference resolve to that snapshot. This adapter emits a single release per build. The published `code-catalog` branch indexes `@design/button` and its `button-v0.1.0` release snapshot.

The [consumer acceptance test](test/code-consumer.mjs) builds two local catalog versions and exercises three independent projects against published Code 0.3.8. Run `node test/code-consumer.mjs` after building, with Chrome and npm available. It checks dependency selection, browser rendering, keyboard activation and upgrade conflict handling.

### Portal and theme scope in the Dialog example

The [Solid Dialog](examples/dialog/index.tsx) uses one recipe for its panel and a named `action` part for its trigger and close button. Run `pnpm example` to generate `examples/generated/components/<target>/details-dialog/registry.json`. Install that item in a Solid project configured for the selected styling target.

Pass a portal container inside the desired theme scope, such as a sibling of the application mount under the same `data-theme="dark"` element. UI SDK mounts the panel there so it inherits the theme variables even when the trigger and panel live in different DOM subtrees. The browser test opens the dialog with Enter, switches its theme while open, and checks that Escape returns focus to the trigger on each target.

## Lenso Docs and DESIGN.md

Use `defineCollection(designCollection("design.json"))` in a Lenso Docs config. Import `designCollection` from `@lenso/design/docs` and `defineCollection` from the Docs project. The collection uses the Docs file reader and emits reference pages for the populated contract sections.

The `@lenso/design/design-md` entry point reads YAML front matter with `designMd.source(path)`. It imports colors, spacing and corner radii. Use `designMd.output({ file, name, template, mapping })` to update selected tokens in a separate output file while preserving other front-matter fields and prose. Interleaved YAML blocks are outside this adapter's current projection.

Use `deriveDesign(config, derivations)` from `@lenso/design/derive` for scaled numbers or lengths. A source length can be converted between px and rem with an explicit `rootFontSizePx`. Derived tokens record the source and conversion in extension metadata and track every supported context.

## Preview acceptance

| Workflow | Checked in preview.3 |
| --- | --- |
| Official CLI | Lenso 1.1.2 reads the current contract with one file grant. Repeated context flags select combined dimensions. |
| Independent author | The packed npm CLI initializes an empty CommonJS project, resolves a dark token and builds CSS. The public preview installs with `npm install @lenso/design@preview`. |
| Third-party Registry | The upstream Separator keeps its files and dependencies. The shadcn CLI installs it and writes the scoped theme binding. A missing destination variable fails the author check. |
| Multi-target installation | One Solid UI SDK Toggle compiles with Tailwind, StyleX and CSS Modules. Chrome checks colors, radius, accessible name, Space and Enter. The shadcn CLI installs the generated CSS Modules item and preserves a local edit when the overwrite prompt is declined. |
| Material variants | The Registry can restrict native sources to named targets and validate a target's available capabilities. Glass requires a real renderer. Optical fidelity and performance in Lenso UI require rendered product acceptance. |
| Agent and Docs | Queries return declared source references. Author checks catch missing reference text. The Docs collection generates reference pages from the same contract. |

Cross-framework compilation, automatic discovery of arbitrary application usages, Figma synchronization, full CSS cascade analysis and visual benchmark coverage are outside the verified preview scope.

### Dialog counterexamples and agent reuse

Run `pnpm test:browser` to compare the declared design with Chrome's actual rendering. The optional browser helper `checkRenderedTheme(scope, panel, variables)` from `@lenso/design/rendered-theme` compares the selected custom properties on an open panel and its intended theme scope. The component itself has no dependency on this helper.

| Dialog condition | Evidence |
| --- | --- |
| Portal inside the dark theme | No theme diagnostics. The rendered panel uses the dark background. |
| Portal outside the dark theme | A scope warning and a differing variable. Chrome renders the light background. |
| Panel overrides the required variable | A differing variable warning. Chrome renders the overriding red color. |
| Required panel variable reset to initial | A missing-variable error. Chrome renders a transparent background. |
| Backdrop blur requested | The solid-only target reports a missing capability and Chrome reports no filter. A separate target declaring and applying blur computes a 6px filter. |

The first four cases run against all three styling targets. Variable differences compare computed custom-property text. Confirm visual impact using the affected CSS property; equivalent CSS colors can have different textual representations.

The same test asks the standalone CLI for `project details`, uses the returned import, export and source usage to build the [consumer page](examples/project-details/project-details.tsx) against the generated CSS Modules Registry item, and opens and dismisses it with the keyboard. This records one reproducible reuse task. That fixture supplies its usage declarations. A separate [discovery test](test/discovery-browser.mjs) reuses a Disclosure from unannotated JSX. Multi-task success rates remain unmeasured.
