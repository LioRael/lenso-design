import type { Context, Diagnostic, Policy, TokenReader } from "./model.js";

function luminance(color: string | number) {
  if (typeof color !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) return undefined;
  const hex = color.length === 4 ? [...color.slice(1)].map(channel => channel.repeat(2)).join("") : color.slice(1);
  const [r, g, b] = [0, 2, 4].map(index => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function checkContrast(policy: Policy, tokens: TokenReader, context: Context): Diagnostic | undefined {
  const rule = policy.contrast;
  if (!rule) return;
  const { foreground, background, minimum } = rule;
  const issue = (code: string, message: string, severity: Diagnostic["severity"]): Diagnostic =>
    ({ code, message, severity, path: policy.id, context });
  if (!Number.isFinite(minimum) || minimum < 1 || minimum > 21 ||
      [foreground, background].some(id => tokens.get(id, context)?.type !== "color")) {
    return issue("policy.definition", "Contrast needs two color tokens and a minimum between 1 and 21.", "error");
  }
  const fg = luminance(tokens.resolve(foreground, context).value);
  const bg = luminance(tokens.resolve(background, context).value);
  if (fg === undefined || bg === undefined) return issue("policy.unverified", "Render this color pair to measure contrast.", "warning");
  const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  if (ratio < minimum) return issue("policy.contrast", `Contrast ${ratio.toFixed(2)} is below ${minimum}.`, policy.severity ?? "error");
}
