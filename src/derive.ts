import { createDesign } from "./index.js";
import { fail, tokenId } from "./model.js";
import type { Context, DesignConfig, Token, Tokens, Variant } from "./model.js";
import { contextOptions } from "./tokens.js";

type Derivation =
  | { source: string; type: "number"; factor: number }
  | { source: string; type: "dimension"; factor: number; unit?: "px" | "rem"; rootFontSizePx?: number };

/** Materialize derived roles across the source design's contexts before native output. */
export async function deriveDesign(config: DesignConfig, derivations: Readonly<Record<string, Derivation>>): Promise<DesignConfig> {
  const design = await createDesign(config);
  const count = Object.values(design.contexts).reduce((n, axis) => n * axis.values.length, 1);
  if (count > 256) fail("contract.limit", "Derived tokens exceed the context verification budget.");
  for (const [id, rule] of Object.entries(derivations)) {
    if (!tokenId.test(id) || design.tokens.get(id)) fail("mapping.conflict", `Invalid or existing derived token "${id}".`, id);
    if (!Number.isFinite(rule.factor)) fail("mapping.factor", "Expected a finite scale factor.", id);
  }
  function evaluate(context: Context): Tokens {
    const result = new Map<string, Token>();
    for (const [id, rule] of Object.entries(derivations)) {
      const source = design.tokens.resolve(rule.source, context);
      if (source.type !== rule.type) fail("mapping.type", `Expected "${rule.source}" to have type ${rule.type}.`, id);
      let value: string | number;
      if (rule.type === "number") {
        value = Number(source.value) * rule.factor;
        if (!Number.isFinite(value)) fail("mapping.value", "Derived number exceeds numeric range.", id);
      } else {
        const match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(px|rem)$/.exec(String(source.value));
        if (!match) fail("mapping.unit", "Derived lengths require a literal px or rem value.", id);
        const unit = rule.unit ?? match[2];
        let n = Number(match[1]) * rule.factor;
        if (unit !== match[2]) {
          const basis = rule.rootFontSizePx;
          if (!basis || !Number.isFinite(basis) || basis <= 0) fail("mapping.unit", "Supply rootFontSizePx for px/rem conversion.", id);
          n = unit === "px" ? n * basis : n / basis;
        }
        if (!Number.isFinite(n)) fail("mapping.value", "Derived length exceeds numeric range.", id);
        value = String(n) + unit;
      }
      result.set(id, { type: rule.type, value, extensions: { "dev.lenso.derive": rule } });
    }
    return Object.fromEntries(result);
  }
  const base = evaluate({});
  const variants: Variant[] = [...config.variants ?? []];
  for (const when of contextOptions(design.contexts)) {
    const changed = Object.entries(evaluate(when)).filter(([id, entry]) => entry.value !== base[id].value);
    if (changed.length) variants.push({ when, tokens: Object.fromEntries(changed) });
  }
  return { ...config, tokens: { ...config.tokens, ...base }, variants };
}
