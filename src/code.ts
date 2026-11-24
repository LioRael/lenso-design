import { join } from "node:path";
import { defineIntegration, fail } from "./model.js";
import { compileRecipe, type RecipeSource } from "./recipe.js";

type CatalogOptions = {
  output: string;
  namespace: string;
  version: string;
  reference: string;
  framework: string;
  runtime: string;
  components: readonly (RecipeSource & { description: string })[];
};

const quote = (value: string) => JSON.stringify(value);
const slug = /^[a-zA-Z0-9_-]{1,64}$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[\da-zA-Z-]*[a-zA-Z-][\da-zA-Z-]*)(?:\.(?:0|[1-9]\d*|[\da-zA-Z-]*[a-zA-Z-][\da-zA-Z-]*))*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;

function nativeDependencies(specs: readonly string[]) {
  const dependencies = new Map<string, string>();
  for (const spec of specs) {
    const match = /^((?:@[\w.-]+\/)?[\w.-]+)(?:@(.+))?$/.exec(spec);
    if (!match) fail("code.dependency", "Expected an npm package name with optional @version.", spec);
    const [, name, requirement = "*"] = match;
    const previous = dependencies.get(name);
    if (previous && previous !== "*" && requirement !== "*" && previous !== requirement) {
      fail("code.dependency", "Conflicting requirements for " + name);
    }
    if (!previous || previous === "*") dependencies.set(name, requirement);
  }
  return dependencies;
}

/** Export a Code module directory. Code owns target selection, installation and receipts. */
export function codeModules(options: CatalogOptions) {
  return defineIntegration({
    name: "code-modules",
    async generate(ctx) {
      if (![options.namespace, options.runtime, options.framework].every(id => slug.test(id)) ||
          !version.test(options.version) || !options.reference.trim() ||
          !options.components.length || options.components.length > 128) {
        fail("code.directory", "Expected valid Code identifiers, a release version, a source ref and 1–128 components.");
      }
      const emit = (path: string, content: string) => ctx.emit({ path: join(options.output, path), content });
      const directory = ["schema_version = 1", "namespace = " + quote(options.namespace)];
      const seen = new Set<string>();
      for (const component of options.components) {
        const id = component.recipe.id;
        if (!slug.test(id) || seen.has(id.toLowerCase())) fail("code.module", "Invalid or duplicate Code module ID.", id);
        seen.add(id.toLowerCase());
        const mod = "modules." + quote(id);
        const release = mod + ".releases";
        directory.push("", "[" + mod + "]", "description = " + quote(component.description), "root = " + quote(id),
          "[[" + release + "]]", "version = " + quote(options.version), "reference = " + quote(options.reference));
        for (const { target, sources, dependencies } of await compileRecipe(component, ctx)) {
          const folder = id + "/" + target;
          directory.push("[[" + release + ".targets]]", 'language = "typescript"', "runtime = " + quote(options.runtime),
            "when = { framework = " + quote(options.framework) + ", styles = " + quote(target) + " }",
            "catalog = " + quote(folder + "/catalog.toml"));
          const bindings = sources.map(({ name }) => "{ path = " + quote(name) + ", target = " + quote(name) + " }");
          const catalog = ["schema_version = 1", "[" + mod + "]", "version = " + quote(options.version),
            "[" + mod + ".supports]", 'language = ["typescript"]', "runtime = [" + quote(options.runtime) + "]",
            "framework = [" + quote(options.framework) + "]", "styles = [" + quote(target) + "]",
            "[resources]", quote(id) + " = [" + bindings.join(", ") + "]",
            "[generator]", "schema_version = 1", "directory = " + quote("generated/" + id),
            'files = [{ scope = "composition", template = "entry.ts.j2", target = "index.ts" }]'];
          for (const [name, requirement] of nativeDependencies(dependencies)) {
            catalog.push("[[generator.dependencies]]", 'ecosystem = "npm"', "package = " + quote(name),
              "version = " + quote(requirement), "module = " + quote(id));
          }
          emit(folder + "/catalog.toml", catalog.join("\n") + "\n");
          emit(folder + "/entry.ts.j2", 'export * from "../modules/' + id + '/index";\n');
          for (const source of sources) emit(folder + "/" + source.name, source.content);
        }
      }
      emit("lenso.modules.toml", directory.join("\n") + "\n");
    },
  });
}
