use std::{
    error::Error,
    fmt,
    net::SocketAddr,
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};

use agentguard_models::{
    ApprovalRequest, ApprovalStatus, AuditRecord, Decision, EnforcementAction,
    EvaluateEventRequest, EvaluationOutcome, EvaluationStatus, Event, ManagedRule,
    ResolveApprovalRequest, Rule,
};
use agentguard_policy::{PolicyEngine, default_rules};
use agentguard_store::{AuditRecordQuery, AuditStats, AuditStore, StoreError};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
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
    InvalidRequest(String),
    Store(StoreError),
}

impl fmt::Display for DaemonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequest(message) => write!(f, "{message}"),
            Self::Store(error) => write!(f, "{error}"),
        }
    }
}

impl Error for DaemonError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Store(error) => Some(error),
            Self::InvalidRequest(_) => None,
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
    default_rules: Vec<Rule>,
    store: AuditStore,
}

impl AgentGuardDaemon {
    pub fn new(default_rules: Vec<Rule>, store: AuditStore) -> Self {
        Self {
            default_rules,
            store,
        }
    }

    pub fn with_mvp_defaults(store: AuditStore) -> Self {
        Self::new(default_rules(), store)
    }

    pub fn rule_count(&self) -> usize {
        self.default_rules.len()
    }

    pub fn process_event(&self, event: Event) -> Result<AuditRecord> {
        let (record, _) = self.record_evaluation(event)?;
        Ok(record)
    }

    pub fn evaluate_event(&self, request: EvaluateEventRequest) -> Result<EvaluationOutcome> {
        let (record, approval_request) = self.record_evaluation(request.event)?;
        Ok(match approval_request {
            Some(approval_request) => EvaluationOutcome::pending(record, approval_request),
            None => EvaluationOutcome::completed(record),
        })
    }

    pub fn recent_audit_records(&self, limit: usize) -> Result<Vec<AuditRecord>> {
        self.store.recent_audit_records(limit).map_err(Into::into)
    }

    pub fn query_audit_records(&self, query: &AuditRecordQuery) -> Result<Vec<AuditRecord>> {
        self.store.query_audit_records(query).map_err(Into::into)
    }

    pub fn audit_stats(&self, since_unix_ms: i64) -> Result<AuditStats> {
        self.store.audit_stats(since_unix_ms).map_err(Into::into)
    }

    pub fn list_approval_requests(
        &self,
        limit: usize,
        pending_only: bool,
    ) -> Result<Vec<ApprovalRequest>> {
        self.store
            .list_approval_requests(limit, pending_only)
            .map_err(Into::into)
    }

    pub fn get_approval_request(&self, approval_id: i64) -> Result<Option<ApprovalRequest>> {
        self.store
            .get_approval_request(approval_id)
            .map_err(Into::into)
    }

    pub fn list_rules(&self) -> Result<Vec<ManagedRule>> {
        self.store.list_rules().map_err(Into::into)
    }

    pub fn save_rule(&self, rule: Rule) -> Result<ManagedRule> {
        self.store.save_rule(&rule).map_err(Into::into)
    }

    pub fn set_rule_enabled(&self, rule_id: &str, enabled: bool) -> Result<Option<ManagedRule>> {
        self.store
            .set_rule_enabled(rule_id, enabled)
            .map_err(Into::into)
    }

    pub fn delete_rule(&self, rule_id: &str) -> Result<bool> {
        self.store.delete_rule(rule_id).map_err(Into::into)
    }

    pub fn resolve_approval_request(
        &self,
        approval_id: i64,
        resolution: ResolveApprovalRequest,
    ) -> Result<Option<ApprovalRequest>> {
        if resolution.action == EnforcementAction::Ask {
            return Err(DaemonError::InvalidRequest(
                "approval resolution action cannot be ask".into(),
            ));
        }

        let current = match self.store.get_approval_request(approval_id)? {
            Some(current) => current,
            None => return Ok(None),
        };

        if current.status != ApprovalStatus::Pending {
            return Ok(Some(current));
        }

        let resolution_note = resolution.reason.clone().unwrap_or_else(|| {
            default_resolution_reason(resolution.action, &resolution.decided_by)
        });
        let final_decision = Decision {
            action: resolution.action,
            risk: current.audit_record.decision.risk,
            reason: resolution_note.clone(),
            matched_rule_id: current.requested_decision.matched_rule_id.clone(),
        };

        self.store
            .resolve_approval_request(
                approval_id,
                &final_decision,
                &resolution.decided_by,
                Some(resolution_note.as_str()),
            )
            .map_err(Into::into)
    }

    fn record_evaluation(&self, event: Event) -> Result<(AuditRecord, Option<ApprovalRequest>)> {
        let decision = self.active_policy()?.decide(&event);
        let record = self.store.record_event(&event, &decision)?;
        let approval_request = if decision.action == EnforcementAction::Ask {
            Some(self.store.create_approval_request(&record)?)
        } else {
            None
        };

        Ok((record, approval_request))
    }

    fn active_policy(&self) -> Result<PolicyEngine> {
        let custom_rules = self.store.enabled_rules()?;
        Ok(PolicyEngine::new(
            custom_rules
                .into_iter()
                .chain(self.default_rules.iter().cloned())
                .collect(),
        ))
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
    InvalidRequest(String),
    NotFound(String),
    StatePoisoned,
    Store(StoreError),
}

impl fmt::Display for DaemonApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config(message) => write!(f, "{message}"),
            Self::Daemon(error) => write!(f, "{error}"),
            Self::InvalidRequest(message) => write!(f, "{message}"),
            Self::NotFound(message) => write!(f, "{message}"),
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
            Self::Config(message) | Self::InvalidRequest(message) => (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": {
                        "message": message,
                        "type": "invalid_request_error",
                    }
                })),
            )
                .into_response(),
            Self::NotFound(message) => (
                StatusCode::NOT_FOUND,
                Json(json!({
                    "error": {
                        "message": message,
                        "type": "not_found_error",
                    }
                })),
            )
                .into_response(),
            Self::Daemon(DaemonError::InvalidRequest(message)) => (
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
    layer: Option<String>,
    agent_name: Option<String>,
    operation: Option<String>,
    action: Option<String>,
    risk_level: Option<String>,
    start_time: Option<i64>,
    end_time: Option<i64>,
    limit: Option<usize>,
    offset: Option<usize>,
}

#[derive(Debug, Default, Deserialize)]
struct ApprovalListQuery {
    limit: Option<usize>,
    status: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct RuleListQuery {
    limit: Option<usize>,
}

#[derive(Debug, Default, Deserialize)]
struct AuditStatsQuery {
    since: Option<i64>,
}

pub fn app(daemon: AgentGuardDaemon) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/events", post(create_event))
        .route("/v1/evaluate", post(evaluate_event))
        .route("/v1/audit", get(list_audit_records))
        .route("/v1/audit/stats", get(get_audit_stats))
        .route("/v1/approvals", get(list_approval_requests))
        .route("/v1/rules", get(list_rules).post(create_rule))
        .route("/v1/rules/conflicts", get(list_rule_conflicts))
        .route("/v1/rules/{rule_id}/enable", post(enable_rule))
        .route("/v1/rules/{rule_id}/disable", post(disable_rule))
        .route("/v1/rules/{rule_id}", axum::routing::delete(delete_rule))
        .route(
            "/v1/approvals/{approval_id}/resolve",
            post(resolve_approval_request),
        )
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

async fn evaluate_event(
    State(state): State<ApiState>,
    Json(request): Json<EvaluateEventRequest>,
) -> std::result::Result<Json<EvaluationOutcome>, DaemonApiError> {
    let wait_for_approval_ms = request.wait_for_approval_ms.unwrap_or(0).min(60_000);
    let outcome = state
        .daemon
        .lock()
        .map_err(lock_error)?
        .evaluate_event(request)?;

    if outcome.status == EvaluationStatus::Completed || wait_for_approval_ms == 0 {
        return Ok(Json(outcome));
    }

    let approval_id = outcome
        .approval_request
        .as_ref()
        .map(|approval_request| approval_request.id)
        .ok_or_else(|| {
            DaemonApiError::Config("approval outcome did not include an approval request".into())
        })?;

    let resolved = wait_for_approval_resolution(&state, approval_id, wait_for_approval_ms).await?;
    Ok(Json(resolved))
}

async fn list_audit_records(
    State(state): State<ApiState>,
    Query(query): Query<RecentAuditQuery>,
) -> std::result::Result<Json<Vec<AuditRecord>>, DaemonApiError> {
    let limit = query.limit.unwrap_or(25).min(500);
    let offset = query.offset.unwrap_or(0);
    let store_query = AuditRecordQuery {
        layer: query.layer,
        agent_name: query.agent_name,
        operation: query.operation,
        action: query.action,
        risk_level: query.risk_level,
        start_time: query.start_time,
        end_time: query.end_time,
        limit,
        offset,
    };
    let records = state
        .daemon
        .lock()
        .map_err(lock_error)?
        .query_audit_records(&store_query)?;
    Ok(Json(records))
}

async fn list_approval_requests(
    State(state): State<ApiState>,
    Query(query): Query<ApprovalListQuery>,
) -> std::result::Result<Json<Vec<ApprovalRequest>>, DaemonApiError> {
    let limit = query.limit.unwrap_or(25).min(500);
    let pending_only = match query.status.as_deref() {
        Some("pending") => true,
        Some("all") | None => false,
        Some(value) => {
            return Err(DaemonApiError::InvalidRequest(format!(
                "unsupported approval status filter: {value}"
            )));
        }
    };

    let approvals = state
        .daemon
        .lock()
        .map_err(lock_error)?
        .list_approval_requests(limit, pending_only)?;
    Ok(Json(approvals))
}

async fn list_rules(
    State(state): State<ApiState>,
    Query(query): Query<RuleListQuery>,
) -> std::result::Result<Json<Vec<ManagedRule>>, DaemonApiError> {
    let limit = query.limit.unwrap_or(250).min(500);
    let rules = state.daemon.lock().map_err(lock_error)?.list_rules()?;
    Ok(Json(rules.into_iter().take(limit).collect()))
}

async fn get_audit_stats(
    State(state): State<ApiState>,
    Query(query): Query<AuditStatsQuery>,
) -> std::result::Result<Json<AuditStats>, DaemonApiError> {
    // Default: last 24 hours
    let since = query.since.unwrap_or_else(|| {
        let now =
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
        now - 86_400_000
    });
    let stats = state.daemon.lock().map_err(lock_error)?.audit_stats(since)?;
    Ok(Json(stats))
}

async fn list_rule_conflicts(
    State(state): State<ApiState>,
) -> std::result::Result<Json<Vec<agentguard_policy::RuleConflict>>, DaemonApiError> {
    let managed_rules = state.daemon.lock().map_err(lock_error)?.list_rules()?;
    let rules: Vec<_> = managed_rules
        .into_iter()
        .filter(|mr| mr.enabled)
        .map(|mr| mr.rule)
        .collect();
    let conflicts = agentguard_policy::detect_conflicts(&rules);
    Ok(Json(conflicts))
}

async fn create_rule(
    State(state): State<ApiState>,
    Json(rule): Json<Rule>,
) -> std::result::Result<Json<ManagedRule>, DaemonApiError> {
    let rule = state.daemon.lock().map_err(lock_error)?.save_rule(rule)?;
    Ok(Json(rule))
}

async fn enable_rule(
    State(state): State<ApiState>,
    Path(rule_id): Path<String>,
) -> std::result::Result<Json<ManagedRule>, DaemonApiError> {
    let rule = state
        .daemon
        .lock()
        .map_err(lock_error)?
        .set_rule_enabled(&rule_id, true)?
        .ok_or_else(|| {
            DaemonApiError::NotFound(format!("policy rule `{rule_id}` was not found"))
        })?;
    Ok(Json(rule))
}

async fn disable_rule(
    State(state): State<ApiState>,
    Path(rule_id): Path<String>,
) -> std::result::Result<Json<ManagedRule>, DaemonApiError> {
    let rule = state
        .daemon
        .lock()
        .map_err(lock_error)?
        .set_rule_enabled(&rule_id, false)?
        .ok_or_else(|| {
            DaemonApiError::NotFound(format!("policy rule `{rule_id}` was not found"))
        })?;
    Ok(Json(rule))
}

async fn delete_rule(
    State(state): State<ApiState>,
    Path(rule_id): Path<String>,
) -> std::result::Result<StatusCode, DaemonApiError> {
    let deleted = state
        .daemon
        .lock()
        .map_err(lock_error)?
        .delete_rule(&rule_id)?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(DaemonApiError::NotFound(format!(
            "policy rule `{rule_id}` was not found"
        )))
    }
}

async fn resolve_approval_request(
    State(state): State<ApiState>,
    Path(approval_id): Path<i64>,
    Json(resolution): Json<ResolveApprovalRequest>,
) -> std::result::Result<Json<ApprovalRequest>, DaemonApiError> {
    let approval = state
        .daemon
        .lock()
        .map_err(lock_error)?
        .resolve_approval_request(approval_id, resolution)?
        .ok_or_else(|| {
            DaemonApiError::NotFound(format!("approval request {approval_id} was not found"))
        })?;

    Ok(Json(approval))
}

async fn wait_for_approval_resolution(
    state: &ApiState,
    approval_id: i64,
    wait_for_approval_ms: u64,
) -> std::result::Result<EvaluationOutcome, DaemonApiError> {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(wait_for_approval_ms);
    let poll_interval = Duration::from_millis(200);

    loop {
        let approval = state
            .daemon
            .lock()
            .map_err(lock_error)?
            .get_approval_request(approval_id)?
            .ok_or_else(|| {
                DaemonApiError::NotFound(format!("approval request {approval_id} was not found"))
            })?;

        if approval.status != ApprovalStatus::Pending {
            return Ok(EvaluationOutcome::completed(approval.audit_record.clone()));
        }

        let now = tokio::time::Instant::now();
        if now >= deadline {
            return Ok(EvaluationOutcome::pending(
                approval.audit_record.clone(),
                approval,
            ));
        }

        let remaining = deadline.saturating_duration_since(now);
        let sleep_for = if remaining > poll_interval {
            poll_interval
        } else {
            remaining
        };
        tokio::time::sleep(sleep_for).await;
    }
}

fn default_resolution_reason(action: EnforcementAction, decided_by: &str) -> String {
    match action {
        EnforcementAction::Allow => format!("Approved by {decided_by}."),
        EnforcementAction::Warn => format!("Approved with warning by {decided_by}."),
        EnforcementAction::Block => format!("Denied by {decided_by}."),
        EnforcementAction::Kill => format!("Rejected and kill requested by {decided_by}."),
        EnforcementAction::Ask => "Pending additional review.".into(),
    }
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

    use agentguard_models::{
        AgentIdentity, EnforcementAction, EvaluateEventRequest, EvaluationStatus, Layer,
        ManagedRule, MatchPattern, Operation, ResourceTarget, Rule,
    };
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

    #[test]
    fn evaluating_high_risk_upload_creates_pending_approval() {
        let daemon = AgentGuardDaemon::with_mvp_defaults(
            AuditStore::open_in_memory().expect("store should initialize"),
        );

        let outcome = daemon
            .evaluate_event(EvaluateEventRequest {
                event: upload_event(),
                wait_for_approval_ms: None,
            })
            .expect("evaluation should succeed");

        assert_eq!(outcome.status, EvaluationStatus::PendingApproval);
        assert_eq!(outcome.audit_record.decision.action, EnforcementAction::Ask);
        assert_eq!(
            daemon
                .list_approval_requests(10, true)
                .expect("pending approvals should load")
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn api_waits_for_approval_resolution() {
        let daemon = AgentGuardDaemon::with_mvp_defaults(
            AuditStore::open_in_memory().expect("store should initialize"),
        );
        let app = app(daemon);

        let evaluation_request = Request::builder()
            .method("POST")
            .uri("/v1/evaluate")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&EvaluateEventRequest {
                    event: upload_event(),
                    wait_for_approval_ms: Some(2_000),
                })
                .expect("evaluation request should serialize"),
            ))
            .expect("request should build");

        let evaluation_task = {
            let app = app.clone();
            tokio::spawn(async move {
                app.oneshot(evaluation_request)
                    .await
                    .expect("request should succeed")
            })
        };

        tokio::time::sleep(Duration::from_millis(150)).await;

        let pending_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/approvals?status=pending&limit=10")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("pending approvals request should succeed");
        assert_eq!(pending_response.status(), StatusCode::OK);

        let pending_body = to_bytes(pending_response.into_body(), usize::MAX)
            .await
            .expect("response body should read");
        let approvals: Vec<ApprovalRequest> =
            serde_json::from_slice(&pending_body).expect("approvals should decode");
        assert_eq!(approvals.len(), 1);

        let resolve_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/v1/approvals/{}/resolve", approvals[0].id))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&ResolveApprovalRequest {
                            action: EnforcementAction::Allow,
                            decided_by: "desktop-operator".into(),
                            reason: Some("Approved by test.".into()),
                        })
                        .expect("resolution should serialize"),
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("resolve request should succeed");
        assert_eq!(resolve_response.status(), StatusCode::OK);

        let evaluation_response = evaluation_task.await.expect("join should succeed");
        assert_eq!(evaluation_response.status(), StatusCode::OK);

        let body = to_bytes(evaluation_response.into_body(), usize::MAX)
            .await
            .expect("response body should read");
        let outcome: EvaluationOutcome =
            serde_json::from_slice(&body).expect("evaluation outcome should decode");
        assert_eq!(outcome.status, EvaluationStatus::Completed);
        assert_eq!(
            outcome.audit_record.decision.action,
            EnforcementAction::Allow
        );
        assert_eq!(outcome.audit_record.decision.reason, "Approved by test.");
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

        let create_response = app
            .clone()
            .oneshot(request)
            .await
            .expect("request should succeed");
        assert_eq!(create_response.status(), StatusCode::OK);

        let body = to_bytes(create_response.into_body(), usize::MAX)
            .await
            .expect("response body should read");
        let record: AuditRecord = serde_json::from_slice(&body).expect("record should decode");
        assert_eq!(record.decision.action, EnforcementAction::Block);

        let recent_response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/audit?limit=5")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(recent_response.status(), StatusCode::OK);

        let recent_body = to_bytes(recent_response.into_body(), usize::MAX)
            .await
            .expect("response body should read");
        let records: Vec<AuditRecord> =
            serde_json::from_slice(&recent_body).expect("records should decode");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0], record);
    }

    #[tokio::test]
    async fn api_saves_custom_rules_and_uses_them_for_future_events() {
        let daemon = AgentGuardDaemon::with_mvp_defaults(
            AuditStore::open_in_memory().expect("store should initialize"),
        );
        let app = app(daemon);
        let rule = Rule::new(
            "remembered-review-upload",
            EnforcementAction::Allow,
            "Remembered operator approval for this upload target.",
        )
        .with_priority(875)
        .for_layer(Layer::Tool)
        .for_operation(Operation::HttpRequest)
        .for_agent(MatchPattern::Exact("Desktop Scenario Runner".into()))
        .for_target(MatchPattern::Exact("api.unknown-upload.example".into()));

        let create_rule_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/rules")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&rule).expect("rule should serialize"),
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("rule request should succeed");
        assert_eq!(create_rule_response.status(), StatusCode::OK);

        let evaluation_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/evaluate")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&EvaluateEventRequest {
                            event: upload_event(),
                            wait_for_approval_ms: Some(0),
                        })
                        .expect("evaluation request should serialize"),
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(evaluation_response.status(), StatusCode::OK);

        let evaluation_body = to_bytes(evaluation_response.into_body(), usize::MAX)
            .await
            .expect("response body should read");
        let outcome: EvaluationOutcome =
            serde_json::from_slice(&evaluation_body).expect("evaluation outcome should decode");
        assert_eq!(outcome.status, EvaluationStatus::Completed);
        assert_eq!(
            outcome.audit_record.decision.action,
            EnforcementAction::Allow
        );
        assert_eq!(
            outcome.audit_record.decision.matched_rule_id.as_deref(),
            Some("remembered-review-upload")
        );

        let rules_response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/v1/rules?limit=10")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(rules_response.status(), StatusCode::OK);

        let rules_body = to_bytes(rules_response.into_body(), usize::MAX)
            .await
            .expect("response body should read");
        let rules: Vec<ManagedRule> =
            serde_json::from_slice(&rules_body).expect("rules should decode");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].rule, rule);
        assert!(rules[0].enabled);
    }

    #[tokio::test]
    async fn api_disables_and_deletes_custom_rules() {
        let daemon = AgentGuardDaemon::with_mvp_defaults(
            AuditStore::open_in_memory().expect("store should initialize"),
        );
        let app = app(daemon);
        let rule = Rule::new(
            "remembered-cli-command",
            EnforcementAction::Allow,
            "Remembered operator approval for the local CLI demo.",
        )
        .with_priority(875)
        .for_layer(Layer::Command)
        .for_operation(Operation::ExecCommand)
        .for_agent(MatchPattern::Exact("demo-agent".into()))
        .for_target(MatchPattern::Exact("printf 'agentguard-live-demo'".into()));

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/rules")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&rule).expect("rule should serialize"),
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(create_response.status(), StatusCode::OK);

        let disable_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/rules/remembered-cli-command/disable")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(disable_response.status(), StatusCode::OK);

        let disable_body = to_bytes(disable_response.into_body(), usize::MAX)
            .await
            .expect("response body should read");
        let disabled_rule: ManagedRule =
            serde_json::from_slice(&disable_body).expect("rule should decode");
        assert!(!disabled_rule.enabled);

        let delete_response = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri("/v1/rules/remembered-cli-command")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("request should succeed");
        assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);
    }

    fn upload_event() -> Event {
        Event::new(
            AgentIdentity::named("Desktop Scenario Runner"),
            Layer::Tool,
            Operation::HttpRequest,
            ResourceTarget::Domain("api.unknown-upload.example".into()),
        )
        .with_metadata("network_direction", "upload")
    }
}
