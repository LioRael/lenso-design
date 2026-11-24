import { defineIntegration, defineSource, fail, token, tokenId } from "./model.js";
import type { Context, Token, Tokens, TokenType } from "./model.js";
import { cssValue } from "./css.js";

const types = new Set<string>(["color", "dimension", "duration", "number", "fontFamily", "fontWeight", "cubicBezier"]);
const colorSpaces = new Set([
  "srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020",
  "xyz-d50", "xyz-d65", "hsl", "hwb", "lab", "lch", "oklab", "oklch",
]);
const originalValues = new WeakMap<Token, unknown>();
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function importValue(type: string, value: unknown, id: string): string | number {
  if (type === "color" && object(value)) {
    const { colorSpace, components, alpha = 1 } = value;
    if (typeof colorSpace === "string" && colorSpaces.has(colorSpace) && Array.isArray(components) &&
        components.length === 3 && components.every(channel => channel === "none" || finite(channel)) &&
        finite(alpha) && alpha >= 0 && alpha <= 1) {
      const channels = ["hsl", "hwb"].includes(colorSpace)
        ? components.map((channel, index) => channel === "none" || index === 0 ? channel : `${channel}%`)
        : components;
      const slash = alpha === 1 ? "" : ` / ${alpha}`;
      return ["hsl", "hwb", "lab", "lch", "oklab", "oklch"].includes(colorSpace)
        ? `${colorSpace}(${channels.join(" ")}${slash})`
        : `color(${colorSpace} ${channels.join(" ")}${slash})`;
    }
  }
  if ((type === "dimension" || type === "duration") && object(value) && finite(value.value)) {
    const units = type === "dimension" ? ["px", "rem"] : ["ms", "s"];
    if (typeof value.unit === "string" && units.includes(value.unit) &&
        (type !== "duration" || value.value >= 0)) return `${value.value}${value.unit}`;
  }
  if ((type === "number" || type === "fontWeight") && finite(value)) return value;
  if (type === "fontWeight" && typeof value === "string") {
    const weights = new Map(Object.entries({
      thin: 100, hairline: 100, "extra-light": 200, "ultra-light": 200, light: 300, normal: 400,
      regular: 400, book: 400, medium: 500, "semi-bold": 600, "demi-bold": 600,
      bold: 700, "extra-bold": 800, "ultra-bold": 800, black: 900, heavy: 900,
      "extra-black": 950, "ultra-black": 950,
    }));
    const weight = weights.get(value);
    if (weight !== undefined) return weight;
  }
  if (type === "fontFamily") {
    const names = typeof value === "string" ? [value] : value;
    if (Array.isArray(names) && names.length && names.every(name =>
      typeof name === "string" && name.trim() && !/[\u0000-\u001f]/.test(name),
    )) {
      const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|fangsong)$/;
      return names.map(name => generic.test(name) ? name : JSON.stringify(name)).join(", ");
    }
  }
  if (type === "cubicBezier" && Array.isArray(value) && value.length === 4 && value.every(finite) &&
      [value[0], value[2]].every(x => x >= 0 && x <= 1)) return `cubic-bezier(${value.join(", ")})`;
  fail("dtcg.value", `Invalid or unsupported DTCG ${type} value at "${id}".`, id);
}

export function parseDtcg(tree: unknown): Tokens {
  const entries = new Map<string, {
    node: Record<string, unknown>;
    inherited: unknown;
    alias?: string;
  }>();

  function visit(node: unknown, path: string[], inherited?: unknown) {
    const id = path.join(".");
    if (!object(node)) fail("dtcg.shape", `Expected an object at "${id || "$"}".`, id);
    if (Object.hasOwn(node, "$extends") || Object.hasOwn(node, "$ref")) {
      fail("dtcg.unsupported", `Group inheritance and JSON Pointer references are unsupported at "${id || "$"}".`, id);
    }
    if (Object.hasOwn(node, "$value")) {
      if (!tokenId.test(id) || Object.keys(node).some(key => !key.startsWith("$"))) {
        fail("dtcg.shape", `Invalid token at "${id}".`, id);
      }
      const alias = typeof node.$value === "string" ? /^\{([^{}]+)\}$/.exec(node.$value)?.[1] : undefined;
      entries.set(id, { node, inherited, alias });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$") && key !== "$root") continue;
      if (key.includes(".") || !tokenId.test(key) || (key === "$root" && (!object(child) || !Object.hasOwn(child, "$value")))) {
        fail("dtcg.name", `Invalid DTCG name "${key}".`, id);
      }
      visit(child, [...path, key], node.$type ?? inherited);
    }
  }
  visit(tree, []);

  const definitions = new Map<string, Token>();
  const visiting = new Set<string>();

  function load(id: string): Token {
    const cached = definitions.get(id);
    if (cached) return cached;
    const entry = entries.get(id);
    if (!entry) fail("dtcg.reference", `Unknown DTCG reference "${id}". Declare $type for aliases across sources.`, id);
    if (visiting.has(id)) fail("token.cycle", `Circular DTCG reference: ${[...visiting, id].join(" → ")}.`, id);
    const { node, inherited, alias } = entry;
    visiting.add(id);
    const type = Object.hasOwn(node, "$type") ? node.$type : alias ? load(alias).type : inherited;
    visiting.delete(id);
    if (typeof type !== "string" || !types.has(type)) {
      fail("dtcg.type", `Unsupported or missing DTCG token type at "${id}".`, id);
    }
    const description = node.$description;
    const extensions = node.$extensions;
    if ((description !== undefined && typeof description !== "string") ||
        (extensions !== undefined && !object(extensions))) fail("dtcg.metadata", `Invalid metadata at "${id}".`, id);
    const definition: Token = {
      type: type as TokenType,
      value: alias ? token(alias) : importValue(type, node.$value, id),
      description,
      extensions,
    };
    if (!alias) originalValues.set(definition, node.$value);
    definitions.set(id, definition);
    return definition;
  }

  return Object.fromEntries([...entries.keys()].map(id => [id, load(id)]));
}

function exportValue(definition: Token, value: string | number, id: string): unknown {
  if (originalValues.has(definition)) return originalValues.get(definition);
  if (definition.type === "number" || definition.type === "fontWeight") return value;
  const text = String(value);
  if (definition.type === "dimension" || definition.type === "duration") {
    const units = definition.type === "dimension" ? "px|rem" : "ms|s";
    const match = new RegExp(`^(-?(?:\\d+\\.?\\d*|\\.\\d+))(${units})$`).exec(text);
    if (match) return { value: Number(match[1]), unit: match[2] };
    if (definition.type === "dimension" && text === "0") return { value: 0, unit: "px" };
  }
  if (definition.type === "color" && /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(text)) {
    const hex = text.slice(1);
    const bytes = hex.length < 5 ? [...hex].map(digit => digit.repeat(2)) : hex.match(/../g) ?? [];
    const [red, green, blue, alpha] = bytes.map(byte => parseInt(byte, 16) / 255);
    return { colorSpace: "srgb", components: [red, green, blue], ...(alpha === undefined ? {} : { alpha }) };
  }
  if (definition.type === "fontFamily") {
    const names = text.split(",").map(name => name.trim().replace(/^(['"])([^'"]+)\1$/, "$2"));
    if (names.every(name => /^[\w -]+$/.test(name))) return names.length === 1 ? names[0] : names;
  }
  if (definition.type === "cubicBezier") {
    const match = /^cubic-bezier\(([^)]+)\)$/.exec(text);
    const values = match?.[1].split(",").map(Number);
    if (values?.length === 4 && values.every(finite) && [values[0], values[2]].every(x => x >= 0 && x <= 1)) return values;
  }
  fail("dtcg.export", `Token "${id}" cannot be represented by the supported DTCG types.`, id);
}

export { resolveDtcg } from "./resolver.js";

export const dtcg = {
  resolver(path: string, context: Context = {}) {
    return defineSource({
      name: path,
      async load({ read }) {
        const { resolveDtcg, formatResolvedValue } = await import("./resolver.js");
        const result = await resolveDtcg(path, read, context);
        const tokens = new Map<string, Token>();
        for (const entry of result.tokens.values()) {
          if (!entry.type || !types.has(entry.type)) fail("dtcg.type", `Cannot project DTCG "${entry.type}" token "${entry.id}" into the scalar Design contract.`, entry.id);
          const value = formatResolvedValue(entry.type, entry.value);
          const alias = typeof entry.raw === "string" && /^\{([^{}]+)\}$/.exec(entry.raw);
          const definition: Token = {
            type: entry.type as TokenType, description: entry.description, extensions: entry.extensions,
            value: alias ? token(alias[1]) : importValue(entry.type, value, entry.id),
          };
          if (!alias) originalValues.set(definition, value);
          tokens.set(entry.id, definition);
        }
        return { tokens: Object.fromEntries(tokens) };
      },
    });
  },
  source(path: string) {
    return defineSource({
      name: path,
      async load(ctx) {
        let tree: unknown;
        try {
          tree = JSON.parse(await ctx.read(path));
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          fail("dtcg.json", `Invalid JSON in "${path}".`, path);
        }
        return { tokens: parseDtcg(tree) };
      },
    });
  },
  output(options: { file?: string; context?: Context; preserveReferences?: boolean } = {}) {
    return defineIntegration({
      name: "dtcg",
      generate(ctx) {
        const tree: Record<string, unknown> = Object.create(null);
        for (const entry of ctx.tokens.resolveAll(options.context)) {
          const { id, type, path, value, description, extensions } = entry;
          if (!types.has(type)) fail("dtcg.export", `Unsupported DTCG type "${type}" at "${id}".`, id);
          let parent = tree;
          for (const segment of id.split(".").slice(0, -1)) {
            parent[segment] ??= Object.create(null);
            const group = parent[segment];
            if (!object(group) || Object.hasOwn(group, "$value")) fail("dtcg.path", `Token and group collide at "${id}".`, id);
            parent = group;
          }
          const key = id.split(".").at(-1)!;
          if (Object.hasOwn(parent, key)) fail("dtcg.path", `Token and group collide at "${id}".`, id);
          const leaf = path.at(-1) ?? id;
          const definition = ctx.tokens.get(leaf, options.context);
          if (!definition) fail("token.missing", `Missing token "${leaf}".`, leaf);
          parent[key] = {
            $type: type,
            $value: options.preserveReferences !== false && path.length > 1
              ? `{${path[1]}}`
              : exportValue(definition, typeof value === "string" ? cssValue(value, id) : value, id),
            $description: description,
            $extensions: extensions,
          };
        }
        ctx.emit({ path: options.file ?? "generated/design.tokens.json", content: JSON.stringify(tree, null, 2) + "\n" });
      },
    });
  },
};
