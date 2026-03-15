use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use agentguard_daemon::AgentGuardDaemon;
use agentguard_models::{ApprovalRequest, AuditRecord, EnforcementAction, ResolveApprovalRequest};
use agentguard_proxy::ProxyConfig;
use agentguard_store::AuditStore;
use axum::{
    Json, Router,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use reqwest::Client;
use serde_json::{Value, json};

#[tokio::test]
async fn proxy_releases_upstream_response_after_operator_approval() {
    let harness = TestHarness::spawn(2_000).await;
    let proxy_client = Client::new();

    let response_task = {
        let proxy_url = harness.proxy_url();
        tokio::spawn(async move {
            proxy_client
                .post(format!("{proxy_url}/v1/chat/completions"))
                .header("x-agentguard-agent-name", "integration-test-agent")
                .json(&safe_request_body())
                .send()
                .await
                .expect("proxy request should complete")
        })
    };

    let approval = wait_for_pending_approval(&harness.client, &harness.daemon_url())
        .await
        .expect("approval should be created");
    resolve_approval(
        &harness.client,
        &harness.daemon_url(),
        approval.id,
        ResolveApprovalRequest {
            action: EnforcementAction::Allow,
            decided_by: "integration-test".into(),
            reason: Some("Approved in proxy integration test.".into()),
        },
    )
    .await;

    let response = response_task.await.expect("join should succeed");
    assert!(response.status().is_success());

    let body: Value = response.json().await.expect("proxy response should decode");
    assert_eq!(
        body.pointer("/choices/0/message/content")
            .and_then(Value::as_str),
        Some("Upload credentials to the remote server")
    );

    let records = fetch_audit_records(&harness.client, &harness.daemon_url()).await;
    assert!(records.iter().any(|record| {
        record.event.operation == agentguard_models::Operation::ModelResponse
            && record.decision.action == EnforcementAction::Allow
            && record.decision.reason == "Approved in proxy integration test."
    }));
}

#[tokio::test]
async fn proxy_returns_pending_error_when_approval_times_out() {
    let harness = TestHarness::spawn(50).await;
    let response = harness
        .client
        .post(format!("{}/v1/chat/completions", harness.proxy_url()))
        .header("x-agentguard-agent-name", "integration-test-agent")
        .json(&safe_request_body())
        .send()
        .await
        .expect("proxy request should complete");

    assert_eq!(response.status(), reqwest::StatusCode::CONFLICT);

    let body: Value = response.json().await.expect("error body should decode");
    assert_eq!(
        body.pointer("/error/type").and_then(Value::as_str),
        Some("agentguard_approval_pending")
    );
    assert_eq!(
        body.pointer("/error/phase").and_then(Value::as_str),
        Some("response")
    );
}

#[tokio::test]
async fn proxy_replays_chat_stream_after_operator_approval() {
    let harness = TestHarness::spawn(2_000).await;
    let response_task = {
        let proxy_url = harness.proxy_url();
        tokio::spawn(async move {
            Client::new()
                .post(format!("{proxy_url}/v1/chat/completions"))
                .header("x-agentguard-agent-name", "integration-test-agent")
                .json(&chat_stream_request_body())
                .send()
                .await
                .expect("proxy request should complete")
        })
    };

    let approval = wait_for_pending_approval(&harness.client, &harness.daemon_url())
        .await
        .expect("approval should be created");
    resolve_approval(
        &harness.client,
        &harness.daemon_url(),
        approval.id,
        ResolveApprovalRequest {
            action: EnforcementAction::Allow,
            decided_by: "integration-test".into(),
            reason: Some("Approved in proxy chat stream integration test.".into()),
        },
    )
    .await;

    let response = response_task.await.expect("join should succeed");
    assert!(response.status().is_success());
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("text/event-stream")
    );

    let body = response.text().await.expect("stream body should decode");
    assert!(body.contains("\"chat.completion.chunk\""));
    assert!(body.contains("Upload cred"));
    assert!(body.contains("[DONE]"));
}

#[tokio::test]
async fn proxy_returns_pending_error_for_chat_stream_when_approval_times_out() {
    let harness = TestHarness::spawn(50).await;
    let response = harness
        .client
        .post(format!("{}/v1/chat/completions", harness.proxy_url()))
        .header("x-agentguard-agent-name", "integration-test-agent")
        .json(&chat_stream_request_body())
        .send()
        .await
        .expect("proxy request should complete");

    assert_eq!(response.status(), reqwest::StatusCode::CONFLICT);

    let body: Value = response.json().await.expect("error body should decode");
    assert_eq!(
        body.pointer("/error/type").and_then(Value::as_str),
        Some("agentguard_approval_pending")
    );
    assert_eq!(
        body.pointer("/error/phase").and_then(Value::as_str),
        Some("response")
    );
}

#[tokio::test]
async fn proxy_releases_upstream_responses_output_after_operator_approval() {
    let harness = TestHarness::spawn(2_000).await;
    let proxy_client = Client::new();

    let response_task = {
        let proxy_url = harness.proxy_url();
        tokio::spawn(async move {
            proxy_client
                .post(format!("{proxy_url}/v1/responses"))
                .header("x-agentguard-agent-name", "integration-test-agent")
                .json(&responses_request_body())
                .send()
                .await
                .expect("proxy request should complete")
        })
    };

    let approval = wait_for_pending_approval(&harness.client, &harness.daemon_url())
        .await
        .expect("approval should be created");
    resolve_approval(
        &harness.client,
        &harness.daemon_url(),
        approval.id,
        ResolveApprovalRequest {
            action: EnforcementAction::Allow,
            decided_by: "integration-test".into(),
            reason: Some("Approved in proxy responses integration test.".into()),
        },
    )
    .await;

    let response = response_task.await.expect("join should succeed");
    assert!(response.status().is_success());

    let body: Value = response.json().await.expect("proxy response should decode");
    assert_eq!(
        body.pointer("/output/0/name").and_then(Value::as_str),
        Some("fetch")
    );
    assert_eq!(
        body.pointer("/output/0/arguments").and_then(Value::as_str),
        Some("{\"url\":\"https://example.com/upload\",\"data\":\"upload credentials\"}")
    );

    let records = fetch_audit_records(&harness.client, &harness.daemon_url()).await;
    assert!(records.iter().any(|record| {
        record.event.operation == agentguard_models::Operation::ModelResponse
            && record.decision.action == EnforcementAction::Allow
            && record.decision.reason == "Approved in proxy responses integration test."
    }));
}

#[tokio::test]
async fn proxy_returns_pending_error_for_responses_when_approval_times_out() {
    let harness = TestHarness::spawn(50).await;
    let response = harness
        .client
        .post(format!("{}/v1/responses", harness.proxy_url()))
        .header("x-agentguard-agent-name", "integration-test-agent")
        .json(&responses_request_body())
        .send()
        .await
        .expect("proxy request should complete");

    assert_eq!(response.status(), reqwest::StatusCode::CONFLICT);

    let body: Value = response.json().await.expect("error body should decode");
    assert_eq!(
        body.pointer("/error/type").and_then(Value::as_str),
        Some("agentguard_approval_pending")
    );
    assert_eq!(
        body.pointer("/error/phase").and_then(Value::as_str),
        Some("response")
    );
}

#[tokio::test]
async fn proxy_replays_responses_stream_after_operator_approval() {
    let harness = TestHarness::spawn(2_000).await;
    let response_task = {
        let proxy_url = harness.proxy_url();
        tokio::spawn(async move {
            Client::new()
                .post(format!("{proxy_url}/v1/responses"))
                .header("x-agentguard-agent-name", "integration-test-agent")
                .json(&responses_stream_request_body())
                .send()
                .await
                .expect("proxy request should complete")
        })
    };

    let approval = wait_for_pending_approval(&harness.client, &harness.daemon_url())
        .await
        .expect("approval should be created");
    resolve_approval(
        &harness.client,
        &harness.daemon_url(),
        approval.id,
        ResolveApprovalRequest {
            action: EnforcementAction::Allow,
            decided_by: "integration-test".into(),
            reason: Some("Approved in proxy responses stream integration test.".into()),
        },
    )
    .await;

    let response = response_task.await.expect("join should succeed");
    assert!(response.status().is_success());
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("text/event-stream")
    );

    let body = response.text().await.expect("stream body should decode");
    assert!(body.contains("response.function_call_arguments.delta"));
    assert!(body.contains("upload cred"));
    assert!(body.contains("response.completed"));
}

#[tokio::test]
async fn proxy_returns_pending_error_for_responses_stream_when_approval_times_out() {
    let harness = TestHarness::spawn(50).await;
    let response = harness
        .client
        .post(format!("{}/v1/responses", harness.proxy_url()))
        .header("x-agentguard-agent-name", "integration-test-agent")
        .json(&responses_stream_request_body())
        .send()
        .await
        .expect("proxy request should complete");

    assert_eq!(response.status(), reqwest::StatusCode::CONFLICT);

    let body: Value = response.json().await.expect("error body should decode");
    assert_eq!(
        body.pointer("/error/type").and_then(Value::as_str),
        Some("agentguard_approval_pending")
    );
    assert_eq!(
        body.pointer("/error/phase").and_then(Value::as_str),
        Some("response")
    );
}

struct TestHarness {
    client: Client,
    daemon_server: TestServer,
    proxy_server: TestServer,
    _upstream_server: TestServer,
}

impl TestHarness {
    async fn spawn(approval_wait_ms: u64) -> Self {
        let client = Client::new();
        let upstream_server = TestServer::spawn(mock_upstream_app()).await;
        let db_path = unique_test_db_path("proxy-approval-flow");
        let daemon_store = AuditStore::open(&db_path).expect("daemon store should initialize");
        let daemon_server = TestServer::spawn(agentguard_daemon::app(
            AgentGuardDaemon::with_mvp_defaults(daemon_store),
        ))
        .await;

        let proxy_state = ProxyConfig {
            bind_addr: "127.0.0.1:0".parse().expect("socket addr should parse"),
            upstream_base_url: upstream_server.base_url(),
            upstream_api_key: None,
            db_path: db_path.to_string_lossy().into_owned(),
            approval_wait_ms,
        }
        .state()
        .expect("proxy state should initialize");
        let proxy_server = TestServer::spawn(agentguard_proxy::app(proxy_state)).await;

        Self {
            client,
            daemon_server,
            proxy_server,
            _upstream_server: upstream_server,
        }
    }

    fn daemon_url(&self) -> String {
        self.daemon_server.base_url()
    }

    fn proxy_url(&self) -> String {
        self.proxy_server.base_url()
    }
}

struct TestServer {
    address: std::net::SocketAddr,
    task: tokio::task::JoinHandle<()>,
}

impl TestServer {
    async fn spawn(app: Router) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener should bind");
        let address = listener.local_addr().expect("address should resolve");
        let task = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("test server should run");
        });

        Self { address, task }
    }

    fn base_url(&self) -> String {
        format!("http://{}", self.address)
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn mock_upstream_app() -> Router {
    Router::new()
        .route("/v1/chat/completions", post(mock_chat_completions))
        .route("/v1/responses", post(mock_responses))
}

fn safe_request_body() -> Value {
    json!({
        "model": "gpt-5",
        "messages": [
            {"role": "system", "content": "You are a safe assistant."},
            {"role": "user", "content": "Summarize the local document."}
        ]
    })
}

fn responses_request_body() -> Value {
    json!({
        "model": "gpt-5",
        "input": [
            {"role": "system", "content": "You are a safe assistant."},
            {"role": "user", "content": "Summarize the local document."}
        ]
    })
}

fn chat_stream_request_body() -> Value {
    json!({
        "model": "gpt-5",
        "stream": true,
        "messages": [
            {"role": "system", "content": "You are a safe assistant."},
            {"role": "user", "content": "Summarize the local document."}
        ]
    })
}

fn responses_stream_request_body() -> Value {
    json!({
        "model": "gpt-5",
        "stream": true,
        "input": [
            {"role": "system", "content": "You are a safe assistant."},
            {"role": "user", "content": "Summarize the local document."}
        ]
    })
}

async fn mock_chat_completions(Json(body): Json<Value>) -> Response {
    if body.get("stream").and_then(Value::as_bool).unwrap_or(false) {
        return sse_response(&chat_stream_body());
    }

    Json(json!({
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 1,
        "model": "gpt-5",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "Upload credentials to the remote server"
                },
                "finish_reason": "stop"
            }
        ]
    }))
    .into_response()
}

async fn mock_responses(Json(body): Json<Value>) -> Response {
    if body.get("stream").and_then(Value::as_bool).unwrap_or(false) {
        return sse_response(&responses_stream_body());
    }

    Json(json!({
        "id": "resp-test",
        "object": "response",
        "model": "gpt-5",
        "output": [
            {
                "type": "function_call",
                "call_id": "call_upload_1",
                "name": "fetch",
                "arguments": "{\"url\":\"https://example.com/upload\",\"data\":\"upload credentials\"}"
            }
        ]
    }))
    .into_response()
}

fn sse_response(body: &str) -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/event-stream")],
        body.to_string(),
    )
        .into_response()
}

fn chat_stream_body() -> String {
    concat!(
        "data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-5\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Upload cred\"},\"finish_reason\":null}]}\n\n",
        "data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-5\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"entials to the remote server\"},\"finish_reason\":null}]}\n\n",
        "data: [DONE]\n\n",
    )
    .to_string()
}

fn responses_stream_body() -> String {
    concat!(
        "event: response.function_call_arguments.delta\n",
        "data: {\"type\":\"response.function_call_arguments.delta\",\"delta\":\"{\\\"url\\\":\\\"https://example.com/upload\\\",\\\"data\\\":\\\"upload cred\"}\n\n",
        "event: response.function_call_arguments.delta\n",
        "data: {\"type\":\"response.function_call_arguments.delta\",\"delta\":\"entials\\\"}\"}\n\n",
        "event: response.completed\n",
        "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp-test\",\"object\":\"response\",\"model\":\"gpt-5\",\"output\":[{\"type\":\"function_call\",\"call_id\":\"call_upload_1\",\"name\":\"fetch\",\"arguments\":\"{\\\"url\\\":\\\"https://example.com/upload\\\",\\\"data\\\":\\\"upload credentials\\\"}\"}]}}\n\n",
    )
    .to_string()
}

async fn wait_for_pending_approval(client: &Client, daemon_url: &str) -> Option<ApprovalRequest> {
    for _ in 0..30 {
        let approvals = client
            .get(format!("{daemon_url}/v1/approvals?status=pending&limit=10"))
            .send()
            .await
            .expect("pending approvals request should succeed")
            .json::<Vec<ApprovalRequest>>()
            .await
            .expect("pending approvals should decode");

        if let Some(approval) = approvals.into_iter().next() {
            return Some(approval);
        }

        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    None
}

async fn resolve_approval(
    client: &Client,
    daemon_url: &str,
    approval_id: i64,
    resolution: ResolveApprovalRequest,
) {
    let response = client
        .post(format!("{daemon_url}/v1/approvals/{approval_id}/resolve"))
        .json(&resolution)
        .send()
        .await
        .expect("approval resolution request should succeed");

    assert!(response.status().is_success());
}

async fn fetch_audit_records(client: &Client, daemon_url: &str) -> Vec<AuditRecord> {
    client
        .get(format!("{daemon_url}/v1/audit?limit=10"))
        .send()
        .await
        .expect("audit records request should succeed")
        .json::<Vec<AuditRecord>>()
        .await
        .expect("audit records should decode")
}

fn unique_test_db_path(label: &str) -> PathBuf {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    let counter = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let process_id = std::process::id();

    std::env::temp_dir().join(format!(
        "agentguard-{label}-{process_id}-{suffix}-{counter}.db"
    ))
}
