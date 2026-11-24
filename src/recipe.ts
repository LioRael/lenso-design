import { join } from "node:path";
import { cssRule, variableNames } from "./css.js";
import { cssIdent, defineIntegration, fail, own } from "./model.js";
import type { DesignContext, Reference } from "./model.js";

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

type Part = {
  base: Declarations;
  states?: Partial<Record<State, Declarations>>;
};

export type Recipe = Part & {
  id: string;
  parts?: Readonly<Record<string, Part>>;
};

export const defineRecipe = (recipe: Recipe) => recipe;

function compilePart(name: string, part: Part, recipeId: string, ctx: DesignContext, names: Map<string, string>) {
  const css: string[] = [];
  const classes: string[] = [];
  const stylex = new Map<string, Record<string, string | null>>();
  const rules = [["", part.base], ...Object.entries(part.states ?? {})] as const;
  for (const [state, declarations] of rules) {
    if (state && !["hover", "focus-visible", "disabled"].includes(state)) {
      fail("recipe.state", `Unsupported portable state "${state}".`, recipeId);
    }
    const lines: string[] = [];
    for (const [property, reference] of Object.entries(declarations)) {
      const definition = own(properties, property);
      if (!definition) fail("recipe.property", `Unsupported portable property "${property}".`, recipeId);
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
    if (lines.length) css.push(cssRule("." + name + (state ? ":" + state : ""), lines));
  }
  return { name, css, classes: classes.join(" "), stylex: Object.fromEntries(stylex) };
}

/** Emit interchangeable static class modules beside the same component source. */
export function portableRecipe(options: { recipe: Recipe; component: string; output: string; prefix?: string; dependencies?: readonly string[] }) {
  return defineIntegration({
    name: "portable-recipe",
    async generate(ctx) {
      const { recipe } = options;
      if (!cssIdent.test(recipe.id)) fail("recipe.id", "Expected a CSS identifier.", recipe.id);
      const names = variableNames(ctx, options.prefix);
      const compiled = [compilePart("root", recipe, recipe.id, ctx, names)];
      for (const [name, part] of Object.entries(recipe.parts ?? {})) {
        if (!/^[a-z][A-Za-z0-9]*$/.test(name) || name === "root" || name in Object.prototype) {
          fail("recipe.part", `Invalid or reserved part name "${name}".`, recipe.id);
        }
        compiled.push(compilePart(name, part, recipe.id, ctx, names));
      }
      function exportsFor(value: (part: typeof compiled[number]) => string) {
        const parts = compiled.slice(1).map(part => `  ${part.name}: ${value(part)}`);
        return `export const root = ${value(compiled[0])};\n` +
          (parts.length ? `export const parts = {\n${parts.join(",\n")}\n};\n` : "");
      }
      const styles = Object.fromEntries(compiled.map(part => [part.name, part.stylex]));
      const files = {
        "css-modules": 'import styles from "./recipe.module.css";\n' + exportsFor(part => `styles.${part.name}`),
        tailwind: exportsFor(part => JSON.stringify(part.classes)),
        stylex: 'import * as stylex from "@stylexjs/stylex";\n' +
          `const styles = stylex.create(${JSON.stringify(styles, null, 2)});\n` +
          exportsFor(part => `stylex.props(styles.${part.name}).className`),
      };
      const component = await ctx.read(options.component);
      for (const [target, content] of Object.entries(files)) {
        const folder = join(options.output, target, recipe.id);
        const sources = [
          { name: "index.tsx", content: component },
          { name: "recipe.ts", content },
        ];
        if (target === "css-modules") sources.push({ name: "recipe.module.css", content: compiled.flatMap(part => part.css).join("\n") });
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
