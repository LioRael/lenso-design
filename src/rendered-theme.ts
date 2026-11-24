import type { Diagnostic } from "./model.js";

/** Compare the rendered panel with the DOM scope that owns its theme. */
export function checkRenderedTheme(scope: Element, panel: Element, variables: readonly string[]): Diagnostic[] {
  const issues: Diagnostic[] = [];
  if (!scope.contains(panel)) {
    issues.push({ code: "theme.portal-scope", severity: "warning", message: "Panel is outside the intended theme scope. Verify its inherited variables." });
  }
  const expected = getComputedStyle(scope);
  const actual = getComputedStyle(panel);
  for (const name of variables) {
    const before = expected.getPropertyValue(name).trim();
    const after = actual.getPropertyValue(name).trim();
    if (!before || !after) {
      issues.push({ code: "theme.variable-missing", severity: "error", path: name,
        message: `Required variable ${name} is empty on the ${!before ? "theme scope" : "panel"}.` });
    } else if (before !== after) {
      issues.push({ code: "theme.variable-mismatch", severity: "warning", path: name,
        message: `Expected ${name} to inherit "${before}"; the panel resolves it to "${after}".` });
    }
  }
  return issues;
}
