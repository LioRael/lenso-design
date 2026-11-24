import { relative, resolve } from "node:path";
import ts from "typescript";
import { fail } from "./model.js";

/** Locate JSX uses and follow imported symbols to their TypeScript declarations. */
export function discoverComponents(task: string, root = process.cwd()) {
  const config = ts.findConfigFile(root, ts.sys.fileExists);
  let options: ts.CompilerOptions = { allowJs: true, jsx: ts.JsxEmit.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler };
  let files: string[];
  if (config) {
    const loaded = ts.readConfigFile(config, ts.sys.readFile);
    if (loaded.error) fail("discover.config", ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"), config);
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, resolve(config, ".."));
    if (parsed.errors.length) fail("discover.config", ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, "\n"), config);
    options = parsed.options;
    files = parsed.fileNames;
  } else {
    files = ts.sys.readDirectory(root, [".tsx", ".jsx"], ["**/node_modules/**", "**/dist/**", "**/.git/**"]);
  }
  const program = ts.createProgram(files, options);
  const checker = program.getTypeChecker();
  const terms = task.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!terms.length) fail("discover.task", "Supply a component name or words from its usage.");
  const results = [];
  for (const source of program.getSourceFiles()) {
    if (!/\.[jt]sx$/.test(source.fileName) || program.isSourceFileFromExternalLibrary(source)) continue;
    const entries: { component: string; module: string; exported: string; file: string; line: number; source?: string; score: number }[] = [];
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName;
        const symbol = checker.getSymbolAtLocation(tag);
        const decl = symbol?.declarations?.[0];
        if (symbol && decl && (ts.isImportSpecifier(decl) || ts.isImportClause(decl))) {
          const statement = ts.isImportSpecifier(decl) ? decl.parent.parent.parent : decl.parent;
          const module = (statement.moduleSpecifier as ts.StringLiteral).text;
          const component = tag.getText(source);
          const exported = ts.isImportSpecifier(decl) ? (decl.propertyName ?? decl.name).text : "default";
          const text = [component, exported, module, node.getText(source)].join(" ").toLowerCase();
          const score = terms.filter(term => text.includes(term)).length;
          if (score) {
            const implementation = checker.getAliasedSymbol(symbol).declarations?.[0]?.getSourceFile();
            entries.push({ component, module, exported, file: relative(root, source.fileName),
              line: source.getLineAndCharacterOfPosition(tag.getStart(source)).line + 1,
              source: implementation && relative(root, implementation.fileName), score });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    results.push(...entries);
  }
  return results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
}
