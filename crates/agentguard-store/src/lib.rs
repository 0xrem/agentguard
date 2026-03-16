use std::{
    collections::BTreeMap,
    collections::BTreeSet,
    error::Error,
    fmt, fs, io,
    path::Path,
    time::{SystemTime, SystemTimeError, UNIX_EPOCH},
};

use agentguard_models::{
    ApprovalRequest, ApprovalStatus, AuditRecord, Decision, EnforcementAction, Event, ManagedRule,
    Rule,
};
use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value};
use serde::{Deserialize, Serialize};

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

CREATE TABLE IF NOT EXISTS audit_reviews (
    audit_record_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    label TEXT,
    note TEXT,
    reviewed_by TEXT,
    updated_at_unix_ms INTEGER NOT NULL,
    FOREIGN KEY (audit_record_id) REFERENCES audit_records(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_reviews_status_updated
ON audit_reviews(status, updated_at_unix_ms DESC, audit_record_id DESC);

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

CREATE TABLE IF NOT EXISTS policy_rules (
    id TEXT PRIMARY KEY,
    created_at_unix_ms INTEGER NOT NULL,
    updated_at_unix_ms INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    rule_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_policy_rules_created
ON policy_rules(created_at_unix_ms DESC, id DESC);
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

#[derive(Debug, Default, Clone)]
pub struct AuditRecordQuery {
    pub layer: Option<String>,
    pub agent_name: Option<String>,
    pub operation: Option<String>,
    pub action: Option<String>,
    pub risk_level: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub limit: usize,
    pub offset: usize,
}

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
        self.get_approval_request(approval_id)?.ok_or_else(|| {
            StoreError::InvalidInput("approval request was not found after insert".into())
        })
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
            statement.query_map(
                params![ApprovalStatus::Pending.as_str(), limit as i64],
                approval_request_from_row,
            )?
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

    pub fn query_audit_records(&self, query: &AuditRecordQuery) -> Result<Vec<AuditRecord>> {
        let limit = query.limit;
        if limit == 0 {
            return Ok(Vec::new());
        }

        let mut sql = String::from(
            r#"
            SELECT
                id,
                recorded_at_unix_ms,
                event_json,
                decision_json
            FROM audit_records
            WHERE 1 = 1
            "#,
        );
        let mut bind_values: Vec<Value> = Vec::new();

        if let Some(layer) = &query.layer {
            sql.push_str(" AND layer = ?");
            bind_values.push(Value::from(layer.clone()));
        }
        if let Some(agent_name) = &query.agent_name {
            sql.push_str(" AND lower(agent_name) LIKE lower(?)");
            bind_values.push(Value::from(format!("%{agent_name}%")));
        }
        if let Some(operation) = &query.operation {
            sql.push_str(" AND operation = ?");
            bind_values.push(Value::from(operation.clone()));
        }
        if let Some(action) = &query.action {
            sql.push_str(" AND action = ?");
            bind_values.push(Value::from(action.clone()));
        }
        if let Some(risk_level) = &query.risk_level {
            sql.push_str(" AND risk = ?");
            bind_values.push(Value::from(risk_level.clone()));
        }
        if let Some(start_time) = query.start_time {
            sql.push_str(" AND recorded_at_unix_ms >= ?");
            bind_values.push(Value::from(start_time));
        }
        if let Some(end_time) = query.end_time {
            sql.push_str(" AND recorded_at_unix_ms <= ?");
            bind_values.push(Value::from(end_time));
        }

        sql.push_str(" ORDER BY recorded_at_unix_ms DESC, id DESC LIMIT ? OFFSET ?");
        bind_values.push(Value::from(limit as i64));
        bind_values.push(Value::from(query.offset as i64));

        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(bind_values.iter()), |row| {
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

    pub fn upsert_audit_review(
        &self,
        audit_record_id: i64,
        status: &str,
        label: Option<&str>,
        note: Option<&str>,
        reviewed_by: Option<&str>,
    ) -> Result<AuditReview> {
        validate_audit_review_status(status)?;

        if self.get_audit_record(audit_record_id)?.is_none() {
            return Err(StoreError::InvalidInput(format!(
                "audit record not found: {audit_record_id}"
            )));
        }

        let updated_at_unix_ms = unix_timestamp_ms()?;
        self.connection.execute(
            r#"
            INSERT INTO audit_reviews (
                audit_record_id,
                status,
                label,
                note,
                reviewed_by,
                updated_at_unix_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(audit_record_id) DO UPDATE SET
                status = excluded.status,
                label = excluded.label,
                note = excluded.note,
                reviewed_by = excluded.reviewed_by,
                updated_at_unix_ms = excluded.updated_at_unix_ms
            "#,
            params![
                audit_record_id,
                status,
                label,
                note,
                reviewed_by,
                updated_at_unix_ms,
            ],
        )?;

        self.get_audit_review(audit_record_id)?.ok_or_else(|| {
            StoreError::InvalidInput("audit review was not found after save".into())
        })
    }

    pub fn get_audit_review(&self, audit_record_id: i64) -> Result<Option<AuditReview>> {
        self.connection
            .query_row(
                r#"
                SELECT audit_record_id, status, label, note, reviewed_by, updated_at_unix_ms
                FROM audit_reviews
                WHERE audit_record_id = ?1
                "#,
                params![audit_record_id],
                |row| {
                    Ok(AuditReview {
                        audit_record_id: row.get(0)?,
                        status: row.get(1)?,
                        label: row.get(2)?,
                        note: row.get(3)?,
                        reviewed_by: row.get(4)?,
                        updated_at_unix_ms: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(StoreError::from)
    }

    pub fn list_audit_reviews(
        &self,
        record_ids: &[i64],
        status: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<AuditReview>> {
        if let Some(status) = status {
            validate_audit_review_status(status)?;
        }

        if limit == 0 {
            return Ok(Vec::new());
        }

        let mut sql = String::from(
            r#"
            SELECT audit_record_id, status, label, note, reviewed_by, updated_at_unix_ms
            FROM audit_reviews
            WHERE 1 = 1
            "#,
        );
        let mut bind_values: Vec<Value> = Vec::new();

        if let Some(status) = status {
            sql.push_str(" AND status = ?");
            bind_values.push(Value::from(status.to_string()));
        }

        if !record_ids.is_empty() {
            sql.push_str(" AND audit_record_id IN (");
            for (i, record_id) in record_ids.iter().enumerate() {
                if i > 0 {
                    sql.push_str(", ");
                }
                sql.push('?');
                bind_values.push(Value::from(*record_id));
            }
            sql.push(')');
        }

        sql.push_str(" ORDER BY updated_at_unix_ms DESC, audit_record_id DESC LIMIT ? OFFSET ?");
        bind_values.push(Value::from(limit as i64));
        bind_values.push(Value::from(offset as i64));

        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(bind_values.iter()), |row| {
            Ok(AuditReview {
                audit_record_id: row.get(0)?,
                status: row.get(1)?,
                label: row.get(2)?,
                note: row.get(3)?,
                reviewed_by: row.get(4)?,
                updated_at_unix_ms: row.get(5)?,
            })
        })?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    pub fn save_rule(&self, rule: &Rule) -> Result<ManagedRule> {
        if rule.id.trim().is_empty() {
            return Err(StoreError::InvalidInput(
                "policy rule id cannot be empty".into(),
            ));
        }

        if rule.reason.trim().is_empty() {
            return Err(StoreError::InvalidInput(
                "policy rule reason cannot be empty".into(),
            ));
        }

        let now = unix_timestamp_ms()?;
        let existing = self.get_rule(&rule.id)?;
        let created_at_unix_ms = existing
            .as_ref()
            .map(|managed| managed.created_at_unix_ms)
            .unwrap_or(now);
        let enabled = existing
            .as_ref()
            .map(|managed| managed.enabled)
            .unwrap_or(true);
        let rule_json = serde_json::to_string(rule)?;

        self.connection.execute(
            r#"
            INSERT INTO policy_rules (id, created_at_unix_ms, updated_at_unix_ms, enabled, rule_json)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
                updated_at_unix_ms = excluded.updated_at_unix_ms,
                enabled = excluded.enabled,
                rule_json = excluded.rule_json
            "#,
            params![
                rule.id.as_str(),
                created_at_unix_ms,
                now,
                if enabled { 1 } else { 0 },
                rule_json
            ],
        )?;

        self.get_rule(&rule.id)?
            .ok_or_else(|| StoreError::InvalidInput("policy rule was not found after save".into()))
    }

    pub fn get_rule(&self, rule_id: &str) -> Result<Option<ManagedRule>> {
        self.connection
            .query_row(
                r#"
                SELECT id, created_at_unix_ms, updated_at_unix_ms, enabled, rule_json
                FROM policy_rules
                WHERE id = ?1
                "#,
                params![rule_id],
                managed_rule_from_row,
            )
            .optional()
            .map_err(StoreError::from)
    }

    pub fn list_rules(&self) -> Result<Vec<ManagedRule>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, created_at_unix_ms, updated_at_unix_ms, enabled, rule_json
            FROM policy_rules
            ORDER BY updated_at_unix_ms DESC, id DESC
            "#,
        )?;

        let rows = statement.query_map([], managed_rule_from_row)?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    pub fn enabled_rules(&self) -> Result<Vec<Rule>> {
        Ok(self
            .list_rules()?
            .into_iter()
            .filter(|managed_rule| managed_rule.enabled)
            .map(|managed_rule| managed_rule.rule)
            .collect())
    }

    pub fn set_rule_enabled(&self, rule_id: &str, enabled: bool) -> Result<Option<ManagedRule>> {
        let now = unix_timestamp_ms()?;
        let updated = self.connection.execute(
            r#"
            UPDATE policy_rules
            SET enabled = ?2,
                updated_at_unix_ms = ?3
            WHERE id = ?1
            "#,
            params![rule_id, if enabled { 1 } else { 0 }, now],
        )?;

        if updated == 0 {
            return Ok(None);
        }

        self.get_rule(rule_id)
    }

    pub fn delete_rule(&self, rule_id: &str) -> Result<bool> {
        Ok(self.connection.execute(
            r#"
            DELETE FROM policy_rules
            WHERE id = ?1
            "#,
            params![rule_id],
        )? > 0)
    }

    pub fn record_count(&self) -> Result<i64> {
        self.connection
            .query_row("SELECT COUNT(*) FROM audit_records", [], |row| row.get(0))
            .map_err(StoreError::from)
    }

    pub fn audit_stats(&self, since_unix_ms: i64) -> Result<AuditStats> {
        let total: usize = self.connection.query_row(
            "SELECT COUNT(*) FROM audit_records WHERE recorded_at_unix_ms >= ?1",
            params![since_unix_ms],
            |row| row.get::<_, i64>(0),
        )? as usize;

        let mut by_action: BTreeMap<String, usize> = BTreeMap::new();
        {
            let mut stmt = self.connection.prepare(
                "SELECT action, COUNT(*) FROM audit_records WHERE recorded_at_unix_ms >= ?1 GROUP BY action",
            )?;
            let rows = stmt.query_map(params![since_unix_ms], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
            })?;
            for row in rows {
                let (k, v) = row?;
                by_action.insert(k, v);
            }
        }

        let mut by_risk: BTreeMap<String, usize> = BTreeMap::new();
        {
            let mut stmt = self.connection.prepare(
                "SELECT risk, COUNT(*) FROM audit_records WHERE recorded_at_unix_ms >= ?1 GROUP BY risk",
            )?;
            let rows = stmt.query_map(params![since_unix_ms], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
            })?;
            for row in rows {
                let (k, v) = row?;
                by_risk.insert(k, v);
            }
        }

        let mut by_layer: BTreeMap<String, usize> = BTreeMap::new();
        {
            let mut stmt = self.connection.prepare(
                "SELECT layer, COUNT(*) FROM audit_records WHERE recorded_at_unix_ms >= ?1 GROUP BY layer",
            )?;
            let rows = stmt.query_map(params![since_unix_ms], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
            })?;
            for row in rows {
                let (k, v) = row?;
                by_layer.insert(k, v);
            }
        }

        let top_agents: Vec<(String, usize)> = {
            let mut stmt = self.connection.prepare(
                "SELECT agent_name, COUNT(*) as cnt FROM audit_records WHERE recorded_at_unix_ms >= ?1 GROUP BY agent_name ORDER BY cnt DESC LIMIT 5",
            )?;
            let rows = stmt.query_map(params![since_unix_ms], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
            })?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };

        Ok(AuditStats {
            since_unix_ms,
            total,
            by_action,
            by_risk,
            by_layer,
            top_agents,
        })
    }

    fn initialize(&self) -> Result<()> {
        self.connection.execute_batch(SCHEMA)?;
        self.migrate_policy_rules_table()?;
        Ok(())
    }

    fn migrate_policy_rules_table(&self) -> Result<()> {
        let columns = self.policy_rule_columns()?;

        if !columns.contains("updated_at_unix_ms") {
            self.connection.execute(
                "ALTER TABLE policy_rules ADD COLUMN updated_at_unix_ms INTEGER",
                [],
            )?;
        }

        if !columns.contains("enabled") {
            self.connection.execute(
                "ALTER TABLE policy_rules ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1",
                [],
            )?;
        }

        self.connection.execute(
            r#"
            UPDATE policy_rules
            SET updated_at_unix_ms = COALESCE(updated_at_unix_ms, created_at_unix_ms),
                enabled = COALESCE(enabled, 1)
            "#,
            [],
        )?;

        Ok(())
    }

    fn policy_rule_columns(&self) -> Result<BTreeSet<String>> {
        let mut statement = self.connection.prepare("PRAGMA table_info(policy_rules)")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
        rows.collect::<std::result::Result<BTreeSet<_>, _>>()
            .map_err(StoreError::from)
    }
}

#[derive(Debug, Serialize, serde::Deserialize)]
pub struct AuditStats {
    pub since_unix_ms: i64,
    pub total: usize,
    pub by_action: BTreeMap<String, usize>,
    pub by_risk: BTreeMap<String, usize>,
    pub by_layer: BTreeMap<String, usize>,
    pub top_agents: Vec<(String, usize)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditReview {
    pub audit_record_id: i64,
    pub status: String,
    pub label: Option<String>,
    pub note: Option<String>,
    pub reviewed_by: Option<String>,
    pub updated_at_unix_ms: i64,
}

fn validate_audit_review_status(status: &str) -> Result<()> {
    match status {
        "unreviewed" | "false_positive" | "resolved" | "needs_attention" => Ok(()),
        _ => Err(StoreError::InvalidInput(format!(
            "unsupported audit review status: {status}"
        ))),
    }
}

fn managed_rule_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ManagedRule> {
    let rule_json: String = row.get(4)?;
    let rule = serde_json::from_str::<Rule>(&rule_json).map_err(json_decode_error)?;

    Ok(ManagedRule {
        id: row.get(0)?,
        created_at_unix_ms: row.get(1)?,
        updated_at_unix_ms: row.get(2)?,
        enabled: row.get::<_, i64>(3)? != 0,
        rule,
    })
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
        AgentIdentity, ApprovalStatus, EnforcementAction, Layer, MatchPattern, Operation,
        ResourceTarget, RiskLevel,
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
        assert_eq!(
            resolved.audit_record.decision.action,
            EnforcementAction::Allow
        );
        assert_eq!(resolved.decided_by.as_deref(), Some("desktop-operator"));
        assert_eq!(resolved.resolution_note.as_deref(), Some("Looks safe."));
        assert_eq!(
            resolved.resolved_decision.as_ref().map(|d| d.action),
            Some(EnforcementAction::Allow)
        );
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

    #[test]
    fn saves_and_lists_policy_rules() {
        let store = AuditStore::open_in_memory().expect("in-memory store should initialize");
        let rule = Rule::new(
            "remembered-auto-gpt-upload",
            EnforcementAction::Allow,
            "Remember operator approval for uploads to the review service.",
        )
        .with_priority(875)
        .for_layer(Layer::Tool)
        .for_operation(Operation::HttpRequest)
        .for_agent(MatchPattern::Exact("AutoGPT".into()))
        .for_target(MatchPattern::Exact("api.review.example".into()))
        .requiring_risk_at_least(RiskLevel::High);

        let managed_rule = store.save_rule(&rule).expect("rule should persist");

        let rules = store.list_rules().expect("rules should load");

        assert_eq!(rules.len(), 1);
        assert_eq!(managed_rule.rule, rule);
        assert!(managed_rule.enabled);
        assert_eq!(rules[0], managed_rule);
    }

    #[test]
    fn disables_and_deletes_policy_rules() {
        let store = AuditStore::open_in_memory().expect("in-memory store should initialize");
        let rule = Rule::new(
            "remembered-cli-command",
            EnforcementAction::Allow,
            "Remember operator approval for the local demo command.",
        )
        .with_priority(875)
        .for_layer(Layer::Command)
        .for_operation(Operation::ExecCommand)
        .for_agent(MatchPattern::Exact(
            "agentguard-python-live-demo-agent".into(),
        ))
        .for_target(MatchPattern::Exact("printf 'agentguard-live-demo'".into()));

        let managed_rule = store.save_rule(&rule).expect("rule should persist");
        let disabled = store
            .set_rule_enabled(&managed_rule.id, false)
            .expect("rule should disable")
            .expect("disabled rule should load");
        assert!(!disabled.enabled);
        assert!(
            store
                .enabled_rules()
                .expect("enabled rules should load")
                .is_empty()
        );

        let deleted = store
            .delete_rule(&managed_rule.id)
            .expect("rule should delete");
        assert!(deleted);
        assert!(
            store
                .get_rule(&managed_rule.id)
                .expect("rule lookup should succeed")
                .is_none()
        );
    }
}
