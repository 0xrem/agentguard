use std::error::Error;

use agentguard_daemon::AgentGuardDaemon;
use agentguard_models::{AgentIdentity, Event, Layer, Operation, ResourceTarget};
use agentguard_store::AuditStore;

fn main() -> Result<(), Box<dyn Error>> {
    let db_path =
        std::env::var("AGENTGUARD_DB_PATH").unwrap_or_else(|_| "agentguard-dev.db".into());
    let daemon = AgentGuardDaemon::with_mvp_defaults(AuditStore::open(&db_path)?);
    let sample_event = Event::new(
        AgentIdentity::named("Claude Code"),
        Layer::Command,
        Operation::ExecCommand,
        ResourceTarget::Command("rm -rf ~".into()),
    );
    let record = daemon.process_event(sample_event)?;

    println!("agentguard-daemon bootstrap ready");
    println!("database: {db_path}");
    println!("default rule count: {}", daemon.rule_count());
    println!(
        "{}",
        serde_json::to_string_pretty(&record).expect("audit record should serialize")
    );

    Ok(())
}
