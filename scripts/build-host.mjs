import { writeFile } from "node:fs/promises";
import { hostCommands, switches } from "../dist/host-commands.js";
import pkg from "../package.json" with { type: "json" };

// Each grant pins the executable, project-local module path and operation.
const handlers = {};
const workflows = [];
const commands = [];
const grants = [];
for (const [name, { about, positional, options }] of Object.entries(hostCommands)) {
  const id = "design/" + name;
  const process = { program: "node", args: ["node_modules/@lenso/design/dist/host.js", name] };
  grants.push(process);
  handlers[id] = { type: "json_process", ...process };
  workflows.push({ id, steps: [{ id: name, handler: id }] });
  const args = positional ? [{ name: positional, help: positional, positional: true }] : [];
  for (const option of options) {
    args.push({ name: option, help: option, kind: switches.has(option) ? "flag" : option === "context" ? "list" : "text" });
  }
  commands.push({ path: ["design", name], workflow: id, about, provider: "design", arguments: args });
}
await writeFile(new URL("../dist/extension.json", import.meta.url), JSON.stringify({
  schema_version: 1, id: "design", version: pkg.version, setup: { defaults: { json_processes: grants } },
  handlers, workflows, commands,
}, null, 2) + "\n");
