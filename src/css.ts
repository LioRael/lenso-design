import postcss from "postcss";
import { cssIdent, defineIntegration, defineSource, fail, own, token } from "./model.js";
import type { Context, DesignContext, Token, Tokens, TokenType } from "./model.js";

export type ThemeScope = { readonly selector: string; readonly context: Context };

export type CssOptions = {
  readonly output?: string;
  readonly prefix?: string;
  readonly selector?: string;
  readonly layer?: string;
  readonly themes?: readonly ThemeScope[];
};

export function variableName(id: string, prefix = "ds"): string {
  const name = [prefix, id.replaceAll(".", "-").replaceAll("$root", "root")].filter(Boolean).join("-");
  if (!cssIdent.test(name)) fail("css.name", `"${id}" cannot be emitted as a CSS variable.`, id);
  return `--${name}`;
}

export function cssValue(value: string | number, path: string): string {
  const text = String(value);
  try {
    const nodes = postcss.parse(`a { --value: ${text}; }`).nodes;
    const rule = nodes[0];
    if (nodes.length === 1 && rule.type === "rule" && rule.nodes.length === 1 &&
        rule.nodes[0].type === "decl" && !rule.nodes[0].important &&
        rule.nodes[0].value === text) return text;
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "CssSyntaxError") throw error;
  }
  fail("css.value", `"${path}" cannot be emitted as one CSS declaration value.`, path);
}

export function cssRule(selector: string, declarations: readonly string[]) {
  if (!selector.trim() || selector.startsWith("@") || /[{};\n\r]/.test(selector)) {
    fail("css.selector", `Invalid CSS rule selector "${selector}".`, selector);
  }
  return `${selector} {\n${declarations.map(line => `  ${line}\n`).join("")}}\n`;
}

export function variableNames(design: DesignContext, prefix?: string) {
  const names = new Map<string, string>();
  const owners = new Map<string, string>();
  for (const id of design.tokens.list()) {
    const name = variableName(id, prefix);
    const previous = owners.get(name);
    if (previous) {
      fail("css.collision", `"${previous}" and "${id}" both generate ${name}.`, id);
    }
    owners.set(name, id);
    names.set(id, name);
  }
  return names;
}

export function css(options: CssOptions = {}) {
  return defineIntegration({
    name: "css",
    generate(ctx) {
      const names = variableNames(ctx, options.prefix);
      const scopes = [
        { selector: options.selector ?? ":root", context: {} },
        ...options.themes ?? [],
      ];
      const output = scopes.map(({ selector, context }) => cssRule(selector,
        ctx.tokens.resolveAll(context).map(({ id, value }) => `${names.get(id)}: ${cssValue(value, id)};`),
      )).join("\n");

      const layer = options.layer;
      if (layer !== undefined && !cssIdent.test(layer)) fail("css.layer", `Invalid CSS layer "${layer}".`);
      const content = layer === undefined ? output
        : `@layer ${layer} {\n${output.replace(/^.+/gm, line => `  ${line}`)}}\n`;
      const path = options.output ?? "generated/tokens.css";
      ctx.emit({ path, content });
      for (const [id, name] of names) {
        ctx.usage({ token: id, styling: "css", path, reference: `var(${name})` });
      }
    },
  });
}

type CssSourceOptions = {
  readonly selector?: string;
  readonly themes?: readonly ThemeScope[];
  readonly types?: Readonly<Record<string, TokenType>>;
};

export function cssSource(path: string, options: CssSourceOptions = {}) {
  return defineSource({
    name: path,
    async load(ctx) {
      const root = postcss.parse(await ctx.read(path), { from: path });
      function read(selector: string, base?: Tokens) {
        const entries = new Map<string, Token>();
        root.walkRules(rule => {
          if (rule.selector !== selector) return;
          for (let parent = rule.parent; parent && parent !== root; parent = parent.parent) {
            if (parent.type !== "atrule" || parent.name !== "layer") {
              fail("css.source-scope", `Cannot statically import "${selector}" under ${parent.type}.`, path);
            }
          }

          for (const declaration of rule.nodes) {
            if (declaration.type !== "decl" || !declaration.prop.startsWith("--")) continue;
            const id = declaration.prop.slice(2);
            if (declaration.important || entries.has(id)) {
              fail("css.source-cascade", `Ambiguous declaration "${declaration.prop}" in "${selector}".`, path);
            }
            const type = own(options.types ?? {}, id) ?? (base && own(base, id)?.type) ?? "string";
            const value = declaration.value;
            const alias = /^var\(\s*--([\w-]+)\s*\)$/.exec(value);
            entries.set(id, { type, value: alias ? token(alias[1]) : cssValue(value, id) });
          }
        });
        if (entries.size === 0) fail("css.source-empty", `No custom properties in "${selector}".`, path);
        return Object.fromEntries(entries);
      }

      const tokens = read(options.selector ?? ":root");
      const variants = options.themes?.map(({ selector, context }) => ({ when: context, tokens: read(selector, tokens) }));
      return { tokens, variants };
    },
  });
}
