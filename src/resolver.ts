import { colorToDtcg, createResolver, DiagnosticBag, modifiersOf, systemFromResolver, validateInput } from "@dsgraph/core";
import type { ColorValue } from "@dsgraph/core";
import type { Context } from "./model.js";
import { fail } from "./model.js";

/** Resolve one DTCG 2025.10 permutation. The caller owns the project file reader. */
export async function resolveDtcg(path: string, read: (file: string) => Promise<string>, context: Context = {}) {
  const diagnostics = new DiagnosticBag();
  const readJson = async (file: string) => JSON.parse(await read(file));
  const system = await systemFromResolver(await readJson(path), path, readJson, diagnostics);
  const input = validateInput(modifiersOf(system), context, diagnostics);
  const resolver = createResolver(system, { strict: true });
  const result = input && resolver.resolve(input, diagnostics);
  diagnostics.merge(resolver.parseDiagnostics);
  if (!result || diagnostics.hasErrors()) fail("dtcg.resolver", JSON.stringify(diagnostics.list()), path);
  return { ...result, diagnostics: diagnostics.list() };
}

export function formatResolvedValue(type: string, value: unknown) {
  return type === "color" ? colorToDtcg(value as ColorValue) : value;
}
