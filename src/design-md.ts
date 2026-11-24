import { parse, stringify } from "yaml";
import { defineIntegration, defineSource, fail } from "./model.js";
import type { Context, Token, Tokens } from "./model.js";

const categories = { colors: "color", spacing: "dimension", rounded: "dimension" } as const;
type Category = keyof typeof categories;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Read a front-matter DESIGN.md and retain unprojected metadata and prose. */
export function parseDesignMd(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) fail("design-md.frontmatter", "Expected a YAML front matter block.");
  const metadata: unknown = parse(match[1]);
  if (!record(metadata)) fail("design-md.frontmatter", "Expected an object in front matter.");
  const tokens: Record<string, Token> = Object.create(null);
  for (const category of Object.keys(categories) as Category[]) {
    const group = metadata[category];
    if (group === undefined) continue;
    if (!record(group)) fail("design-md.group", `Expected a token map in ${category}.`);
    for (const [name, value] of Object.entries(group)) {
      const id = category + "." + name;
      if (typeof value !== "string") fail("design-md.value", `Expected a string at ${id}.`, id);
      const reference = /^\{([^{}]+)\}$/.exec(value);
      tokens[id] = { type: categories[category], value: reference ? { ref: reference[1] } : value };
    }
  }
  return { metadata, prose: text.slice(match[0].length), tokens: tokens as Tokens };
}

export const designMd = {
  source(path: string) {
    return defineSource({ name: path, async load({ read }) { return { tokens: parseDesignMd(await read(path)).tokens }; } });
  },
  output(options: {
    file: string; name: string; template?: string; context?: Context;
    mapping: Partial<Record<Category, Record<string, string>>>;
  }) {
    return defineIntegration({
      name: "design-md",
      async generate(ctx) {
        const document = options.template ? parseDesignMd(await ctx.read(options.template)) : { metadata: {}, prose: "" };
        const metadata: Record<string, unknown> = { ...document.metadata, name: options.name };
        for (const category of Object.keys(categories) as Category[]) {
          const entries = options.mapping[category];
          if (!entries) continue;
          const previous = metadata[category];
          const group = Object.assign(Object.create(null), previous);
          for (const [name, id] of Object.entries(entries)) {
            const token = ctx.tokens.resolve(id, options.context);
            if (token.type !== categories[category]) fail("design-md.type", `Expected ${categories[category]} for ${id}.`, id);
            group[name] = token.value;
          }
          metadata[category] = group;
        }
        ctx.emit({ path: options.file, content: `---\n${stringify(metadata)}---\n${document.prose}` });
      },
    });
  },
};
