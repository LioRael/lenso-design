import { color, definePreset, defineProfile, dimension, token } from "./model.js";
import type { Token, Tokens } from "./model.js";

export const foundation = defineProfile({
  id: "foundation",
  version: "1.0.0",
  roles: {
    "surface.canvas": { type: "color" },
    "surface.raised": { type: "color" },
    "text.primary": { type: "color" },
    "text.secondary": { type: "color" },
    "border.default": { type: "color" },
    "action.primary.background": { type: "color" },
    "action.primary.foreground": { type: "color" },
    "control.radius": { type: "dimension" },
  },
});

function profile(id: string, roles: Record<string, Token["type"]>) {
  return defineProfile({ id, version: "1.0.0", roles: Object.fromEntries(
    Object.entries(roles).map(([role, type]) => [role, { type }]),
  ) });
}

export const typography = profile("typography", { "font.family.sans": "fontFamily", "font.size.body": "dimension", "font.weight.regular": "fontWeight" });
export const layout = profile("layout", { "layout.readable": "dimension", "layout.breakpoint": "dimension" });
export const controls = profile("controls", { "control.height": "dimension", "control.padding-inline": "dimension" });
export const shape = profile("shape", { "control.radius": "dimension" });
export const elevation = profile("elevation", { "elevation.raised": "string" });
export const motion = profile("motion", { "motion.fast": "duration", "motion.ease": "cubicBezier" });
export const material = profile("material", { "material.panel": "color" });
export const feedback = profile("feedback", { "feedback.success": "color", "feedback.warning": "color", "feedback.error": "color", "feedback.info": "color" });
export const navigation = profile("navigation", { "navigation.selected": "color" });
export const dataViz = profile("data-viz", { "chart.blue": "color", "chart.orange": "color" });
export const accessibility = profile("accessibility", { "focus.ring": "color", "focus.width": "dimension" });

const light = {
  "surface.canvas": "#ffffff",
  "surface.raised": "#f7f7f9",
  "surface.overlay": "#18181b66",
  "text.primary": "#18181b",
  "text.secondary": "#52525b",
  "border.default": "#d4d4d8",
  "action.primary.background": "#27272a",
  "action.primary.foreground": "#ffffff",
  "action.primary.hover": "#3f3f46",
  "action.destructive.background": "#b91c1c",
  "action.destructive.foreground": "#ffffff",
  "feedback.success": "#166534",
  "feedback.warning": "#854d0e",
  "feedback.error": "#b91c1c",
  "feedback.info": "#1d4ed8",
  "focus.ring": "#2563eb",
  "navigation.selected": "#e4e4e7",
  "material.panel": "#ffffffe6",
  "chart.blue": "#2563eb",
  "chart.orange": "#c2410c",
  "chart.green": "#15803d",
  "chart.purple": "#7e22ce",
};
const dark: Record<keyof typeof light, string> = {
  "surface.canvas": "#111113",
  "surface.raised": "#202024",
  "surface.overlay": "#00000099",
  "text.primary": "#fafafa",
  "text.secondary": "#a1a1aa",
  "border.default": "#45454d",
  "action.primary.background": "#f4f4f5",
  "action.primary.foreground": "#18181b",
  "action.primary.hover": "#d4d4d8",
  "action.destructive.background": "#fca5a5",
  "action.destructive.foreground": "#450a0a",
  "feedback.success": "#86efac",
  "feedback.warning": "#fde047",
  "feedback.error": "#fca5a5",
  "feedback.info": "#93c5fd",
  "focus.ring": "#60a5fa",
  "navigation.selected": "#303036",
  "material.panel": "#202024e6",
  "chart.blue": "#60a5fa",
  "chart.orange": "#fb923c",
  "chart.green": "#4ade80",
  "chart.purple": "#c084fc",
};

const colors = (values: Record<string, string>): Tokens =>
  Object.fromEntries(Object.entries(values).map(([id, value]) => [id, color(value)]));

export function neutral() {
  const tokens: Record<string, Token> = {
    ...colors(light),
    "font.family.sans": { type: "fontFamily", value: "system-ui, sans-serif" },
    "font.family.mono": { type: "fontFamily", value: "ui-monospace, monospace" },
    "font.weight.regular": { type: "fontWeight", value: 400 },
    "font.weight.medium": { type: "fontWeight", value: 500 },
    "font.weight.bold": { type: "fontWeight", value: 700 },
    "font.size.small": dimension("0.875rem"),
    "font.size.body": dimension("1rem"),
    "font.size.title": dimension("1.5rem"),
    "font.line-height.body": { type: "number", value: 1.5 },
    "radius.small": dimension("0.25rem"),
    "radius.medium": dimension("0.5rem"),
    "radius.large": dimension("0.75rem"),
    "control.radius": dimension(token("radius.medium")),
    "control.height": dimension("2.5rem"),
    "control.padding-inline": dimension(token("space.4")),
    "focus.width": dimension("2px"),
    "layout.readable": dimension("44rem"),
    "layout.wide": dimension("75rem"),
    "layout.breakpoint": dimension("48rem"),
    "elevation.raised": { type: "string", value: "0 1px 3px #00000026" },
    "motion.fast": { type: "duration", value: "120ms" },
    "motion.normal": { type: "duration", value: "200ms" },
    "motion.ease": { type: "cubicBezier", value: "cubic-bezier(0.2, 0, 0, 1)" },
  };
  for (const step of [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16]) {
    tokens[`space.${step}`] = dimension(`${step / 4}rem`);
  }
  return definePreset({
    id: "neutral",
    profiles: [foundation, typography, layout, controls, shape, elevation, motion, material, feedback, navigation, dataViz, accessibility],
    dimensions: {
      appearance: { default: "light", values: ["light", "dark"] },
      density: { default: "comfortable", values: ["comfortable", "compact"] },
      motion: { default: "full", values: ["full", "reduced"] },
    },
    tokens,
    variants: [
      { when: { appearance: "dark" }, tokens: colors(dark) },
      { when: { density: "compact" }, tokens: {
        "control.height": dimension("2rem"), "control.padding-inline": dimension(token("space.3")),
      } },
      { when: { motion: "reduced" }, tokens: {
        "motion.fast": { type: "duration", value: "0ms" },
        "motion.normal": { type: "duration", value: "0ms" },
      } },
    ],
  });
}
