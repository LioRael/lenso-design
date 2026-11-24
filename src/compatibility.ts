import { DesignError, own } from "./model.js";
import type { Context, DesignContext, Diagnostic, TokenType } from "./model.js";
import { contextOptions } from "./tokens.js";

export type Requirement = {
  readonly role: string;
  readonly type: TokenType;
  readonly optional?: boolean;
  readonly fallback?: string;
};

export type CompatibilityRequest = {
  readonly requirements: readonly Requirement[];
  readonly mapping?: string;
  readonly contexts?: readonly Context[];
  readonly capabilities?: readonly { id: string; fallback?: string }[];
};

export function checkCompatibility(design: DesignContext, request: CompatibilityRequest) {
  const diagnostics: Diagnostic[] = [];
  const bindings: Record<string, string> = Object.create(null);
  const mapping = request.mapping === undefined
    ? undefined
    : design.mappings.find(({ id }) => id === request.mapping);

  if (request.mapping !== undefined && !mapping) {
    diagnostics.push({ code: "mapping.unknown", severity: "error", message: `Unknown mapping "${request.mapping}".` });
    return { status: "unknown" as const, bindings, diagnostics };
  }

  const contexts = request.contexts?.length ? request.contexts : [...contextOptions(design.contexts)];
  for (const { role, type, optional, fallback } of request.requirements) {
    const candidate = mapping ? own(mapping.roles, role) : role;
    const matches = (id: string | undefined) => id !== undefined && contexts.every(context => {
      try {
        return design.tokens.resolve(id, context).type === type;
      } catch (error) {
        if (!(error instanceof DesignError) || error.diagnostic.code === "context.unknown") throw error;
        return false;
      }
    });

    if (candidate !== undefined && matches(candidate)) {
      bindings[role] = candidate;
    } else if (fallback !== undefined && matches(fallback)) {
      bindings[role] = fallback;
      diagnostics.push({
        code: "mapping.fallback", severity: "warning", path: role,
        message: `Using "${fallback}" for "${role}" in the requested contexts.`,
      });
    } else {
      diagnostics.push({
        code: "mapping.unsatisfied", severity: optional ? "warning" : "error", path: role,
        message: `"${role}" requires a resolvable ${type} token in every requested context.`,
      });
    }
  }

  for (const { id, fallback } of request.capabilities ?? []) {
    if (design.capabilities.includes(id)) continue;
    const hasFallback = fallback !== undefined && design.capabilities.includes(fallback);
    diagnostics.push({
      code: hasFallback ? "capability.fallback" : "capability.missing",
      severity: hasFallback ? "warning" : "error",
      path: id,
      message: hasFallback ? `Using capability "${fallback}" for "${id}".` : `Missing capability "${id}".`,
    });
  }

  const status = diagnostics.some(({ severity }) => severity === "error") ? "unsupported"
    : diagnostics.some(({ code }) => code.endsWith(".fallback")) ? "compatible-with-fallback"
    : "compatible";
  return { status, bindings, diagnostics };
}
