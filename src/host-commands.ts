/** Public argument names are shared by the extension manifest and its ABI adapter. */
export const hostCommands: Record<string, { about: string; positional?: string; options: string[] }> = {
  init: { about: "Create a design contract and author configuration", options: ["config"] },
  build: { about: "Build native design artifacts", options: ["config", "dry-run", "overwrite"] },
  check: { about: "Validate a design contract or author configuration", options: ["config"] },
  discover: { about: "Find imported JSX components in this project", positional: "task", options: [] },
  install: { about: "Preview, install or update a native component", positional: "item", options: ["target", "from", "dry-run", "diff"] },
  inspect: { about: "Inspect project design knowledge", options: ["config"] },
  tokens: { about: "List resolved tokens", options: ["config", "context"] },
  capabilities: { about: "List design capabilities", options: ["config"] },
  resolve: { about: "Resolve a design token", positional: "id", options: ["config", "context", "appearance"] },
  query: { about: "Find related components, patterns and tokens", positional: "task", options: ["config", "context", "appearance"] },
  migrate: { about: "Materialize a design contract", options: ["config"] },
  impact: { about: "Trace affected components and usages", positional: "id", options: ["config", "context"] },
  diff: { about: "Compare resolved designs", positional: "before", options: ["config", "context"] },
};

export const switches = new Set(["diff", "dry-run", "overwrite"]);
