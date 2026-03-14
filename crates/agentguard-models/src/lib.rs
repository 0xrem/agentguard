use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub type Metadata = BTreeMap<String, String>;

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord, Hash,
)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    #[default]
    Low,
    Medium,
    High,
    Critical,
}

impl RiskLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Critical => "critical",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Layer {
    Prompt,
    Tool,
    Command,
}

impl Layer {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Prompt => "prompt",
            Self::Tool => "tool",
            Self::Command => "command",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevel {
    Trusted,
    #[default]
    Unknown,
    HighRisk,
}

impl TrustLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Trusted => "trusted",
            Self::Unknown => "unknown",
            Self::HighRisk => "high_risk",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    ReadFile,
    WriteFile,
    HttpRequest,
    DatabaseQuery,
    BrowserOpen,
    SendEmail,
    ExecCommand,
    ModelRequest,
    ModelResponse,
}

impl Operation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadFile => "read_file",
            Self::WriteFile => "write_file",
            Self::HttpRequest => "http_request",
            Self::DatabaseQuery => "database_query",
            Self::BrowserOpen => "browser_open",
            Self::SendEmail => "send_email",
            Self::ExecCommand => "exec_command",
            Self::ModelRequest => "model_request",
            Self::ModelResponse => "model_response",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EnforcementAction {
    Allow,
    Warn,
    Ask,
    Block,
    Kill,
}

impl EnforcementAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Allow => "allow",
            Self::Warn => "warn",
            Self::Ask => "ask",
            Self::Block => "block",
            Self::Kill => "kill",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AgentIdentity {
    pub name: String,
    pub executable_path: Option<String>,
    pub process_id: Option<u32>,
    pub parent_process_id: Option<u32>,
    pub trust: TrustLevel,
}

impl AgentIdentity {
    pub fn named(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            executable_path: None,
            process_id: None,
            parent_process_id: None,
            trust: TrustLevel::Unknown,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ResourceTarget {
    Path(String),
    Command(String),
    Domain(String),
    Prompt(String),
    Database(String),
    None,
}

impl ResourceTarget {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Path(_) => "path",
            Self::Command(_) => "command",
            Self::Domain(_) => "domain",
            Self::Prompt(_) => "prompt",
            Self::Database(_) => "database",
            Self::None => "none",
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Path(value)
            | Self::Command(value)
            | Self::Domain(value)
            | Self::Prompt(value)
            | Self::Database(value) => Some(value),
            Self::None => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Event {
    pub layer: Layer,
    pub operation: Operation,
    pub agent: AgentIdentity,
    pub target: ResourceTarget,
    pub risk_hint: Option<RiskLevel>,
    pub metadata: Metadata,
}

impl Event {
    pub fn new(
        agent: AgentIdentity,
        layer: Layer,
        operation: Operation,
        target: ResourceTarget,
    ) -> Self {
        Self {
            layer,
            operation,
            agent,
            target,
            risk_hint: None,
            metadata: Metadata::new(),
        }
    }

    pub fn with_risk_hint(mut self, risk_hint: RiskLevel) -> Self {
        self.risk_hint = Some(risk_hint);
        self
    }

    pub fn with_metadata(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.metadata.insert(key.into(), value.into());
        self
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum MatchPattern {
    #[default]
    Any,
    Exact(String),
    Prefix(String),
    Contains(String),
    OneOf(Vec<String>),
}

impl MatchPattern {
    pub fn matches(&self, candidate: &str) -> bool {
        match self {
            Self::Any => true,
            Self::Exact(expected) => candidate == expected,
            Self::Prefix(prefix) => candidate.starts_with(prefix),
            Self::Contains(fragment) => candidate.contains(fragment),
            Self::OneOf(values) => values.iter().any(|value| candidate == value),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Rule {
    pub id: String,
    pub priority: u16,
    pub layer: Option<Layer>,
    pub operation: Option<Operation>,
    pub agent: MatchPattern,
    pub target: MatchPattern,
    pub minimum_risk: Option<RiskLevel>,
    pub action: EnforcementAction,
    pub reason: String,
}

impl Rule {
    pub fn new(
        id: impl Into<String>,
        action: EnforcementAction,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            priority: 100,
            layer: None,
            operation: None,
            agent: MatchPattern::Any,
            target: MatchPattern::Any,
            minimum_risk: None,
            action,
            reason: reason.into(),
        }
    }

    pub fn with_priority(mut self, priority: u16) -> Self {
        self.priority = priority;
        self
    }

    pub fn for_layer(mut self, layer: Layer) -> Self {
        self.layer = Some(layer);
        self
    }

    pub fn for_operation(mut self, operation: Operation) -> Self {
        self.operation = Some(operation);
        self
    }

    pub fn for_agent(mut self, agent: MatchPattern) -> Self {
        self.agent = agent;
        self
    }

    pub fn for_target(mut self, target: MatchPattern) -> Self {
        self.target = target;
        self
    }

    pub fn requiring_risk_at_least(mut self, minimum_risk: RiskLevel) -> Self {
        self.minimum_risk = Some(minimum_risk);
        self
    }

    pub fn matches(&self, event: &Event, derived_risk: RiskLevel) -> bool {
        if let Some(layer) = self.layer
            && layer != event.layer
        {
            return false;
        }

        if let Some(operation) = self.operation
            && operation != event.operation
        {
            return false;
        }

        if !self.agent.matches(&event.agent.name) {
            return false;
        }

        if let Some(target) = event.target.as_str()
            && !self.target.matches(target)
        {
            return false;
        }

        if event.target == ResourceTarget::None && !matches!(self.target, MatchPattern::Any) {
            return false;
        }

        if let Some(minimum_risk) = self.minimum_risk
            && derived_risk < minimum_risk
        {
            return false;
        }

        true
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Decision {
    pub action: EnforcementAction,
    pub risk: RiskLevel,
    pub reason: String,
    pub matched_rule_id: Option<String>,
}

impl Decision {
    pub fn new(action: EnforcementAction, risk: RiskLevel, reason: impl Into<String>) -> Self {
        Self {
            action,
            risk,
            reason: reason.into(),
            matched_rule_id: None,
        }
    }

    pub fn matched(
        action: EnforcementAction,
        risk: RiskLevel,
        reason: impl Into<String>,
        rule_id: impl Into<String>,
    ) -> Self {
        Self {
            action,
            risk,
            reason: reason.into(),
            matched_rule_id: Some(rule_id.into()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AuditRecord {
    pub id: i64,
    pub recorded_at_unix_ms: i64,
    pub event: Event,
    pub decision: Decision,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_pattern_matches_prefixes() {
        let pattern = MatchPattern::Prefix("/Users/rem/Projects/".into());
        assert!(pattern.matches("/Users/rem/Projects/demo/src/main.rs"));
        assert!(!pattern.matches("/Users/rem/Documents/notes.md"));
    }

    #[test]
    fn rule_matches_expected_event_shape() {
        let rule = Rule::new(
            "allow-project-write",
            EnforcementAction::Allow,
            "project write",
        )
        .for_layer(Layer::Tool)
        .for_operation(Operation::WriteFile)
        .for_agent(MatchPattern::Exact("Coding Assistant".into()))
        .for_target(MatchPattern::Prefix("/Users/rem/Projects/".into()));

        let event = Event::new(
            AgentIdentity::named("Coding Assistant"),
            Layer::Tool,
            Operation::WriteFile,
            ResourceTarget::Path("/Users/rem/Projects/demo/src/lib.rs".into()),
        );

        assert!(rule.matches(&event, RiskLevel::Low));
    }
}
