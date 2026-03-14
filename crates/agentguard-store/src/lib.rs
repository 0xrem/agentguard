use std::{
    error::Error,
    fmt, fs, io,
    path::Path,
    time::{SystemTime, SystemTimeError, UNIX_EPOCH},
};

use agentguard_models::{AuditRecord, Decision, Event};
use rusqlite::{Connection, params};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS audit_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at_unix_ms INTEGER NOT NULL,
    layer TEXT NOT NULL,
    operation TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    action TEXT NOT NULL,
    risk TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_value TEXT,
    matched_rule_id TEXT,
    reason TEXT NOT NULL,
    event_json TEXT NOT NULL,
    decision_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_records_recorded_at
ON audit_records(recorded_at_unix_ms DESC, id DESC);
"#;

#[derive(Debug)]
pub enum StoreError {
    Io(io::Error),
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    Time(SystemTimeError),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "i/o error: {error}"),
            Self::Sqlite(error) => write!(f, "sqlite error: {error}"),
            Self::Json(error) => write!(f, "json error: {error}"),
            Self::Time(error) => write!(f, "system time error: {error}"),
        }
    }
}

impl Error for StoreError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Sqlite(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::Time(error) => Some(error),
        }
    }
}

impl From<io::Error> for StoreError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<rusqlite::Error> for StoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl From<SystemTimeError> for StoreError {
    fn from(value: SystemTimeError) -> Self {
        Self::Time(value)
    }
}

pub type Result<T> = std::result::Result<T, StoreError>;

pub struct AuditStore {
    connection: Connection,
}

impl AuditStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();

        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(path)?;
        let store = Self { connection };
        store.initialize()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self> {
        let connection = Connection::open_in_memory()?;
        let store = Self { connection };
        store.initialize()?;
        Ok(store)
    }

    pub fn record_event(&self, event: &Event, decision: &Decision) -> Result<AuditRecord> {
        let recorded_at_unix_ms = unix_timestamp_ms()?;
        let event_json = serde_json::to_string(event)?;
        let decision_json = serde_json::to_string(decision)?;
        let target_value = event.target.as_str();

        self.connection.execute(
            r#"
            INSERT INTO audit_records (
                recorded_at_unix_ms,
                layer,
                operation,
                agent_name,
                action,
                risk,
                target_kind,
                target_value,
                matched_rule_id,
                reason,
                event_json,
                decision_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
            params![
                recorded_at_unix_ms,
                event.layer.as_str(),
                event.operation.as_str(),
                event.agent.name.as_str(),
                decision.action.as_str(),
                decision.risk.as_str(),
                event.target.kind(),
                target_value,
                decision.matched_rule_id.as_deref(),
                decision.reason.as_str(),
                event_json,
                decision_json,
            ],
        )?;

        let id = self.connection.last_insert_rowid();

        Ok(AuditRecord {
            id,
            recorded_at_unix_ms,
            event: event.clone(),
            decision: decision.clone(),
        })
    }

    pub fn recent_audit_records(&self, limit: usize) -> Result<Vec<AuditRecord>> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let mut statement = self.connection.prepare(
            r#"
            SELECT
                id,
                recorded_at_unix_ms,
                event_json,
                decision_json
            FROM audit_records
            ORDER BY recorded_at_unix_ms DESC, id DESC
            LIMIT ?1
            "#,
        )?;

        let rows = statement.query_map(params![limit as i64], |row| {
            let event_json: String = row.get(2)?;
            let decision_json: String = row.get(3)?;
            let event: Event = serde_json::from_str(&event_json).map_err(json_decode_error)?;
            let decision: Decision =
                serde_json::from_str(&decision_json).map_err(json_decode_error)?;

            Ok(AuditRecord {
                id: row.get(0)?,
                recorded_at_unix_ms: row.get(1)?,
                event,
                decision,
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    pub fn record_count(&self) -> Result<i64> {
        self.connection
            .query_row("SELECT COUNT(*) FROM audit_records", [], |row| row.get(0))
            .map_err(StoreError::from)
    }

    fn initialize(&self) -> Result<()> {
        self.connection.execute_batch(SCHEMA)?;
        Ok(())
    }
}

fn json_decode_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn unix_timestamp_ms() -> Result<i64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use agentguard_models::{AgentIdentity, EnforcementAction, Layer, Operation, ResourceTarget};

    use super::*;

    #[test]
    fn records_and_loads_audit_entries() {
        let store = AuditStore::open_in_memory().expect("in-memory store should initialize");
        let event = Event::new(
            AgentIdentity::named("Claude Code"),
            Layer::Command,
            Operation::ExecCommand,
            ResourceTarget::Command("rm -rf ~".into()),
        );
        let decision = Decision::matched(
            EnforcementAction::Block,
            agentguard_models::RiskLevel::Critical,
            "Destructive command targets the user's home directory.",
            "deny-home-wipe",
        );

        let record = store
            .record_event(&event, &decision)
            .expect("record should persist");
        let recent = store
            .recent_audit_records(10)
            .expect("records should load back");

        assert!(record.id > 0);
        assert_eq!(store.record_count().expect("count should load"), 1);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].event, event);
        assert_eq!(recent[0].decision, decision);
    }
}
