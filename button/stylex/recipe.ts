import * as stylex from "@stylexjs/stylex";
const styles = stylex.create({
  "root": {
    "backgroundColor": {
      "default": "var(--ds-action-primary-background)"
    },
    "color": {
      "default": "var(--ds-action-primary-foreground)"
    },
    "outlineColor": {
      "default": null,
      ":focus-visible": "var(--ds-focus-ring)"
    }
  }
});
export const root = stylex.props(styles.root).className;
