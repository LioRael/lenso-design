import { join } from "node:path";
import { cssIdent, defineIntegration, fail } from "./model.js";
import type { Context, ResolvedToken } from "./model.js";
import { cssValue, variableNames } from "./css.js";

export function stylex(options: {
  readonly output?: string;
  readonly context?: Context;
  readonly themes?: Readonly<Record<string, Context>>;
} = {}) {
  return defineIntegration({
    name: "stylex",
    generate(ctx) {
      const output = options.output ?? "generated/stylex";
      const names = variableNames(ctx, "");
      const key = (id: string) => names.get(id)!.slice(2);
      const object = (tokens: ResolvedToken[]) => JSON.stringify(Object.fromEntries(tokens.map(({ id, value }) => [
        key(id), typeof value === "string" ? cssValue(value, id) : value,
      ])), null, 2);

      const header = 'import * as stylex from "@stylexjs/stylex";\n';
      const path = join(output, "tokens.stylex.ts");
      ctx.emit({
        path,
        content: `${header}\nexport const tokens = stylex.defineVars(${object(ctx.tokens.resolveAll(options.context))});\n`,
      });

      for (const id of names.keys()) {
        ctx.usage({ token: id, styling: "stylex", path, reference: `tokens[${JSON.stringify(key(id))}]` });
      }
      for (const [name, context] of Object.entries(options.themes ?? {})) {
        if (!cssIdent.test(name) || name === "tokens") fail("stylex.theme", `Invalid StyleX theme name "${name}".`, name);
        ctx.emit({
          path: join(output, `${name}.stylex.ts`),
          content: `${header}import { tokens } from "./tokens.stylex";\n\nexport const theme = stylex.createTheme(tokens, ${object(ctx.tokens.resolveAll({ ...options.context, ...context }))});\n`,
        });
      }
    },
  });
}
