import { join } from "node:path";
import { cssRule, variableNames } from "./css.js";
import { cssIdent, defineIntegration, fail, own } from "./model.js";
import type { Reference } from "./model.js";

const properties = {
  backgroundColor: ["background-color", "color"],
  color: ["color", "color"],
  borderRadius: ["border-radius", "dimension"],
  paddingInline: ["padding-inline", "dimension"],
  minHeight: ["min-height", "dimension"],
  outlineColor: ["outline-color", "color"],
} as const;
type Declarations = Partial<Record<keyof typeof properties, Reference>>;
type State = "hover" | "focus-visible" | "disabled";

export type Recipe = {
  id: string;
  base: Declarations;
  states?: Partial<Record<State, Declarations>>;
};

export const defineRecipe = (recipe: Recipe) => recipe;

/** Emit interchangeable static class modules beside the same component source. */
export function portableRecipe(options: { recipe: Recipe; component: string; output: string; prefix?: string; dependencies?: readonly string[] }) {
  return defineIntegration({
    name: "portable-recipe",
    async generate(ctx) {
      const { recipe } = options;
      if (!cssIdent.test(recipe.id)) fail("recipe.id", "Expected a CSS identifier.", recipe.id);
      const names = variableNames(ctx, options.prefix);
      const css: string[] = [];
      const classes: string[] = [];
      const stylex = new Map<string, Record<string, string | null>>();
      const rules = [["", recipe.base], ...Object.entries(recipe.states ?? {})] as const;
      for (const [state, declarations] of rules) {
        if (state && !["hover", "focus-visible", "disabled"].includes(state)) {
          fail("recipe.state", `Unsupported portable state "${state}".`, recipe.id);
        }
        const lines: string[] = [];
        for (const [property, reference] of Object.entries(declarations)) {
          const definition = own(properties, property);
          if (!definition) fail("recipe.property", `Unsupported portable property "${property}".`, recipe.id);
          const [cssProperty, type] = definition;
          const variable = names.get(reference.ref);
          if (!variable || ctx.tokens.get(reference.ref)?.type !== type) {
            fail("recipe.token", `"${property}" requires a ${type} token.`, reference.ref);
          }
          const value = `var(${variable})`;
          lines.push(`${cssProperty}: ${value};`);
          classes.push(`${state ? state + ":" : ""}[${cssProperty}:${value}]`);
          const values = stylex.get(property) ?? { default: null };
          values[state ? ":" + state : "default"] = value;
          stylex.set(property, values);
        }
        if (lines.length) css.push(cssRule(".root" + (state ? ":" + state : ""), lines));
      }
      const files = {
        "css-modules": 'import styles from "./recipe.module.css";\nexport const root = styles.root;\n',
        tailwind: `export const root = ${JSON.stringify(classes.join(" "))};\n`,
        stylex: 'import * as stylex from "@stylexjs/stylex";\n' +
          `const styles = stylex.create({ root: ${JSON.stringify(Object.fromEntries(stylex), null, 2)} });\n` +
          'export const root = stylex.props(styles.root).className;\n',
      };
      const component = await ctx.read(options.component);
      for (const [target, content] of Object.entries(files)) {
        const folder = join(options.output, target, recipe.id);
        const sources = [
          { name: "index.tsx", content: component },
          { name: "recipe.ts", content },
        ];
        if (target === "css-modules") sources.push({ name: "recipe.module.css", content: css.join("\n") });
        for (const source of sources) ctx.emit({ path: join(folder, source.name), content: source.content });
        const native = target === "stylex" ? ["@stylexjs/stylex"] : [];
        ctx.emit({
          path: join(folder, "registry.json"),
          content: JSON.stringify({
            $schema: "https://ui.shadcn.com/schema/registry-item.json",
            name: recipe.id, type: "registry:block",
            dependencies: [...options.dependencies ?? [], ...native],
            files: sources.map(source => ({
              path: source.name, type: "registry:file", target: `src/components/${recipe.id}/${source.name}`,
              content: source.content,
            })),
          }, null, 2) + "\n",
        });
      }
    },
  });
}
