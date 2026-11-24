import { cssIdent, defineIntegration, fail } from "./model.js";
import { variableNames } from "./css.js";

export function tailwind(options: {
  readonly mapping: Readonly<Record<string, string>>;
  readonly output?: string;
  readonly prefix?: string;
  readonly version?: 4;
}) {
  return defineIntegration({
    name: "tailwind",
    generate(ctx) {
      if (options.version !== undefined && options.version !== 4) {
        fail("tailwind.version", "Only Tailwind CSS v4 is supported.");
      }
      const variables = variableNames(ctx, options.prefix);
      const path = options.output ?? "generated/tailwind.css";
      const declarations = Object.entries(options.mapping).map(([name, id]) => {
        if (!cssIdent.test(name) || !/^(color|font|text|font-weight|tracking|leading|breakpoint|container|spacing|radius|shadow|inset-shadow|drop-shadow|blur|perspective|aspect|ease|animate)-.+$/.test(name)) {
          fail("tailwind.namespace", `Unknown Tailwind theme variable "--${name}".`, name);
        }
        const variable = variables.get(id);
        if (variable === undefined) fail("token.missing", `Unknown token "${id}".`, id);
        const utility = /^(color|radius|spacing|font-weight)-(.*)$/.exec(name);
        if (utility) {
          const [, namespace, key] = utility;
          const type = namespace === "color" ? "color" : namespace === "font-weight" ? "fontWeight" : "dimension";
          if (ctx.tokens.get(id)?.type !== type) {
            fail("tailwind.type", `"--${name}" requires a ${type} token.`, id);
          }
          const prefixes = namespace === "color" ? ["bg", "text", "border"]
            : namespace === "radius" ? ["rounded"] : namespace === "font-weight" ? ["font"] : ["p", "m", "gap"];
          for (const prefix of prefixes) {
            ctx.usage({ token: id, styling: "tailwind", path, reference: `${prefix}-${key}` });
          }
        }
        return `  --${name}: var(${variable});`;
      });
      ctx.emit({
        path,
        content: `@theme inline {\n${declarations.join("\n")}\n}\n`,
      });
    },
  });
}
