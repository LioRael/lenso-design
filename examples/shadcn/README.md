# Upstream Separator

The [shadcn Separator item](https://ui.shadcn.com/r/styles/new-york-v4/separator.json) is vendored with its [MIT license](LICENSE). The existing component uses the Tailwind utility `bg-border` and exposes `data-slot="separator"`. The example binds the shadcn theme variable `--border` to Neutral's `--ds-border-default` on that slot.

Run `pnpm example`, then install `examples/generated/registry/neutral/separator.json` with `shadcn add /absolute/path/to/separator.json` in an initialized shadcn project. Its Tailwind theme must use an inline color mapping to `var(--border)`. Import the generated tokens.css into the consumer. The regression test compares every upstream source file and dependency and checks that a target without the expected variable fails.
