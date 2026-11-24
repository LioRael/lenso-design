import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { readDesignContract } from "./contract.js";
import { checkContrast } from "./policies.js";
import { checkCompatibility } from "./compatibility.js";
import type { CompatibilityRequest } from "./compatibility.js";
import { DesignError, fail, tokenId } from "./model.js";
import type { Artifact, ArtifactCheck, Context, DesignConfig, DesignContext, Diagnostic, Dimensions, TokenUsage } from "./model.js";
import { contextOptions, createTokenReader } from "./tokens.js";

export * from "./model.js";
export type { CompatibilityRequest, Requirement } from "./compatibility.js";

export async function loadDesign(configPath?: string) {
  let absolute: string;
  try {
    absolute = await realpath(resolve(configPath ?? "design.config.ts"));
  } catch (error) {
    if (configPath || !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    absolute = await realpath(resolve("design.config.mts"));
  }
  const config: DesignConfig | undefined = absolute.endsWith(".json")
    ? await readDesignContract(absolute) : (await import(pathToFileURL(absolute).href)).default;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    fail("config.export", `"${configPath}" must default-export a design configuration.`, configPath);
  }
  const root = dirname(absolute);
  return { ...await createDesign(config, { cwd: root }), root };
}

export function projectPath(root: string, path: string): string {
  const target = resolve(root, path);
  const local = relative(root, target);
  if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    fail("file.path", `Expected a file inside the project: "${path}".`, path);
  }
  return target;
}

function unique<T extends { id: string }>(kind: string, entries: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  for (const { id } of entries) {
    if (!id.trim() || seen.has(id)) fail(`${kind}.conflict`, `Duplicate ${kind} "${id}".`, id);
    seen.add(id);
  }
  return entries;
}

export async function createDesign(config: DesignConfig, options: { cwd?: string } = {}) {
  if (config.contractVersion !== undefined && config.contractVersion !== 1) {
    fail("contract.version", `Unsupported contract version "${config.contractVersion}".`);
  }
  const presets = unique("preset", config.presets ?? []);
  const axes = new Map<string, Dimensions[string]>();
  for (const dimensions of [...presets.map(preset => preset.dimensions), config.dimensions]) {
    for (const [id, dimension] of Object.entries(dimensions ?? {})) {
      const previous = axes.get(id);
      if (!tokenId.test(id) || dimension.values.includes("") || !dimension.values.includes(dimension.default) ||
          new Set(dimension.values).size !== dimension.values.length) {
        fail("context.definition", `Invalid dimension "${id}".`, id);
      }
      if (previous && (previous.default !== dimension.default ||
          previous.values.length !== dimension.values.length ||
          dimension.values.some(value => !previous.values.includes(value)))) {
        fail("context.conflict", `Conflicting definition for dimension "${id}".`, id);
      }
      axes.set(id, dimension);
    }
  }
  const contexts = Object.fromEntries(axes);

  const sources = config.sources ?? [];
  const root = resolve(options.cwd ?? process.cwd());
  let sourceRoot: Promise<string> | undefined;
  async function readProjectFile(path: string) {
    const directory = await (sourceRoot ??= realpath(root));
    const absolute = await realpath(projectPath(directory, path));
    return readFile(projectPath(directory, absolute), "utf8");
  }
  const loadedSources = await Promise.all(sources.map(async source => {
    const tokens = await source.load({ read: readProjectFile });
    return { ...tokens, name: `source:${source.name}` };
  }));
  const tokens = createTokenReader([
    ...presets.map(preset => ({ ...preset, name: `preset:${preset.id}` })),
    ...loadedSources,
    { name: "project", tokens: config.tokens ?? {}, variants: config.variants },
  ], contexts);

  const profiles = unique("profile", [...new Set([
    ...presets.flatMap(preset => preset.profiles ?? []), ...config.profiles ?? [],
  ])]);
  const components = unique("component", config.components ?? []);
  const patterns = unique("pattern", config.patterns ?? []);
  const policies = unique("policy", config.policies ?? []);
  const mappings = unique("mapping", config.mappings ?? []);
  const capabilities = config.capabilities ?? [];
  const design: DesignContext = { tokens, contexts, profiles, components, mappings, capabilities };

  function validate(): Diagnostic[] {
    const diagnostics = new Map<string, Diagnostic>();
    function report(diagnostic: Diagnostic) {
      diagnostics.set(JSON.stringify(diagnostic), diagnostic);
    }

    const roleTypes = new Map<string, string>();
    for (const profile of profiles) {
      for (const [id, role] of Object.entries(profile.roles)) {
        if (roleTypes.has(id) && roleTypes.get(id) !== role.type) {
          report({ code: "profile.conflict", severity: "error", path: id, message: `Profiles disagree on the type of "${id}".` });
        }
        roleTypes.set(id, role.type);
      }
    }
    for (const profile of profiles) {
      for (const [id, role] of Object.entries(profile.roles)) {
        const entry = tokens.get(id);
        if ((!entry && !role.optional) || (entry && entry.type !== role.type)) {
          report({
            code: "profile.role", severity: "error", path: id,
            message: `Profile "${profile.id}" requires "${id}" to have type ${role.type}.`,
          });
        }
      }
    }
    for (const context of contextOptions(contexts)) {
      let valid = true;
      tokens.inspect(context, error => {
        valid = false;
        if (!(error instanceof DesignError)) throw error;
        report({ ...error.diagnostic, context });
      });
      if (valid) for (const policy of policies) {
        const issue = checkContrast(policy, tokens, context);
        if (issue) report(issue);
      }
    }
    for (const { id, roles } of mappings) {
      for (const [role, target] of Object.entries(roles)) {
        if (!tokens.get(target)) {
          report({
            code: "mapping.target", severity: "error", path: id,
            message: `Mapping "${id}" points role "${role}" at missing token "${target}".`,
          });
        }
      }
    }
    for (const pattern of patterns) {
      for (const id of pattern.components) {
        if (!components.some(component => component.id === id)) {
          report({ code: "pattern.component", severity: "error", path: pattern.id, message: `Unknown component "${id}".` });
        }
      }
    }
    return [...diagnostics.values()];
  }

  async function build() {
    const diagnostics = validate();
    const artifacts = new Map<string, Artifact>();
    const usages: TokenUsage[] = [...config.usages ?? []];
    const checks: ArtifactCheck[] = [];
    const hasErrors = () => diagnostics.some(({ severity }) => severity === "error");
    async function collect(action: () => void | Promise<void>) {
      try {
        await action();
      } catch (error) {
        if (!(error instanceof DesignError)) throw error;
        diagnostics.push(error.diagnostic);
      }
    }
    if (!hasErrors()) {
      const files = new Map<string, string>();
      for (const usage of config.usages ?? []) {
        await collect(async () => {
          if (!tokens.get(usage.token)) fail("usage.token", `Unknown usage token "${usage.token}".`, usage.path);
          let content = files.get(usage.path);
          if (content === undefined) {
            try { content = await readProjectFile(usage.path); }
            catch (error) {
              if (error instanceof DesignError) throw error;
              fail("usage.file", `Cannot read usage source "${usage.path}".`, usage.path);
            }
            files.set(usage.path, content);
          }
          if (!usage.reference.trim() || !content.includes(usage.reference)) {
            fail("usage.reference", `Missing reference "${usage.reference}" in "${usage.path}".`, usage.path);
          }
        });
      }
    }
    if (!hasErrors()) {
      for (const integration of config.integrations ?? []) {
        await collect(() => integration.generate({
          ...design,
          report: diagnostic => diagnostics.push(diagnostic),
          usage: entry => usages.push(entry),
          read: readProjectFile,
          verify(check) { checks.push(check); },
          emit(artifact) {
            if (isAbsolute(artifact.path)) fail("artifact.path", "Artifact paths must be relative.", artifact.path);
            const path = relative(root, projectPath(root, artifact.path));
            if (artifacts.has(path)) fail("artifact.conflict", `Multiple outputs write "${path}".`, path);
            artifacts.set(path, { ...artifact, path });
          },
        }));
      }
      if (!hasErrors()) {
        for (const check of checks) {
          await collect(() => check(path => artifacts.get(relative(root, projectPath(root, path)))));
        }
      }
    }
    const ok = !hasErrors();
    return { ok, artifacts: ok ? [...artifacts.values()] : [], diagnostics, usages: ok ? usages : [] };
  }

  return {
    ...design, tokens, validate, build, patterns, policies, usages: config.usages ?? [],
    async check() {
      const { ok, artifacts, diagnostics } = await build();
      return { ok, diagnostics, artifacts: artifacts.map(({ path }) => path) };
    },
    compatibility: { check: (request: CompatibilityRequest) => checkCompatibility(design, request) },
    inspect() {
      return { contexts, profiles, tokens: tokens.list(), components, mappings, capabilities, patterns, policies };
    },
    diff(before: Pick<DesignContext, "tokens">, context?: Context) {
      const old = new Map(before.tokens.resolveAll(context).map(token => [token.id, token]));
      const current = new Map(tokens.resolveAll(context).map(token => [token.id, token]));
      const ids = [...new Set([...old.keys(), ...current.keys()])].sort();
      return ids.flatMap(id => {
        const a = old.get(id);
        const b = current.get(id);
        return a?.value === b?.value && a?.type === b?.type
          ? [] : [{ id, before: a ?? null, after: b ?? null }];
      });
    },
    impact(id: string, context?: Context) {
      tokens.resolve(id, context);
      const affected = tokens.resolveAll(context).filter(entry => entry.path.includes(id)).map(entry => entry.id);
      const ids = new Set(affected);
      const consumers = components.filter(component => component.roles?.some(role => ids.has(role)));
      const componentIds = new Set(consumers.map(component => component.id));
      return {
        tokens: affected,
        components: consumers.map(component => component.id),
        patterns: patterns.filter(pattern => pattern.components.some(component => componentIds.has(component))).map(pattern => pattern.id),
        usages: (config.usages ?? []).filter(entry => ids.has(entry.token)),
      };
    },
    async query(task: string, context?: Context) {
      const words = task.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const matches = (...text: (string | undefined)[]) =>
        words.some(word => text.join(" ").toLowerCase().includes(word));
      const selectedPatterns = patterns.filter(pattern => matches(pattern.id, pattern.description));
      const selectedComponents = components.filter(component =>
        matches(component.id, component.description) || selectedPatterns.some(pattern => pattern.components.includes(component.id)),
      );
      const selectedTokens = tokens.resolveAll(context).filter(({ id, description }) =>
        matches(id, description) || selectedComponents.some(component => component.roles?.includes(id)),
      );
      const { diagnostics, usages } = await build();
      const ids = new Set(selectedTokens.map(({ id }) => id));
      const selectedUsages = usages.filter(entry => ids.has(entry.token));
      const missing = [
        ...(selectedComponents.length ? [] : ["components"]),
        ...(selectedPatterns.length ? [] : ["patterns"]),
        ...(selectedTokens.length ? [] : ["tokens"]),
        ...(selectedUsages.length ? [] : ["usages"]),
      ];
      return {
        components: selectedComponents, patterns: selectedPatterns, tokens: selectedTokens,
        usages: selectedUsages, diagnostics, missing,
        policies: policies.filter(policy => matches(policy.id, policy.description)),
      };
    },
  };
}
