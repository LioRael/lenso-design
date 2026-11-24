import { lexer } from "css-tree";
import { fail, own, tokenId } from "./model.js";
import type { Context, Dimensions, ResolvedToken, Token, TokenSet } from "./model.js";

type NamedSet = TokenSet & { name: string };
type Entry = { token: Token; source: string };

export function normalizeContext(dimensions: Dimensions, selected: Context = {}): Context {
  for (const [name, value] of Object.entries(selected)) {
    if (!own(dimensions, name)?.values.includes(value)) {
      fail("context.unknown", `Unknown context ${name}=${value}.`, name);
    }
  }
  return Object.fromEntries(Object.entries(dimensions).map(([name, dimension]) =>
    [name, own(selected, name) ?? dimension.default],
  ));
}

export function* contextOptions(dimensions: Dimensions): Generator<Context> {
  const axes = Object.entries(dimensions);

  function* combinations(index: number, context: Context): Generator<Context> {
    const axis = axes[index];
    if (!axis) {
      yield context;
      return;
    }
    const [name, dimension] = axis;
    for (const value of dimension.values) {
      yield* combinations(index + 1, { ...context, [name]: value });
    }
  }

  yield* combinations(0, {});
}

function validateToken(id: string, definition: Token) {
  if (!tokenId.test(id)) fail("token.id", `Invalid token ID "${id}".`, id);
  const { value, type } = definition;
  if (typeof value === "object") {
    if (value && typeof value.ref === "string" && tokenId.test(value.ref)) return;
    fail("token.reference", `Invalid reference in "${id}".`, id);
  }

  const syntax = {
    color: "color",
    dimension: "length-percentage",
    duration: "time",
    cubicBezier: "cubic-bezier()",
  } as const;
  const valid = type === "number" ? typeof value === "number" && Number.isFinite(value)
    : type === "fontWeight" ? typeof value === "number" && value >= 1 && value <= 1000
    : typeof value === "string" && value.trim() !== "" && (
      type === "fontFamily" ? Boolean(lexer.matchProperty("font-family", value).matched)
        : type === "string" || (type in syntax && Boolean(lexer.matchType(syntax[type], value).matched))
    );
  if (!valid) fail("token.type", `Value of "${id}" does not match ${type}.`, id);
}

export function createTokenReader(sets: readonly NamedSet[], dimensions: Dimensions) {
  const base = new Map<string, Entry>();
  const overlays: { when: Context; specificity: number; entries: [string, Entry][] }[] = [];

  for (const set of sets) {
    for (const [id, definition] of Object.entries(set.tokens)) {
      validateToken(id, definition);
      const previous = base.get(id);
      if (previous && (set.name !== "project" || previous.token.type !== definition.type)) {
        fail("token.conflict", `"${id}" from ${set.name} conflicts with ${previous.source}.`, id);
      }
      base.set(id, { token: definition, source: set.name });
    }
  }

  for (const set of sets) {
    const variants: typeof overlays = [];
    for (const variant of set.variants ?? []) {
      normalizeContext(dimensions, variant.when);
      const conditions = Object.entries(variant.when);
      if (conditions.length === 0) {
        fail("context.empty", `Variant in ${set.name} must select a context.`);
      }
      const entries = Object.entries(variant.tokens).map(([id, definition]): [string, Entry] => {
        validateToken(id, definition);
        const original = base.get(id);
        if (!original || original.token.type !== definition.type) {
          fail("token.override", `Variant "${id}" must match an existing token type.`, id);
        }
        return [id, { token: definition, source: set.name }];
      });
      for (const previous of variants) {
        const overlaps = previous.specificity === conditions.length &&
          conditions.every(([axis, value]) => !Object.hasOwn(previous.when, axis) || previous.when[axis] === value);
        if (!overlaps) continue;
        const conflict = entries.find(([id]) => previous.entries.some(([other]) => id === other));
        if (conflict) {
          fail("context.conflict", `Equally specific variants in ${set.name} both override "${conflict[0]}".`, conflict[0]);
        }
      }
      variants.push({ when: variant.when, specificity: conditions.length, entries });
    }
    overlays.push(...variants);
  }
  overlays.sort((a, b) => a.specificity - b.specificity);

  const ids = [...base.keys()].sort();

  function select(context?: Context) {
    const selected = normalizeContext(dimensions, context);
    const entries = new Map(base);
    // More specific variants win. Declaration order breaks ties.
    const matches = overlays.filter(({ when }) =>
      Object.entries(when).every(([key, value]) => own(selected, key) === value),
    );
    for (const { entries: changes } of matches) {
      for (const [id, entry] of changes) entries.set(id, entry);
    }
    return entries;
  }

  function resolver(entries: Map<string, Entry>) {
    const cache = new Map<string, ResolvedToken>();
    const visiting = new Set<string>();

    function resolve(id: string): ResolvedToken {
      const cached = cache.get(id);
      if (cached) return cached;
      if (visiting.has(id)) {
        fail("token.cycle", `Circular reference: ${[...visiting, id].join(" → ")}.`, id);
      }
      const entry = entries.get(id);
      if (!entry) fail("token.missing", `Unknown token "${id}".`, id);
      const { value, ...definition } = entry.token;
      let path = [id];
      let valueSource = entry.source;
      let resolvedValue: ResolvedToken["value"];
      if (typeof value === "object") {
        visiting.add(id);
        try {
          const target = resolve(value.ref);
          if (target.type !== definition.type) {
            fail("token.alias-type", `"${id}" expects ${definition.type}, but "${target.id}" is ${target.type}.`, id);
          }
          path = [id, ...target.path];
          valueSource = target.valueSource;
          resolvedValue = target.value;
        } finally {
          visiting.delete(id);
        }
      } else {
        resolvedValue = value;
      }
      const resolved: ResolvedToken = { ...definition, id, value: resolvedValue, source: entry.source, valueSource, path };
      cache.set(id, resolved);
      return resolved;
    }

    return resolve;
  }

  return {
    list: () => [...ids],
    declarations: (context?: Context) => Object.fromEntries(Array.from(select(context), ([id, entry]) => [id, entry.token])),
    get: (id: string, context?: Context) => select(context).get(id)?.token,
    resolve: (id: string, context?: Context) => resolver(select(context))(id),
    resolveAll: (context?: Context) => ids.map(resolver(select(context))),
    inspect(context: Context, report: (error: unknown) => void) {
      const resolve = resolver(select(context));
      for (const id of ids) {
        try {
          resolve(id);
        } catch (error) {
          report(error);
        }
      }
    },
  };
}
