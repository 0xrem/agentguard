use std::{
    error::Error,
    fmt,
    net::SocketAddr,
    sync::{Arc, Mutex, PoisonError},
};

use agentguard_models::{AuditRecord, Event};
use agentguard_policy::PolicyEngine;
use agentguard_store::{AuditStore, StoreError};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;

const DEFAULT_DAEMON_BIND_ADDR: &str = "127.0.0.1:8790";
const DEFAULT_DB_PATH: &str = "agentguard-dev.db";

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

#[derive(Debug, Clone)]
pub struct DaemonConfig {
    pub bind_addr: SocketAddr,
    pub db_path: String,
}

impl DaemonConfig {
    pub fn from_env() -> std::result::Result<Self, DaemonApiError> {
        let bind_addr = std::env::var("AGENTGUARD_DAEMON_BIND")
            .unwrap_or_else(|_| DEFAULT_DAEMON_BIND_ADDR.into())
            .parse()
            .map_err(|error| {
                DaemonApiError::Config(format!("invalid AGENTGUARD_DAEMON_BIND: {error}"))
            })?;
        let db_path =
            std::env::var("AGENTGUARD_DB_PATH").unwrap_or_else(|_| DEFAULT_DB_PATH.into());

        Ok(Self { bind_addr, db_path })
    }

    pub fn daemon(&self) -> std::result::Result<AgentGuardDaemon, DaemonApiError> {
        let store = AuditStore::open(&self.db_path).map_err(DaemonApiError::Store)?;
        Ok(AgentGuardDaemon::with_mvp_defaults(store))
    }
}

#[derive(Clone)]
struct ApiState {
    daemon: Arc<Mutex<AgentGuardDaemon>>,
}

impl ApiState {
    fn new(daemon: AgentGuardDaemon) -> Self {
        Self {
            daemon: Arc::new(Mutex::new(daemon)),
        }
    }
}

#[derive(Debug)]
pub enum DaemonApiError {
    Config(String),
    Daemon(DaemonError),
    StatePoisoned,
    Store(StoreError),
}

impl fmt::Display for DaemonApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config(message) => write!(f, "{message}"),
            Self::Daemon(error) => write!(f, "{error}"),
            Self::StatePoisoned => write!(f, "daemon state lock poisoned"),
            Self::Store(error) => write!(f, "{error}"),
        }
    }
}

impl Error for DaemonApiError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Daemon(error) => Some(error),
            Self::Store(error) => Some(error),
            _ => None,
        }
    }
}

impl From<DaemonError> for DaemonApiError {
    fn from(value: DaemonError) -> Self {
        Self::Daemon(value)
    }
}

impl IntoResponse for DaemonApiError {
    fn into_response(self) -> Response {
        match self {
            Self::Config(message) => (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": {
                        "message": message,
                        "type": "invalid_request_error",
                    }
                })),
            )
                .into_response(),
            Self::Daemon(error) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": {
                        "message": error.to_string(),
                        "type": "internal_error",
                    }
                })),
            )
                .into_response(),
            Self::Store(error) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": {
                        "message": error.to_string(),
                        "type": "internal_error",
                    }
                })),
            )
                .into_response(),
            Self::StatePoisoned => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": {
                        "message": "daemon state lock poisoned",
                        "type": "internal_error",
                    }
                })),
            )
                .into_response(),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
struct RecentAuditQuery {
    limit: Option<usize>,
}

pub fn app(daemon: AgentGuardDaemon) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/events", post(create_event))
        .route("/v1/audit", get(list_audit_records))
        .with_state(ApiState::new(daemon))
}

pub async fn run(config: DaemonConfig) -> std::result::Result<(), DaemonApiError> {
    let bind_addr = config.bind_addr;
    let daemon = config.daemon()?;
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .map_err(|error| DaemonApiError::Config(format!("failed to bind {bind_addr}: {error}")))?;

    println!("agentguard-daemon listening on http://{bind_addr}");
    println!("database: {}", config.db_path);

    axum::serve(listener, app(daemon))
        .await
        .map_err(|error| DaemonApiError::Config(format!("daemon server error: {error}")))?;

    Ok(())
}

async fn healthz() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}

async fn create_event(
    State(state): State<ApiState>,
    Json(event): Json<Event>,
) -> std::result::Result<Json<AuditRecord>, DaemonApiError> {
    let record = state
        .daemon
        .lock()
        .map_err(lock_error)?
        .process_event(event)?;
    Ok(Json(record))
}

async fn list_audit_records(
    State(state): State<ApiState>,
    Query(query): Query<RecentAuditQuery>,
) -> std::result::Result<Json<Vec<AuditRecord>>, DaemonApiError> {
    let limit = query.limit.unwrap_or(25).min(500);
    let records = state
        .daemon
        .lock()
        .map_err(lock_error)?
        .recent_audit_records(limit)?;
    Ok(Json(records))
}

fn lock_error<T>(_error: PoisonError<T>) -> DaemonApiError {
    DaemonApiError::StatePoisoned
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

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

    #[tokio::test]
    async fn api_persists_events_and_returns_recent_audit() {
        let daemon = AgentGuardDaemon::with_mvp_defaults(
            AuditStore::open_in_memory().expect("store should initialize"),
        );
        let app = app(daemon);
        let event = Event::new(
            AgentIdentity::named("Claude Code"),
            Layer::Command,
            Operation::ExecCommand,
            ResourceTarget::Command("rm -rf ~".into()),
        );
        let request = Request::builder()
            .method("POST")
            .uri("/v1/events")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&event).expect("event should serialize"),
            ))
            .expect("request should build");

        let response = app
            .clone()
            .oneshot(request)
            .await
            .expect("event creation should succeed");

        assert_eq!(response.status(), StatusCode::OK);

        let audit_request = Request::builder()
            .method("GET")
            .uri("/v1/audit?limit=10")
            .body(Body::empty())
            .expect("audit request should build");
        let audit_response = app
            .oneshot(audit_request)
            .await
            .expect("audit listing should succeed");

        assert_eq!(audit_response.status(), StatusCode::OK);

        let body = to_bytes(audit_response.into_body(), 1024 * 1024)
            .await
            .expect("body should read");
        let records: Vec<AuditRecord> =
            serde_json::from_slice(&body).expect("records should deserialize");

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].decision.action, EnforcementAction::Block);
    }
}
