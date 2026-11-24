export type TokenType =
  | "color" | "dimension" | "duration" | "number"
  | "fontFamily" | "fontWeight" | "cubicBezier" | "string";

export type Reference = { readonly ref: string };
export type TokenValue = string | number | Reference;
export type Token = {
  readonly type: TokenType;
  readonly value: TokenValue;
  readonly description?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
};
export type Tokens = Readonly<Record<string, Token>>;
export type Context = Readonly<Record<string, string>>;
export type Variant = { readonly when: Context; readonly tokens: Tokens };
export type TokenSet = {
  readonly tokens: Tokens;
  readonly variants?: readonly Variant[];
};
export type Dimensions = Readonly<Record<string, {
  readonly default: string;
  readonly values: readonly string[];
}>>;
export type Profile = {
  readonly id: string;
  readonly version: string;
  readonly roles: Readonly<Record<string, { type: TokenType; optional?: boolean }>>;
};
export type Preset = TokenSet & {
  readonly id: string;
  readonly dimensions?: Dimensions;
  readonly profiles?: readonly Profile[];
};
export type Mapping = {
  readonly id: string;
  readonly roles: Readonly<Record<string, string>>;
};
export type Component = {
  readonly id: string;
  readonly import: string;
  readonly export: string;
  readonly description?: string;
  readonly roles?: readonly string[];
};
export type Pattern = {
  readonly id: string;
  readonly description: string;
  readonly components: readonly string[];
};
export type Policy = {
  readonly id: string;
  readonly description: string;
};
export type ResolvedToken = Omit<Token, "value"> & {
  readonly id: string;
  readonly value: string | number;
  readonly source: string;
  readonly valueSource: string;
  readonly path: readonly string[];
};
export type Diagnostic = {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly path?: string;
  readonly context?: Context;
};
export type TokenUsage = {
  readonly token: string;
  readonly styling: "css" | "tailwind" | "stylex";
  readonly path: string;
  readonly reference: string;
};

export type Artifact = { readonly path: string; readonly content: string };
export type ArtifactCheck = (artifact: (path: string) => Artifact | undefined) => void | Promise<void>;
export type Source = {
  readonly name: string;
  load(ctx: { read(path: string): Promise<string> }): TokenSet | Promise<TokenSet>;
};
export type DesignConfig = {
  readonly contractVersion?: 1;
  readonly dimensions?: Dimensions;
  readonly tokens?: Tokens;
  readonly variants?: readonly Variant[];
  readonly presets?: readonly Preset[];
  readonly profiles?: readonly Profile[];
  readonly sources?: readonly Source[];
  readonly mappings?: readonly Mapping[];
  readonly capabilities?: readonly string[];
  readonly components?: readonly Component[];
  readonly patterns?: readonly Pattern[];
  readonly policies?: readonly Policy[];
  readonly integrations?: readonly Integration[];
};

export type TokenReader = {
  list(): string[];
  get(id: string, context?: Context): Token | undefined;
  resolve(id: string, context?: Context): ResolvedToken;
  resolveAll(context?: Context): ResolvedToken[];
};
export type DesignContext = {
  readonly tokens: TokenReader;
  readonly contexts: Dimensions;
  readonly profiles: readonly Profile[];
  readonly components: readonly Component[];
  readonly mappings: readonly Mapping[];
  readonly capabilities: readonly string[];
};
export type Integration = {
  readonly name: string;
  generate(ctx: DesignContext & {
    emit(artifact: Artifact): void;
    report(diagnostic: Diagnostic): void;
    usage(entry: TokenUsage): void;
    read(path: string): Promise<string>;
    verify(check: ArtifactCheck): void;
  }): void | Promise<void>;
};

export const defineDesign = (config: DesignConfig) => config;
export const definePreset = (preset: Preset) => preset;
export const defineProfile = (profile: Profile) => profile;
export const defineMapping = (mapping: Mapping) => mapping;
export const defineSource = (source: Source) => source;
export const defineIntegration = (integration: Integration) => integration;
export const defineComponentDesign = (component: Component) => component;
export const token = (ref: string): Reference => ({ ref });
export const color = (value: TokenValue): Token => ({ type: "color", value });
export const dimension = (value: TokenValue): Token => ({ type: "dimension", value });

export class DesignError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = "DesignError";
  }
}

export function fail(code: string, message: string, path?: string): never {
  throw new DesignError({ code, message, path, severity: "error" });
}

export const own = <T>(record: Readonly<Record<string, T>>, key: string) =>
  Object.hasOwn(record, key) ? record[key] : undefined;

export const tokenId = /^(?:[^.{}$\x00-\x1f]+\.)*(?:[^.{}$\x00-\x1f]+|\$root)$/u;
export const cssIdent = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
