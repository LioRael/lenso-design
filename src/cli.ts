#!/usr/bin/env node
import { runDesignCommand } from "./command.js";
import { DesignError } from "./model.js";
try {
  await runDesignCommand(process.argv.slice(2));
} catch (error) {
  const diagnostic = error instanceof DesignError ? error.diagnostic : {
    code: "cli.error", severity: "error", message: error instanceof Error ? error.message : String(error),
  };
  const args = process.argv.slice(2);
  if (args.includes("--json") || args.includes("--json=true")) {
    process.stdout.write(JSON.stringify({ ok: false, diagnostics: [diagnostic] }) + "\n");
  } else {
    console.error(`${diagnostic.code}: ${diagnostic.message}`);
  }
  process.exitCode = 1;
}
