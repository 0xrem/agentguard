use std::{
    error::Error,
    fmt, fs, io,
    path::Path,
    time::{SystemTime, SystemTimeError, UNIX_EPOCH},
};

use agentguard_models::{
    ApprovalRequest, ApprovalStatus, AuditRecord, Decision, EnforcementAction, Event,
};
use rusqlite::{Connection, OptionalExtension, params};

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

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

CREATE TABLE IF NOT EXISTS approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_record_id INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL,
    created_at_unix_ms INTEGER NOT NULL,
    resolved_at_unix_ms INTEGER,
    requested_decision_json TEXT NOT NULL,
    resolved_decision_json TEXT,
    decided_by TEXT,
    resolution_note TEXT,
    FOREIGN KEY (audit_record_id) REFERENCES audit_records(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status_created
ON approval_requests(status, created_at_unix_ms DESC, id DESC);
"#;

const APPROVAL_REQUEST_COLUMNS: &str = r#"
    ap.id,
    ap.audit_record_id,
    ap.status,
    ap.created_at_unix_ms,
    ap.resolved_at_unix_ms,
    ap.requested_decision_json,
    ap.resolved_decision_json,
    ap.decided_by,
    ap.resolution_note,
    ar.recorded_at_unix_ms,
    ar.event_json,
    ar.decision_json
"#;

#[derive(Debug)]
pub enum StoreError {
    Io(io::Error),
    InvalidInput(String),
    Json(serde_json::Error),
    Sqlite(rusqlite::Error),
    Time(SystemTimeError),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "i/o error: {error}"),
            Self::InvalidInput(message) => write!(f, "{message}"),
            Self::Json(error) => write!(f, "json error: {error}"),
            Self::Sqlite(error) => write!(f, "sqlite error: {error}"),
            Self::Time(error) => write!(f, "system time error: {error}"),
        }
    }
}

impl Error for StoreError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::Sqlite(error) => Some(error),
            Self::Time(error) => Some(error),
            Self::InvalidInput(_) => None,
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

    pub fn update_audit_record_decision(
        &self,
        audit_record_id: i64,
        decision: &Decision,
    ) -> Result<Option<AuditRecord>> {
        let decision_json = serde_json::to_string(decision)?;
        self.connection.execute(
            r#"
            UPDATE audit_records
            SET action = ?2,
                risk = ?3,
                matched_rule_id = ?4,
                reason = ?5,
                decision_json = ?6
            WHERE id = ?1
            "#,
            params![
                audit_record_id,
                decision.action.as_str(),
                decision.risk.as_str(),
                decision.matched_rule_id.as_deref(),
                decision.reason.as_str(),
                decision_json,
            ],
        )?;

        self.get_audit_record(audit_record_id)
    }

    pub fn get_audit_record(&self, audit_record_id: i64) -> Result<Option<AuditRecord>> {
        self.connection
            .query_row(
                r#"
                SELECT id, recorded_at_unix_ms, event_json, decision_json
                FROM audit_records
                WHERE id = ?1
                "#,
                params![audit_record_id],
                |row| {
                    Ok(AuditRecord {
                        id: row.get(0)?,
                        recorded_at_unix_ms: row.get(1)?,
                        event: serde_json::from_str(&row.get::<_, String>(2)?)
                            .map_err(json_decode_error)?,
                        decision: serde_json::from_str(&row.get::<_, String>(3)?)
                            .map_err(json_decode_error)?,
                    })
                },
            )
            .optional()
            .map_err(StoreError::from)
    }

    pub fn create_approval_request(&self, audit_record: &AuditRecord) -> Result<ApprovalRequest> {
        let created_at_unix_ms = unix_timestamp_ms()?;
        let requested_decision_json = serde_json::to_string(&audit_record.decision)?;

        self.connection.execute(
            r#"
            INSERT INTO approval_requests (
                audit_record_id,
                status,
                created_at_unix_ms,
                requested_decision_json
            ) VALUES (?1, ?2, ?3, ?4)
            "#,
            params![
                audit_record.id,
                ApprovalStatus::Pending.as_str(),
                created_at_unix_ms,
                requested_decision_json,
            ],
        )?;

        let approval_id = self.connection.last_insert_rowid();
        self.get_approval_request(approval_id)?
            .ok_or_else(|| StoreError::InvalidInput("approval request was not found after insert".into()))
    }

    pub fn resolve_approval_request(
        &self,
        approval_id: i64,
        final_decision: &Decision,
        decided_by: &str,
        resolution_note: Option<&str>,
    ) -> Result<Option<ApprovalRequest>> {
        let current = match self.get_approval_request(approval_id)? {
            Some(request) => request,
            None => return Ok(None),
        };

        if current.status != ApprovalStatus::Pending {
            return Ok(Some(current));
        }

        let status = approval_status_for_action(final_decision.action)?;
        let resolved_at_unix_ms = unix_timestamp_ms()?;
        let resolved_decision_json = serde_json::to_string(final_decision)?;

        self.update_audit_record_decision(current.audit_record.id, final_decision)?;
        self.connection.execute(
            r#"
            UPDATE approval_requests
            SET status = ?2,
                resolved_at_unix_ms = ?3,
                resolved_decision_json = ?4,
                decided_by = ?5,
                resolution_note = ?6
            WHERE id = ?1
            "#,
            params![
                approval_id,
                status.as_str(),
                resolved_at_unix_ms,
                resolved_decision_json,
                decided_by,
                resolution_note,
            ],
        )?;

        self.get_approval_request(approval_id)
    }

    pub fn get_approval_request(&self, approval_id: i64) -> Result<Option<ApprovalRequest>> {
        let sql = format!(
            r#"
            SELECT {columns}
            FROM approval_requests ap
            JOIN audit_records ar ON ar.id = ap.audit_record_id
            WHERE ap.id = ?1
            "#,
            columns = APPROVAL_REQUEST_COLUMNS
        );

        self.connection
            .query_row(&sql, params![approval_id], approval_request_from_row)
            .optional()
            .map_err(StoreError::from)
    }

    pub fn list_approval_requests(
        &self,
        limit: usize,
        pending_only: bool,
    ) -> Result<Vec<ApprovalRequest>> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let mut statement = if pending_only {
            self.connection.prepare(&format!(
                r#"
                SELECT {columns}
                FROM approval_requests ap
                JOIN audit_records ar ON ar.id = ap.audit_record_id
                WHERE ap.status = ?1
                ORDER BY ap.created_at_unix_ms DESC, ap.id DESC
                LIMIT ?2
                "#,
                columns = APPROVAL_REQUEST_COLUMNS
            ))?
        } else {
            self.connection.prepare(&format!(
                r#"
                SELECT {columns}
                FROM approval_requests ap
                JOIN audit_records ar ON ar.id = ap.audit_record_id
                ORDER BY ap.created_at_unix_ms DESC, ap.id DESC
                LIMIT ?1
                "#,
                columns = APPROVAL_REQUEST_COLUMNS
            ))?
        };

        let rows = if pending_only {
            statement.query_map(params![ApprovalStatus::Pending.as_str(), limit as i64], approval_request_from_row)?
        } else {
            statement.query_map(params![limit as i64], approval_request_from_row)?
        };

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(StoreError::from)
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

fn approval_request_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ApprovalRequest> {
    let status = parse_approval_status(&row.get::<_, String>(2)?).map_err(to_from_sql_error)?;
    let event: Event =
        serde_json::from_str(&row.get::<_, String>(10)?).map_err(json_decode_error)?;
    let current_decision: Decision =
        serde_json::from_str(&row.get::<_, String>(11)?).map_err(json_decode_error)?;
    let requested_decision: Decision =
        serde_json::from_str(&row.get::<_, String>(5)?).map_err(json_decode_error)?;
    let resolved_decision = row
        .get::<_, Option<String>>(6)?
        .map(|value| serde_json::from_str(&value).map_err(json_decode_error))
        .transpose()?;

    Ok(ApprovalRequest {
        id: row.get(0)?,
        created_at_unix_ms: row.get(3)?,
        resolved_at_unix_ms: row.get(4)?,
        status,
        audit_record: AuditRecord {
            id: row.get(1)?,
            recorded_at_unix_ms: row.get(9)?,
            event,
            decision: current_decision,
        },
        requested_decision,
        resolved_decision,
        decided_by: row.get(7)?,
        resolution_note: row.get(8)?,
    })
}

fn approval_status_for_action(action: EnforcementAction) -> Result<ApprovalStatus> {
    match action {
        EnforcementAction::Allow | EnforcementAction::Warn => Ok(ApprovalStatus::Approved),
        EnforcementAction::Block => Ok(ApprovalStatus::Denied),
        EnforcementAction::Kill => Ok(ApprovalStatus::Killed),
        EnforcementAction::Ask => Err(StoreError::InvalidInput(
            "approval resolution action cannot be ask".into(),
        )),
    }
}

fn parse_approval_status(value: &str) -> Result<ApprovalStatus> {
    match value {
        "pending" => Ok(ApprovalStatus::Pending),
        "approved" => Ok(ApprovalStatus::Approved),
        "denied" => Ok(ApprovalStatus::Denied),
        "killed" => Ok(ApprovalStatus::Killed),
        "expired" => Ok(ApprovalStatus::Expired),
        _ => Err(StoreError::InvalidInput(format!(
            "unknown approval status: {value}"
        ))),
    }
}

fn json_decode_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn to_from_sql_error(error: StoreError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn unix_timestamp_ms() -> Result<i64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use agentguard_models::{
        AgentIdentity, ApprovalStatus, EnforcementAction, Layer, Operation, ResourceTarget,
        RiskLevel,
    };

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
            RiskLevel::Critical,
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

    #[test]
    fn creates_and_resolves_approval_requests() {
        let store = AuditStore::open_in_memory().expect("in-memory store should initialize");
        let event = Event::new(
            AgentIdentity::named("Claude Code"),
            Layer::Tool,
            Operation::HttpRequest,
            ResourceTarget::Domain("api.unknown-upload.example".into()),
        )
        .with_metadata("network_direction", "upload");
        let initial_decision = Decision::new(
            EnforcementAction::Ask,
            RiskLevel::High,
            "High-risk event requires user confirmation.",
        );
        let audit_record = store
            .record_event(&event, &initial_decision)
            .expect("audit record should persist");

        let approval = store
            .create_approval_request(&audit_record)
            .expect("approval request should persist");
        assert_eq!(approval.status, ApprovalStatus::Pending);

        let resolved = store
            .resolve_approval_request(
                approval.id,
                &Decision::new(
                    EnforcementAction::Allow,
                    RiskLevel::High,
                    "Approved by desktop operator.",
                ),
                "desktop-operator",
                Some("Looks safe."),
            )
            .expect("approval should resolve")
            .expect("resolved approval should exist");

        assert_eq!(resolved.status, ApprovalStatus::Approved);
        assert_eq!(resolved.audit_record.decision.action, EnforcementAction::Allow);
        assert_eq!(resolved.decided_by.as_deref(), Some("desktop-operator"));
        assert_eq!(resolved.resolution_note.as_deref(), Some("Looks safe."));
        assert_eq!(resolved.resolved_decision.as_ref().map(|d| d.action), Some(EnforcementAction::Allow));
    }

    #[test]
    fn lists_pending_approvals_only() {
        let store = AuditStore::open_in_memory().expect("in-memory store should initialize");
        for domain in ["pending.example", "resolved.example"] {
            let event = Event::new(
                AgentIdentity::named("Claude Code"),
                Layer::Tool,
                Operation::HttpRequest,
                ResourceTarget::Domain(domain.into()),
            )
            .with_metadata("network_direction", "upload");
            let audit_record = store
                .record_event(
                    &event,
                    &Decision::new(
                        EnforcementAction::Ask,
                        RiskLevel::High,
                        "High-risk event requires user confirmation.",
                    ),
                )
                .expect("audit record should persist");
            let approval = store
                .create_approval_request(&audit_record)
                .expect("approval should persist");

            if domain == "resolved.example" {
                store
                    .resolve_approval_request(
                        approval.id,
                        &Decision::new(
                            EnforcementAction::Block,
                            RiskLevel::High,
                            "Denied by desktop operator.",
                        ),
                        "desktop-operator",
                        None,
                    )
                    .expect("approval should resolve");
            }
        }

        let pending = store
            .list_approval_requests(10, true)
            .expect("pending approvals should load");

        assert_eq!(pending.len(), 1);
        assert_eq!(
            pending[0].audit_record.event.target.as_str(),
            Some("pending.example")
        );
    }
}
