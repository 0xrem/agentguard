use agentguard_models::{AgentIdentity, Event, Layer, Operation, ResourceTarget};
use agentguard_policy::PolicyEngine;

fn main() {
    let engine = PolicyEngine::mvp_defaults();
    let sample_event = Event::new(
        AgentIdentity::named("Claude Code"),
        Layer::Command,
        Operation::ExecCommand,
        ResourceTarget::Command("rm -rf ~".into()),
    );
    let decision = engine.decide(&sample_event);

    println!("agentguard-daemon bootstrap ready");
    println!("default rule count: {}", engine.rules().len());
    println!(
        "{}",
        serde_json::to_string_pretty(&decision).expect("decision should serialize")
    );
}
