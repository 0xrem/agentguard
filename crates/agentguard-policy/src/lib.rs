use agentguard_models::{
    Decision, EnforcementAction, Event, Layer, MatchPattern, Operation, RiskLevel, Rule,
};

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
    &["/.ssh/", "/.aws/", "/.gnupg/", "/etc/", ".env", "id_rsa"];

const PROMPT_INJECTION_MARKERS: &[&str] = &[
    "ignore previous instructions",
    "reveal your system prompt",
    "upload credentials",
];

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
