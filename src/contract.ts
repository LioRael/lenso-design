import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { fail } from "./model.js";
import type { DesignConfig } from "./model.js";

export type ContractOperation = "inspect" | "resolve" | "query" | "check";
export type ContractInput = {
  readonly id?: string;
  readonly task?: string;
  readonly appearance?: string;
  readonly context?: Readonly<Record<string, string>>;
};
type ContractResult = { readonly ok: boolean } & Readonly<Record<string, unknown>>;
export type DesignContract = { readonly $schema?: string } & Required<Pick<DesignConfig, "contractVersion" | "tokens">> &
  Pick<DesignConfig, "dimensions" | "variants" | "components" | "patterns" | "policies" | "capabilities" | "profiles" | "mappings" | "usages">;

type Exports = {
  memory: WebAssembly.Memory;
  design_input(length: number): number;
  design_run(): number;
  design_output(): number;
};

async function loadKernel() {
  const module = await WebAssembly.compile(await readFile(new URL("./design.wasm", import.meta.url)));
  const imports: WebAssembly.Imports = Object.create(null);
  for (const entry of WebAssembly.Module.imports(module)) {
    imports[entry.module] ??= Object.create(null);
    imports[entry.module][entry.name] = () => { throw new Error("Unexpected Extism host call in the standalone Design kernel."); };
  }
  const { exports } = await WebAssembly.instantiate(module, imports);
  return exports as Exports;
}

let kernel: Promise<Exports> | undefined;

export async function runDesignContract(
  config: string | null,
  operation: ContractOperation,
  input: ContractInput = {},
): Promise<ContractResult> {
  const request = Buffer.from(JSON.stringify({ config, operation, input }));
  const wasm = await (kernel ??= loadKernel());
  const address = wasm.design_input(request.length);
  if (address === 0) {
    return { ok: false, diagnostics: [{ code: "request.size", severity: "error", message: "The request exceeds 2 MiB." }] };
  }
  new Uint8Array(wasm.memory.buffer, address, request.length).set(request);
  const length = wasm.design_run();
  return JSON.parse(Buffer.from(wasm.memory.buffer, wasm.design_output(), length).toString("utf8"));
}

export async function readDesignContract(path: URL | string = "design.json"): Promise<DesignContract> {
  const text = await readFile(path, "utf8");
  const result = await runDesignContract(text, "check");
  if (!result.ok) fail("contract.invalid", `Design contract failed validation: ${JSON.stringify(result.diagnostics)}`, String(path));
  return JSON.parse(text);
}
