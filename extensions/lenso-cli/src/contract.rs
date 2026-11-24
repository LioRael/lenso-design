use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const CONFIG: &str = "design.json";
type Context = BTreeMap<String, String>;
type Tokens = BTreeMap<String, Token>;
type Result<T> = std::result::Result<T, Diagnostic>;

#[derive(Debug, Serialize)]
struct Diagnostic {
    code: &'static str,
    severity: &'static str,
    message: String,
}

fn error(code: &'static str, message: impl Into<String>) -> Diagnostic {
    Diagnostic {
        code,
        severity: "error",
        message: message.into(),
    }
}

fn failed(diagnostic: Diagnostic) -> Value {
    json!({"ok":false,"diagnostics":[diagnostic]})
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
enum TokenType {
    Color,
    Dimension,
    Duration,
    Number,
    FontFamily,
    FontWeight,
    CubicBezier,
    String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Token {
    #[serde(rename = "type")]
    kind: TokenType,
    value: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    extensions: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Axis {
    default: String,
    values: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Variant {
    when: Context,
    tokens: Tokens,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Component {
    id: String,
    import: String,
    export: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(default)]
    roles: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Pattern {
    id: String,
    description: String,
    components: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Policy {
    id: String,
    description: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Contract {
    contract_version: u32,
    #[serde(default)]
    dimensions: BTreeMap<String, Axis>,
    tokens: Tokens,
    #[serde(default)]
    variants: Vec<Variant>,
    #[serde(default)]
    components: Vec<Component>,
    #[serde(default)]
    patterns: Vec<Pattern>,
    #[serde(default)]
    policies: Vec<Policy>,
    #[serde(default)]
    capabilities: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
struct Input {
    id: Option<String>,
    task: Option<String>,
    appearance: Option<String>,
    context: Context,
}

fn token_id(id: &str) -> bool {
    let mut parts = id.split('.').peekable();
    while let Some(part) = parts.next() {
        if part == "$root" && parts.peek().is_none() {
            continue;
        }
        if part.is_empty() || part.bytes().any(|byte| byte < 32 || b"{}$".contains(&byte)) {
            return false;
        }
    }
    true
}

fn target(token: &Token) -> Option<&str> {
    token.value.get("ref").and_then(Value::as_str)
}

fn validate_token(id: &str, token: &Token) -> Result<()> {
    if !token_id(id) {
        return Err(error("token.id", format!("Invalid token ID '{id}'.")));
    }
    let valid = match &token.value {
        Value::Object(value) => value.len() == 1 && target(token).is_some_and(token_id),
        Value::Number(value) => match token.kind {
            TokenType::Number => true,
            TokenType::FontWeight => value.as_f64().is_some_and(|n| (1.0..=1000.0).contains(&n)),
            _ => false,
        },
        Value::String(value) => {
            !value.trim().is_empty()
                && !matches!(token.kind, TokenType::Number | TokenType::FontWeight)
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(error(
            "token.type",
            format!("Invalid typed value or reference for '{id}'."),
        ))
    }
}

impl Contract {
    fn validate(&self) -> Result<()> {
        if self.contract_version != 1 {
            return Err(error(
                "contract.version",
                "Expected design contract version 1.",
            ));
        }
        let mut combinations = 1usize;
        for (name, axis) in &self.dimensions {
            if name.is_empty()
                || !axis.values.contains(&axis.default)
                || axis.values.iter().any(String::is_empty)
                || axis.values.iter().collect::<BTreeSet<_>>().len() != axis.values.len()
            {
                return Err(error(
                    "context.definition",
                    format!("Invalid context dimension '{name}'."),
                ));
            }
            combinations = combinations.saturating_mul(axis.values.len());
        }
        // Bound exhaustive checking against the same fuel budget as inspection and resolution.
        if combinations > 256
            || self.tokens.len().saturating_mul(combinations) > 16_384
            || self.variants.len() > 128
        {
            return Err(error(
                "contract.limit",
                "The contract exceeds the token/context verification budget.",
            ));
        }
        for (id, token) in &self.tokens {
            validate_token(id, token)?;
        }
        for (index, variant) in self.variants.iter().enumerate() {
            if variant.when.is_empty() {
                return Err(error("context.empty", "Variant must select a context."));
            }
            self.context(&variant.when)?;
            for (id, token) in &variant.tokens {
                validate_token(id, token)?;
                if self
                    .tokens
                    .get(id)
                    .is_none_or(|base| base.kind != token.kind)
                {
                    return Err(error(
                        "token.override",
                        format!("Variant '{id}' must match the base token type."),
                    ));
                }
                for previous in &self.variants[..index] {
                    if previous.when.len() == variant.when.len()
                        && previous.tokens.contains_key(id)
                        && variant.when.iter().all(|(axis, value)| {
                            previous.when.get(axis).is_none_or(|other| other == value)
                        })
                    {
                        return Err(error(
                            "context.conflict",
                            format!("Equally specific variants both override '{id}'."),
                        ));
                    }
                }
            }
        }
        let components = self
            .components
            .iter()
            .map(|c| c.id.as_str())
            .collect::<BTreeSet<_>>();
        if components.len() != self.components.len()
            || self.components.iter().any(|c| {
                c.id.is_empty()
                    || c.import.is_empty()
                    || c.export.is_empty()
                    || c.roles.iter().any(|role| !self.tokens.contains_key(role))
            })
        {
            return Err(error(
                "component.definition",
                "Components need unique IDs, import/export names, and existing token roles.",
            ));
        }
        for pattern in &self.patterns {
            if pattern
                .components
                .iter()
                .any(|id| !components.contains(id.as_str()))
            {
                return Err(error(
                    "pattern.component",
                    format!("Pattern '{}' refers to an unknown component.", pattern.id),
                ));
            }
        }
        Ok(())
    }

    fn context(&self, supplied: &Context) -> Result<Context> {
        for (axis, value) in supplied {
            if self
                .dimensions
                .get(axis)
                .is_none_or(|entry| !entry.values.contains(value))
            {
                return Err(error(
                    "context.unknown",
                    format!("Unknown context {axis}={value}."),
                ));
            }
        }
        Ok(self
            .dimensions
            .iter()
            .map(|(axis, spec)| {
                (
                    axis.clone(),
                    supplied.get(axis).unwrap_or(&spec.default).clone(),
                )
            })
            .collect())
    }

    fn select(&self, context: &Context) -> BTreeMap<&str, &Token> {
        let mut tokens = self
            .tokens
            .iter()
            .map(|(id, token)| (id.as_str(), token))
            .collect::<BTreeMap<_, _>>();
        let mut matches = self
            .variants
            .iter()
            .filter(|v| {
                v.when
                    .iter()
                    .all(|(axis, value)| context.get(axis) == Some(value))
            })
            .collect::<Vec<_>>();
        matches.sort_by_key(|variant| variant.when.len());
        for variant in matches {
            tokens.extend(
                variant
                    .tokens
                    .iter()
                    .map(|(id, token)| (id.as_str(), token)),
            );
        }
        tokens
    }

    fn check(&self) -> Result<Value> {
        let mut contexts = vec![Context::new()];
        for (axis, spec) in &self.dimensions {
            contexts = contexts
                .iter()
                .flat_map(|context| {
                    spec.values.iter().map(|value| {
                        let mut next = context.clone();
                        next.insert(axis.clone(), value.clone());
                        next
                    })
                })
                .collect();
        }
        let mut diagnostics = Vec::new();
        let mut checked_contexts = 0;
        'contexts: for context in contexts {
            let tokens = self.select(&context);
            for id in tokens.keys() {
                if let Err(diagnostic) = trace(&tokens, id) {
                    diagnostics.push(json!({
                        "code":diagnostic.code,"severity":diagnostic.severity,
                        "message":diagnostic.message,"path":id,"context":context
                    }));
                    if diagnostics.len() == 64 {
                        break 'contexts;
                    }
                }
            }
            checked_contexts += 1;
        }
        Ok(
            json!({"ok":diagnostics.is_empty(),"diagnostics":diagnostics,"checkedContexts":checked_contexts}),
        )
    }

    fn query(&self, selected: &BTreeMap<&str, &Token>, task: &str) -> Result<Value> {
        let terms = task
            .split(|c: char| !c.is_alphanumeric())
            .filter(|term| !term.is_empty())
            .map(str::to_lowercase)
            .collect::<Vec<_>>();
        let matches = |text: &str| {
            let text = text.to_lowercase();
            terms.iter().any(|term| text.contains(term))
        };
        let patterns = self
            .patterns
            .iter()
            .filter(|p| matches(&p.id) || matches(&p.description))
            .collect::<Vec<_>>();
        let components = self
            .components
            .iter()
            .filter(|c| {
                matches(&c.id)
                    || c.description.as_deref().is_some_and(matches)
                    || patterns.iter().any(|p| p.components.contains(&c.id))
            })
            .collect::<Vec<_>>();
        let policies = self
            .policies
            .iter()
            .filter(|p| matches(&p.id) || matches(&p.description))
            .collect::<Vec<_>>();
        let mut tokens = Vec::new();
        for (id, token) in selected {
            if matches(id)
                || token.description.as_deref().is_some_and(matches)
                || components
                    .iter()
                    .any(|c| c.roles.iter().any(|role| role == id))
            {
                tokens.push(resolve(selected, id)?);
            }
        }
        let missing = [
            ("components", components.is_empty()),
            ("patterns", patterns.is_empty()),
            ("tokens", tokens.is_empty()),
            ("usages", true),
        ]
        .into_iter()
        .filter_map(|(name, missing)| missing.then_some(name))
        .collect::<Vec<_>>();
        Ok(
            json!({"ok":true,"components":components,"patterns":patterns,"policies":policies,
            "tokens":tokens,"usages":[],"missing":missing,"diagnostics":[]}),
        )
    }

    fn run(&self, operation: &str, mut input: Input) -> Result<Value> {
        self.validate()?;
        if operation == "inspect" {
            return Ok(
                json!({"ok":true,"contractVersion":self.contract_version,"contexts":self.dimensions,
                "tokens":self.tokens.keys().collect::<Vec<_>>(),"components":self.components,
                "patterns":self.patterns,"policies":self.policies,"capabilities":self.capabilities}),
            );
        }
        if operation == "check" {
            return self.check();
        }
        if let Some(appearance) = input.appearance {
            input.context.insert("appearance".into(), appearance);
        }
        let selected = self.select(&self.context(&input.context)?);
        match operation {
            "resolve" => resolve(&selected, required(input.id.as_deref(), "id")?),
            "query" => self.query(&selected, required(input.task.as_deref(), "task")?),
            _ => Err(error("request.operation", "Unknown design operation.")),
        }
    }
}

fn required<'a>(value: Option<&'a str>, field: &str) -> Result<&'a str> {
    value
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| error("request.input", format!("Supply a nonempty '{field}'.")))
}

fn trace<'a>(tokens: &BTreeMap<&str, &'a Token>, start: &str) -> Result<(Vec<String>, &'a Token)> {
    let mut path = Vec::new();
    let mut visited = BTreeSet::new();
    let mut id = start;
    let mut previous = None;
    loop {
        if !visited.insert(id) {
            return Err(error(
                "token.cycle",
                format!("Circular token reference at '{id}'."),
            ));
        }
        if visited.len() > 64 {
            return Err(error(
                "token.depth",
                "The token reference exceeds 64 steps.",
            ));
        }
        let entry = tokens
            .get(id)
            .copied()
            .ok_or_else(|| error("token.missing", format!("Unknown token '{id}'.")))?;
        if previous.is_some_and(|expected| expected != entry.kind) {
            return Err(error(
                "token.alias-type",
                format!("Reference to '{id}' has a different type."),
            ));
        }
        path.push(id.to_owned());
        if let Some(next) = target(entry) {
            previous = Some(entry.kind);
            id = next;
        } else {
            return Ok((path, entry));
        }
    }
}

fn resolve(tokens: &BTreeMap<&str, &Token>, id: &str) -> Result<Value> {
    let (path, leaf) = trace(tokens, id)?;
    let entry = tokens[id];
    let mut output = json!({"ok":true,"id":id,"type":entry.kind,"path":path,"value":leaf.value,
        "source":CONFIG,"valueSource":CONFIG});
    if let Some(description) = &entry.description {
        output["description"] = json!(description);
    }
    if let Some(extensions) = &entry.extensions {
        output["extensions"] = json!(extensions);
    }
    Ok(output)
}

pub(crate) fn run(contract: Option<&str>, operation: &str, input: Value) -> Value {
    let result = (|| {
        let content = contract.ok_or_else(|| {
            error(
                "contract.missing",
                "Create a design.json in the project root.",
            )
        })?;
        let contract: Contract =
            serde_json::from_str(content).map_err(|e| error("contract.invalid", e.to_string()))?;
        let input =
            serde_json::from_value(input).map_err(|e| error("request.input", e.to_string()))?;
        contract.run(operation, input)
    })();
    result.unwrap_or_else(failed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_selected_variant_and_reports_cycle_in_other_context() {
        let config = r##"{
          "contractVersion":1,
          "dimensions":{"appearance":{"default":"light","values":["light","dark"]}},
          "tokens":{"base":{"type":"color","value":"#fff"},"primary":{"type":"color","value":{"ref":"base"}}},
          "variants":[{"when":{"appearance":"dark"},"tokens":{"base":{"type":"color","value":"#333"}}}]
        }"##;
        assert_eq!(
            run(
                Some(config),
                "resolve",
                json!({"id":"primary","appearance":"dark"})
            )["value"],
            "#333"
        );
        assert_eq!(run(Some(config), "check", json!({}))["ok"], true);
        let cyclic = config.replace("\"#333\"", r#"{"ref":"primary"}"#);
        assert_eq!(
            run(Some(&cyclic), "check", json!({}))["diagnostics"][0]["code"],
            "token.cycle"
        );
        assert_eq!(
            run(Some(config), "resolve", json!({"id":"absent"}))["diagnostics"][0]["code"],
            "token.missing"
        );
    }
}
