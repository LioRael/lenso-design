import { join } from "node:path";
import postcss from "postcss";
import { checkCompatibility } from "./compatibility.js";
import type { CompatibilityRequest, Requirement } from "./compatibility.js";
import { cssIdent, defineIntegration, DesignError, fail } from "./model.js";
import { variableNames } from "./css.js";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type Stylesheet = { readonly source: string } | { readonly artifact: string };

function readRootVariables(content: string, path: string, variables: Map<string, string[]>) {
  try {
    postcss.parse(content, { from: path }).walkRules(rule => {
      if (rule.selector.trim() !== ":root") return;
      for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
        if (parent.type !== "atrule" || parent.name !== "layer") return;
      }
      for (const node of rule.nodes) {
        if (node.type !== "decl" || !node.prop.startsWith("--")) continue;
        const values = variables.get(node.prop) ?? [];
        values.push(node.value.trim());
        variables.set(node.prop, values);
      }
    });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "CssSyntaxError") throw error;
    fail("shadcn.stylesheet", `Cannot verify an invalid target stylesheet "${path}".`, path);
  }
}

function hasRootVariable(variables: Map<string, string[]>, name: string, seen: readonly string[] = []): boolean {
  const values = variables.get(name);
  return !seen.includes(name) && values !== undefined && values.every(value => {
    const alias = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(value);
    if (alias) return hasRootVariable(variables, alias[1], [...seen, name]);
    return value !== "" && !/^(initial|inherit|unset|revert|revert-layer)$/i.test(value) && !/\bvar\s*\(/i.test(value);
  });
}

export function shadcn(options: {
  readonly output?: string;
  readonly items: readonly {
    readonly item: unknown;
    readonly selector: string;
    readonly requirements: readonly (Requirement & { variable: string })[];
    readonly capabilities?: CompatibilityRequest["capabilities"];
  }[];
  readonly targets: readonly {
    readonly id: string;
    readonly mapping?: string;
    readonly prefix?: string;
    readonly contexts?: CompatibilityRequest["contexts"];
    readonly stylesheets?: readonly Stylesheet[];
  }[];
}) {
  return defineIntegration({
    name: "shadcn",
    generate(ctx) {
      const bindings = new Map<typeof options.targets[number], Set<string>>();
      ctx.verify(async artifact => {
        for (const [target, required] of bindings) {
          const variables = new Map<string, string[]>();
          for (const stylesheet of target.stylesheets ?? []) {
            if ("artifact" in stylesheet) {
              const file = artifact(stylesheet.artifact);
              if (!file) fail("shadcn.stylesheet", `Target "${target.id}" expects generated stylesheet "${stylesheet.artifact}".`, stylesheet.artifact);
              readRootVariables(file.content, file.path, variables);
            } else {
              let content: string;
              try {
                content = await ctx.read(stylesheet.source);
              } catch (error) {
                if (error instanceof DesignError) throw error;
                fail("shadcn.stylesheet", `Cannot read target "${target.id}" stylesheet "${stylesheet.source}".`, stylesheet.source);
              }
              readRootVariables(content, stylesheet.source, variables);
            }
          }
          for (const variable of required) {
            if (!hasRootVariable(variables, variable)) ctx.report({
              code: "shadcn.target-variable", severity: "error", path: variable,
              message: `Target "${target.id}" maps to ${variable}, but its declared stylesheets do not provide a verifiable :root value.`,
            });
          }
        }
      });
      for (const { item, selector, requirements, capabilities } of options.items) {
        if (!object(item) || typeof item.name !== "string" || !cssIdent.test(item.name) ||
            (item.type !== "registry:component" && item.type !== "registry:ui" && item.type !== "registry:block") ||
            !Array.isArray(item.files) || !item.files.length ||
            !item.files.every(file => object(file) && typeof file.content === "string" && typeof file.path === "string") ||
            (item.css !== undefined && !object(item.css))) {
          fail("shadcn.item", "Expected a built shadcn UI, component, or block item with inline files.");
        }
        // The bridge must remain local to a component wrapper.
        if (!/^\.[a-zA-Z_][a-zA-Z0-9_-]*$/.test(selector)) {
          fail("shadcn.selector", "Use one scoped component class for the bridge.", selector);
        }
        const names = new Set<string>();
        for (const { variable } of requirements) {
          if (!variable.startsWith("--") || !cssIdent.test(variable.slice(2)) || names.has(variable)) {
            fail("shadcn.variable", `Invalid or duplicate bridge variable "${variable}".`, variable);
          }
          names.add(variable);
        }

        const css = item.css ?? {};
        const existing = Object.hasOwn(css, selector) ? css[selector] : undefined;
        if (existing !== undefined && !object(existing)) {
          fail("shadcn.css-conflict", `Existing CSS for "${selector}" cannot be merged.`, selector);
        }

        for (const targetOptions of options.targets) {
          const { id, mapping, prefix, contexts } = targetOptions;
          if (!cssIdent.test(id)) fail("shadcn.target", `Invalid target "${id}".`, id);
          const report = checkCompatibility(ctx, { requirements, mapping, contexts, capabilities });
          for (const diagnostic of report.diagnostics) {
            ctx.report({ ...diagnostic, message: `${item.name} → ${id}: ${diagnostic.message}` });
          }
          if (report.status === "unsupported" || report.status === "unknown") continue;
          if (report.diagnostics.some(({ code }) => code === "capability.fallback")) {
            fail("shadcn.capability", "Capability fallbacks require an explicit component variant.", id);
          }

          const variables = variableNames(ctx, prefix);
          const required = bindings.get(targetOptions) ?? new Set<string>();
          const bridge = new Map<string, string>();
          for (const { role, variable } of requirements) {
            const target = variables.get(report.bindings[role]);
            if (target === undefined) continue;
            required.add(target);
            if (target === variable) continue;
            if ((existing && Object.hasOwn(existing, variable)) || names.has(target)) {
              fail("shadcn.css-conflict", `Bridge "${variable}" conflicts with a scoped variable at "${selector}".`, selector);
            }
            bridge.set(variable, `var(${target})`);
          }
          if (required.size > 0) bindings.set(targetOptions, required);

          ctx.emit({
            path: join(options.output ?? "generated/registry", id, `${item.name}.json`),
            content: JSON.stringify({
              ...item,
              css: { ...css, [selector]: { ...existing, ...Object.fromEntries(bridge) } },
            }, null, 2) + "\n",
          });
        }
      }
    },
  });
}
