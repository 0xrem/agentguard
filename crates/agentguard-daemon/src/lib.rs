use std::{error::Error, fmt};

use agentguard_models::{AuditRecord, Event};
use agentguard_policy::PolicyEngine;
use agentguard_store::{AuditStore, StoreError};

#[derive(Debug)]
pub enum DaemonError {
    Store(StoreError),
}

impl fmt::Display for DaemonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Store(error) => write!(f, "{error}"),
        }
    }
}

impl Error for DaemonError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Store(error) => Some(error),
        }
    }
}

impl From<StoreError> for DaemonError {
    fn from(value: StoreError) -> Self {
        Self::Store(value)
    }
}

pub type Result<T> = std::result::Result<T, DaemonError>;

pub struct AgentGuardDaemon {
    policy: PolicyEngine,
    store: AuditStore,
}

impl AgentGuardDaemon {
    pub fn new(policy: PolicyEngine, store: AuditStore) -> Self {
        Self { policy, store }
    }

    pub fn with_mvp_defaults(store: AuditStore) -> Self {
        Self::new(PolicyEngine::mvp_defaults(), store)
    }

    pub fn rule_count(&self) -> usize {
        self.policy.rules().len()
    }

    pub fn process_event(&self, event: Event) -> Result<AuditRecord> {
        let decision = self.policy.decide(&event);
        self.store
            .record_event(&event, &decision)
            .map_err(Into::into)
    }

    pub fn recent_audit_records(&self, limit: usize) -> Result<Vec<AuditRecord>> {
        self.store.recent_audit_records(limit).map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use agentguard_models::{AgentIdentity, EnforcementAction, Layer, Operation, ResourceTarget};
    use agentguard_store::AuditStore;

    use super::*;

    #[test]
    fn processing_event_persists_audit_record() {
        let daemon = AgentGuardDaemon::with_mvp_defaults(
            AuditStore::open_in_memory().expect("store should initialize"),
        );
        let event = Event::new(
            AgentIdentity::named("Claude Code"),
            Layer::Command,
            Operation::ExecCommand,
            ResourceTarget::Command("rm -rf ~".into()),
        );

        let record = daemon
            .process_event(event.clone())
            .expect("event should be processed");
        let recent = daemon
            .recent_audit_records(5)
            .expect("recent records should load");

        assert_eq!(record.event, event);
        assert_eq!(record.decision.action, EnforcementAction::Block);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0], record);
    }
}
