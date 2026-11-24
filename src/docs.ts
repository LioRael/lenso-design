import { runDesignContract } from "./contract.js";
import type { DesignContract } from "./contract.js";
import { fail } from "./model.js";

type Page = { id: string; title: string; sources: string[]; data: string };

function code(text: string | number) {
  const value = String(text).replace(/[\r\n]+/g, " ");
  const ticks = "`".repeat(1 + Math.max(0, ...Array.from(value.matchAll(/`+/g), match => match[0].length)));
  return ticks + " " + value + " " + ticks;
}

function table(columns: string[], rows: string[][]) {
  return [columns, columns.map(() => "---"), ...rows]
    .map(row => "| " + row.map(cell => cell.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ")).join(" | ") + " |").join("\n");
}

/** Pass this definition to Lenso Docs' defineCollection. Reads participate in its watcher. */
export function designCollection(source = "design.json", scope = "design") {
  return {
    id: "design", scope, index: { title: "Design system" },
    async load({ readText }: { readText(path: string): Promise<string> }): Promise<Page[]> {
      const text = await readText(source);
      const check = await runDesignContract(text, "check");
      if (!check.ok) fail("docs.contract", JSON.stringify(check.diagnostics), source);
      const d: DesignContract = JSON.parse(text);
      const pages: Page[] = [];
      function section(title: string, columns: string[], rows: string[][]) {
        if (rows.length) pages.push({ id: title.toLowerCase(), title, sources: [source], data: table(columns, rows) });
      }
      section("Tokens", ["Token", "Type", "Base value or alias", "Description"], Object.entries(d.tokens).map(([id, token]) =>
        [code(id), token.type, code(typeof token.value === "object" ? "→ " + token.value.ref : token.value), token.description ?? ""]));
      section("Contexts", ["Axis", "Default", "Values"], Object.entries(d.dimensions ?? {}).map(([id, axis]) =>
        [code(id), code(axis.default), axis.values.map(code).join(", ")]));
      section("Components", ["Component", "Import", "Export", "Roles"], (d.components ?? []).map(c =>
        [code(c.id), code(c.import), code(c.export), (c.roles ?? []).map(code).join(", ")]));
      section("Patterns", ["Pattern", "When to use", "Components"], (d.patterns ?? []).map(p =>
        [code(p.id), p.description, p.components.map(code).join(", ")]));
      section("Policies", ["Policy", "Guidance", "Check"], (d.policies ?? []).map(p =>
        [code(p.id), p.description, p.contrast ? `${code(p.contrast.foreground)} / ${code(p.contrast.background)} ≥ ${p.contrast.minimum} (${p.severity ?? "error"})` : "Guidance"]));
      section("Usages", ["Token", "Styling", "Source", "Reference"], (d.usages ?? []).map(u =>
        [code(u.token), u.styling, code(u.path), code(u.reference)]));
      section("Profiles", ["Profile", "Role", "Type", "Required"], (d.profiles ?? []).flatMap(p =>
        Object.entries(p.roles).map(([id, role]) => [code(p.id + "@" + p.version), code(id), role.type, role.optional ? "No" : "Yes"])));
      section("Mappings", ["Mapping", "Role", "Target"], (d.mappings ?? []).flatMap(m =>
        Object.entries(m.roles).map(([id, target]) => [code(m.id), code(id), code(target)])));
      return pages;
    },
    template(entry: Page) { return entry.data; },
  };
}
