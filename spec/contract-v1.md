# Design contract v1

Use the [JSON Schema](design-v1.schema.json) for editor completion and structural validation. The Wasm check also validates relationships between entries. A minimal contract has `contractVersion: 1` and a `tokens` object. Older hosts reject new optional fields they do not recognize. Pin the extension and contract together when upgrading.

## Resolution

Token IDs are dot-separated, case-sensitive names. Use a terminal `$root` for a group token. Declare the type on each token. A reference such as `{"type":"color","value":{"ref":"brand.ink"}}` resolves through tokens of the same type. Unknown references and cycles are errors. Resolution returns the path from the requested ID to the literal.

An axis has a default and a list of unique values. Each variant selects one or more axes and overrides tokens of the same type. For a selected context, defaults fill omitted axes and the most specific matching condition wins. Overlapping, equally specific overrides of one token are errors. Contract checks visit all combinations. The current budgets are 256 combinations, 16,384 base tokens times combinations, 128 variants, 64 entries in a reference chain, and 64 reported resolution errors per check.

## Knowledge and interoperability

Profiles identify required and optional token roles with types. Mappings bind external role names to existing tokens. Components declare their import, export and token roles. Patterns reference component IDs. Policies carry human-readable design rules. Each record has a unique ID within its collection. A usage records a token, styling ecosystem, project-relative source file and literal source reference. The Wasm query reads these declarations with its single-file grant. The author build additionally verifies the referenced text in the source file.

Use the [working example](../design.json) for each shape. To migrate a project, copy one existing theme value under its original token ID, add a role mapping, and check its default and dark values. Move source adapters and generated-output declarations into the optional TypeScript config. Add a usage pointing at an existing component and run the author check to detect stale paths or references.

## Automation

| Operation | Lenso extension | Standalone author tool |
| --- | --- | --- |
| Inspect, resolve, query, check the shared contract | `lenso design <operation> --json`; read `outputs.<operation>` | `lenso-design <operation> --json`; read the result directly |
| Select dimensions with this checkout | Repeat `--context key=value` on resolve/query | Repeat `--context key=value` on resolve/query |
| Validate generated native artifacts and source references | Run the author tool in CI | `lenso-design check --config design.config.ts --json` |
| Generate or update files | Run the author tool | `lenso-design build`; review changes before using `--overwrite` |

In Bash, check both the host process and the validation result:

```sh
set -o pipefail
lenso design check --json | jq -e '.outputs.check.ok == true'
```

For example, a reference to a missing token yields `ok: false` with diagnostic code `token.missing`. The standalone CLI exits with status 1. A host workflow can complete successfully while reporting this domain error.

An optional policy `contrast` field names `foreground` and `background` color tokens and a minimum luminance ratio from 1 to 21. Each context is checked. Opaque three- and six-digit hexadecimal pairs have measurable ratios. Other color expressions, including glass and transparency, produce a `policy.unverified` warning for rendered review. Set `severity: "warning"` for a recommended threshold. The default threshold severity is an error.

Since preview.3, a usage may also name its owning `component`. Component queries return matching token usages from selected components and unscoped usages. A token query with no component match can return references from any component. Unknown component IDs fail validation. Omit this optional field for the released preview.2 kernel.
