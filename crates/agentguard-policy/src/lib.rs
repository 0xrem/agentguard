use agentguard_models::{
    Decision, EnforcementAction, Event, Layer, MatchPattern, Operation, RiskLevel, Rule,
};
use serde::Serialize;

pub struct PolicyEngine {
    rules: Vec<Rule>,
}

impl PolicyEngine {
    pub fn new(mut rules: Vec<Rule>) -> Self {
        rules.sort_by(|left, right| right.priority.cmp(&left.priority));
        Self { rules }
    }

    pub fn mvp_defaults() -> Self {
        Self::new(default_rules())
    }

    pub fn rules(&self) -> &[Rule] {
        &self.rules
    }

    pub fn decide(&self, event: &Event) -> Decision {
        let derived_risk = derive_risk(event);

        if let Some(rule) = self
            .rules
            .iter()
            .find(|rule| rule.matches(event, derived_risk))
        {
            return Decision::matched(
                rule.action,
                derived_risk.max(rule.minimum_risk.unwrap_or(derived_risk)),
                rule.reason.clone(),
                rule.id.clone(),
            );
        }

        fallback_decision(event, derived_risk)
    }
}

pub fn default_rules() -> Vec<Rule> {
    vec![
        Rule::new(
            "allow-demo-command",
            EnforcementAction::Allow,
            "Demo command for testing AgentGuard integration.",
        )
        .with_priority(1_100)
        .for_layer(Layer::Command)
        .for_operation(Operation::ExecCommand)
        .for_target(MatchPattern::Contains("printf 'agentguard-live-demo'".into())),
        Rule::new(
            "deny-home-wipe",
            EnforcementAction::Block,
            "Destructive command targets the user's home directory.",
        )
        .with_priority(1_000)
        .for_layer(Layer::Command)
        .for_operation(Operation::ExecCommand)
        .for_target(MatchPattern::Contains("rm -rf ~".into())),
        Rule::new(
            "deny-root-wipe",
            EnforcementAction::Block,
            "Destructive command targets the filesystem root.",
        )
        .with_priority(1_000)
        .for_layer(Layer::Command)
        .for_operation(Operation::ExecCommand)
        .for_target(MatchPattern::Contains("rm -rf /".into())),
        Rule::new(
            "deny-shell-pipe-bash",
            EnforcementAction::Block,
            "Remote script execution pipeline detected.",
        )
        .with_priority(950)
        .for_layer(Layer::Command)
        .for_operation(Operation::ExecCommand)
        .for_target(MatchPattern::Contains("| bash".into())),
        Rule::new(
            "deny-shell-pipe-sh",
            EnforcementAction::Block,
            "Remote script execution pipeline detected.",
        )
        .with_priority(950)
        .for_layer(Layer::Command)
        .for_operation(Operation::ExecCommand)
        .for_target(MatchPattern::Contains("| sh".into())),
        Rule::new(
            "deny-sensitive-ssh-read",
            EnforcementAction::Block,
            "Access to SSH credentials is blocked by default.",
        )
        .with_priority(925)
        .for_layer(Layer::Tool)
        .for_operation(Operation::ReadFile)
        .for_target(MatchPattern::Contains("/.ssh/".into())),
        Rule::new(
            "deny-system-write",
            EnforcementAction::Block,
            "Writing to protected system paths is blocked by default.",
        )
        .with_priority(900)
        .for_layer(Layer::Tool)
        .for_operation(Operation::WriteFile)
        .for_target(MatchPattern::Prefix("/etc/".into())),
        Rule::new(
            "warn-prompt-injection",
            EnforcementAction::Warn,
            "Potential prompt injection markers detected.",
        )
        .with_priority(850)
        .for_layer(Layer::Prompt)
        .for_target(MatchPattern::ContainsInsensitive(
            "ignore previous instructions".into(),
        ))
        .requiring_risk_at_least(RiskLevel::High),
    ]
}

pub fn derive_risk(event: &Event) -> RiskLevel {
    let mut risk = event.risk_hint.unwrap_or(match event.layer {
        Layer::Prompt => RiskLevel::Medium,
        Layer::Tool => RiskLevel::Low,
        Layer::Command => RiskLevel::Medium,
    });

    if let Some(target) = event.target.as_str() {
        let lowercase_target = target.to_ascii_lowercase();

        if matches!(event.operation, Operation::ExecCommand)
            && DANGEROUS_COMMAND_PATTERNS
                .iter()
                .any(|pattern| lowercase_target.contains(pattern))
        {
            return RiskLevel::Critical;
        }

        if matches!(event.operation, Operation::ReadFile | Operation::WriteFile)
            && SENSITIVE_PATH_MARKERS
                .iter()
                .any(|marker| lowercase_target.contains(marker))
        {
            risk = risk.max(RiskLevel::High);
        }

        if matches!(event.layer, Layer::Prompt)
            && PROMPT_INJECTION_MARKERS
                .iter()
                .any(|marker| lowercase_target.contains(marker))
        {
            risk = risk.max(RiskLevel::High);
        }
    }

    if matches!(event.operation, Operation::HttpRequest)
        && event
            .metadata
            .get("network_direction")
            .is_some_and(|value| value == "upload")
    {
        risk = risk.max(RiskLevel::High);
    }

    if event
        .metadata
        .get("sensitive")
        .is_some_and(|value| value == "true")
    {
        risk = risk.max(RiskLevel::Critical);
    }

    risk
}

fn fallback_decision(event: &Event, risk: RiskLevel) -> Decision {
    match risk {
        RiskLevel::Critical => Decision::new(
            EnforcementAction::Block,
            risk,
            "Critical-risk event blocked by default fallback policy.",
        ),
        RiskLevel::High => Decision::new(
            EnforcementAction::Ask,
            risk,
            "High-risk event requires user confirmation.",
        ),
        RiskLevel::Medium if matches!(event.layer, Layer::Command) => Decision::new(
            EnforcementAction::Ask,
            risk,
            "Command execution requires confirmation when the risk is not clearly low.",
        ),
        _ => Decision::new(
            EnforcementAction::Allow,
            risk,
            "No blocking rule matched and the event is within the current default tolerance.",
        ),
    }
}

const DANGEROUS_COMMAND_PATTERNS: &[&str] = &[
    "rm -rf /",
    "rm -rf ~",
    "curl http",
    "wget http",
    "| bash",
    "| sh",
    "chmod 777 -r /",
];

const SENSITIVE_PATH_MARKERS: &[&str] =
    &["/.ssh/", "/.aws/", "/.gnupg/", "/etc/", ".env", "id_rsa", "/.git-credentials", "/.netrc"];

const PROMPT_INJECTION_MARKERS: &[&str] = &[
    "ignore previous instructions",
    "ignore all previous",
    "disregard the above",
    "reveal your system prompt",
    "show me your instructions",
    "upload credentials",
    "exfiltrate",
    "bypass safety",
    "jailbreak",
    "act as if",
    "pretend you are",
    "you are now",
    "new persona",
];

/// Detects known API key / secret patterns in text that may indicate data leakage risk.
/// Returns a list of (kind, redacted_hint) pairs for each finding.
pub fn scan_for_secrets(text: &str) -> Vec<(String, String)> {
    const PATTERNS: &[(&str, &str)] = &[
        ("openai_api_key",     "sk-"),
        ("anthropic_api_key",  "sk-ant-"),
        ("github_token",       "ghp_"),
        ("github_token",       "ghs_"),
        ("aws_access_key",     "AKIA"),
        ("stripe_key",         "sk_live_"),
        ("stripe_key",         "pk_live_"),
        ("slack_token",        "xoxb-"),
        ("slack_token",        "xoxp-"),
        ("google_api_key",     "AIza"),
    ];

    let mut findings = Vec::new();
    for (kind, prefix) in PATTERNS {
        if text.contains(prefix) {
            // Find the token start position and return an obfuscated hint
            if let Some(pos) = text.find(prefix) {
                let start = pos + prefix.len();
                let visible: String = text[start..].chars().take(4).collect();
                findings.push((kind.to_string(), format!("{}{}...", prefix, visible)));
            }
        }
    }
    findings
}

// ── Rule Conflict Detection ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictKind {
    /// Two rules target the same scope with opposing actions; the lower-priority one is
    /// effectively unreachable when the overlapping target matches.
    ActionConflict,
    /// A broader rule at higher priority makes the narrower one effectively unreachable.
    Shadowed,
}

#[derive(Debug, Clone, Serialize)]
pub struct RuleConflict {
    pub kind: ConflictKind,
    pub rule_a_id: String,
    pub rule_b_id: String,
    pub description: String,
}

/// Detect pairwise conflicts in a list of rules.
/// Both positional ordering (priority) and semantic scope are considered.
pub fn detect_conflicts(rules: &[Rule]) -> Vec<RuleConflict> {
    let mut conflicts = Vec::new();

    // Sort by priority descending so rule_a always has higher (or equal) priority.
    let mut sorted: Vec<&Rule> = rules.iter().collect();
    sorted.sort_by(|a, b| b.priority.cmp(&a.priority));

    for i in 0..sorted.len() {
        for j in (i + 1)..sorted.len() {
            let a = sorted[i];
            let b = sorted[j];

            if !scopes_overlap(a, b) {
                continue;
            }

            if a.action != b.action {
                let description = format!(
                    "Rule '{}' ({:?}) and rule '{}' ({:?}) overlap in scope but have conflicting actions ({:?} vs {:?}). The higher-priority rule '{}' will shadow '{}' for matching events.",
                    a.id, a.action, b.id, b.action, a.action, b.action, a.id, b.id
                );
                conflicts.push(RuleConflict {
                    kind: ConflictKind::ActionConflict,
                    rule_a_id: a.id.clone(),
                    rule_b_id: b.id.clone(),
                    description,
                });
            } else if target_a_broader_than_b(a, b) {
                let description = format!(
                    "Rule '{}' has a broader target pattern than '{}' and higher priority with the same action — '{}' may never fire.",
                    a.id, b.id, b.id
                );
                conflicts.push(RuleConflict {
                    kind: ConflictKind::Shadowed,
                    rule_a_id: a.id.clone(),
                    rule_b_id: b.id.clone(),
                    description,
                });
            }
        }
    }

    conflicts
}

fn scopes_overlap(a: &Rule, b: &Rule) -> bool {
    // Layer must match or at least one is None (matches any layer)
    let layer_overlap = match (a.layer, b.layer) {
        (None, _) | (_, None) => true,
        (Some(la), Some(lb)) => la == lb,
    };
    if !layer_overlap {
        return false;
    }

    // Operation must match or at least one is None
    let op_overlap = match (a.operation, b.operation) {
        (None, _) | (_, None) => true,
        (Some(oa), Some(ob)) => oa == ob,
    };

    op_overlap
}

fn target_a_broader_than_b(a: &Rule, b: &Rule) -> bool {
    // Any target is always broader
    matches!(a.target, MatchPattern::Any)
        && !matches!(b.target, MatchPattern::Any)
}


#[cfg(test)]
mod tests {
    use agentguard_models::{AgentIdentity, MatchPattern, ResourceTarget};

    use super::*;

    #[test]
    fn blocks_destructive_command() {
        let engine = PolicyEngine::mvp_defaults();
        let event = Event::new(
            AgentIdentity::named("Claude Code"),
            Layer::Command,
            Operation::ExecCommand,
            ResourceTarget::Command("rm -rf ~".into()),
        );

        let decision = engine.decide(&event);

        assert_eq!(decision.action, EnforcementAction::Block);
        assert_eq!(decision.matched_rule_id.as_deref(), Some("deny-home-wipe"));
        assert_eq!(decision.risk, RiskLevel::Critical);
    }

    #[test]
    fn blocks_sensitive_ssh_reads() {
        let engine = PolicyEngine::mvp_defaults();
        let event = Event::new(
            AgentIdentity::named("Unknown"),
            Layer::Tool,
            Operation::ReadFile,
            ResourceTarget::Path("/Users/rem/.ssh/id_rsa".into()),
        );

        let decision = engine.decide(&event);

        assert_eq!(decision.action, EnforcementAction::Block);
        assert_eq!(
            decision.matched_rule_id.as_deref(),
            Some("deny-sensitive-ssh-read")
        );
    }

    #[test]
    fn asks_before_unknown_uploads() {
        let engine = PolicyEngine::mvp_defaults();
        let event = Event::new(
            AgentIdentity::named("AutoGPT"),
            Layer::Tool,
            Operation::HttpRequest,
            ResourceTarget::Domain("api.attacker.example".into()),
        )
        .with_metadata("network_direction", "upload");

        let decision = engine.decide(&event);

        assert_eq!(decision.action, EnforcementAction::Ask);
        assert_eq!(decision.risk, RiskLevel::High);
        assert_eq!(decision.matched_rule_id, None);
    }

    #[test]
    fn custom_project_write_rule_wins() {
        let custom_rule = Rule::new(
            "allow-project-writes",
            EnforcementAction::Allow,
            "Known coding assistant may write inside the project workspace.",
        )
        .with_priority(1_100)
        .for_layer(Layer::Tool)
        .for_operation(Operation::WriteFile)
        .for_agent(MatchPattern::Exact("Coding Assistant".into()))
        .for_target(MatchPattern::Prefix("/Users/rem/Projects/".into()));

        let engine = PolicyEngine::new(
            std::iter::once(custom_rule)
                .chain(default_rules())
                .collect::<Vec<_>>(),
        );

        let event = Event::new(
            AgentIdentity::named("Coding Assistant"),
            Layer::Tool,
            Operation::WriteFile,
            ResourceTarget::Path("/Users/rem/Projects/agentguard/src/main.rs".into()),
        );

        let decision = engine.decide(&event);

        assert_eq!(decision.action, EnforcementAction::Allow);
        assert_eq!(
            decision.matched_rule_id.as_deref(),
            Some("allow-project-writes")
        );
    }
}
