from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
import urllib.parse
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Optional

from agentguard_sdk import (
    AgentGuardClient,
    PendingApprovalError,
    PolicyDeniedError,
    ResolveApprovalInput,
    guarded_exec_command,
    guarded_fetch,
    guarded_read_file,
)


@dataclass
class MockDaemonState:
    decide: Callable[[dict[str, Any]], dict[str, Any]]
    records: list[dict[str, Any]] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    approvals: list[dict[str, Any]] = field(default_factory=list)


class AgentGuardPythonSdkTests(unittest.TestCase):
    def setUp(self) -> None:
        self.daemon = MockServer(make_mock_daemon_handler)
        self.daemon.start(MockDaemonState(decide=lambda _event: allow_decision()))
        self.client = AgentGuardClient(
            base_url=self.daemon.base_url,
            agent="Python Agent",
        )

    def tearDown(self) -> None:
        self.daemon.stop()

    def test_client_records_events_and_lists_audit_entries(self) -> None:
        record = self.client.record_event(
            self.client.build_event(
                build_guard_input(
                    layer="command",
                    operation="exec_command",
                    target={"kind": "command", "value": "rm -rf ~"},
                )
            )
        )
        recent = self.client.list_audit(5)

        self.assertEqual(record.event.agent.name, "Python Agent")
        self.assertEqual(len(recent), 1)
        self.assertEqual(recent[0].decision.action, "allow")

    def test_guarded_read_file_reads_when_daemon_allows(self) -> None:
        with tempfile.TemporaryDirectory(prefix="agentguard-python-sdk-") as temp_dir:
            file_path = Path(temp_dir, "example.txt")
            file_path.write_text("safe file", encoding="utf-8")

            result = guarded_read_file(self.client, file_path, encoding="utf-8")

        self.assertEqual(result.value, "safe file")
        self.assertEqual(self.daemon.state.events[0]["operation"], "read_file")
        self.assertEqual(self.daemon.state.events[0]["target"]["kind"], "path")

    def test_guarded_fetch_emits_http_request_event_before_forwarding(self) -> None:
        upstream = MockServer(make_text_handler)
        upstream.start("ok")
        try:
            result = guarded_fetch(
                self.client,
                f"{upstream.base_url}/status",
                method="POST",
                data=json.dumps({"hello": "world"}).encode("utf-8"),
            )
            body = result.value.read().decode("utf-8")
            result.value.close()
        finally:
            upstream.stop()

        self.assertEqual(result.audit_record.event.operation, "http_request")
        self.assertEqual(result.audit_record.event.target.kind, "domain")
        self.assertEqual(body, "ok")

    def test_guarded_fetch_surfaces_pending_approvals(self) -> None:
        self.daemon.stop()
        self.daemon.start(
            MockDaemonState(
                decide=lambda _event: {
                    "action": "ask",
                    "risk": "high",
                    "reason": "High-risk event requires user confirmation.",
                    "matched_rule_id": None,
                }
            )
        )
        client = AgentGuardClient(base_url=self.daemon.base_url, agent="Python Agent")
        upstream = MockServer(make_text_handler)
        upstream.start("ok")
        try:
            with self.assertRaises(PendingApprovalError) as context:
                guarded_fetch(
                    client,
                    f"{upstream.base_url}/upload",
                    method="POST",
                    data=b"payload",
                    wait_for_approval_ms=0,
                )
        finally:
            upstream.stop()

        self.assertEqual(context.exception.outcome.status, "pending_approval")
        self.assertIsNotNone(context.exception.outcome.approval_request)
        self.assertEqual(len(self.daemon.state.approvals), 1)

    def test_client_lists_and_resolves_pending_approvals(self) -> None:
        self.daemon.stop()
        self.daemon.start(
            MockDaemonState(
                decide=lambda _event: {
                    "action": "ask",
                    "risk": "high",
                    "reason": "High-risk event requires user confirmation.",
                    "matched_rule_id": None,
                }
            )
        )
        client = AgentGuardClient(base_url=self.daemon.base_url, agent="Python Agent")

        outcome = client.evaluate_event(
            build_guard_input(
                layer="tool",
                operation="http_request",
                target={"kind": "domain", "value": "api.attacker.example"},
                metadata={"network_direction": "upload"},
                wait_for_approval_ms=0,
            )
        )
        self.assertEqual(outcome.status, "pending_approval")

        pending = client.list_approvals(status="pending")
        self.assertEqual(len(pending), 1)

        resolved = client.resolve_approval_request(
            pending[0].id,
            ResolveApprovalInput(
                action="allow",
                decided_by="python-test",
                reason="Approved in Python SDK test.",
            ),
        )
        self.assertEqual(resolved.status, "approved")
        self.assertEqual(resolved.audit_record.decision.action, "allow")

    def test_guarded_exec_command_throws_before_execution_when_daemon_blocks(self) -> None:
        self.daemon.stop()
        self.daemon.start(
            MockDaemonState(
                decide=lambda _event: {
                    "action": "block",
                    "risk": "critical",
                    "reason": "command blocked",
                    "matched_rule_id": "blocked-in-test",
                }
            )
        )
        client = AgentGuardClient(base_url=self.daemon.base_url, agent="Python Agent")

        with self.assertRaises(PolicyDeniedError) as context:
            guarded_exec_command(client, "echo should-not-run")

        self.assertEqual(context.exception.record.decision.action, "block")


def build_guard_input(
    *,
    layer: str,
    operation: str,
    target: dict[str, Any],
    metadata: Optional[dict[str, str]] = None,
    wait_for_approval_ms: Optional[int] = None,
):
    from agentguard_sdk.types import GuardEventInput, ResourceTarget

    return GuardEventInput(
        layer=layer,
        operation=operation,
        target=ResourceTarget(kind=target["kind"], value=target.get("value")),
        metadata=metadata or {},
        wait_for_approval_ms=wait_for_approval_ms,
    )


def allow_decision() -> dict[str, Any]:
    return {
        "action": "allow",
        "risk": "low",
        "reason": "allowed in mock daemon",
        "matched_rule_id": None,
    }


def make_mock_daemon_handler(state: MockDaemonState):
    class MockDaemonHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            if self.path == "/v1/events":
                event = read_json_body(self)
                record = make_record(len(state.records) + 1, event, state.decide(event))
                state.events.append(event)
                state.records.insert(0, record)
                send_json(self, 200, record)
                return

            if self.path == "/v1/evaluate":
                payload = read_json_body(self)
                event = payload["event"]
                decision = state.decide(event)
                record = make_record(len(state.records) + 1, event, decision)
                state.events.append(event)
                state.records.insert(0, record)
                send_json(self, 200, make_evaluation_outcome(record, state.approvals))
                return

            if self.path.startswith("/v1/approvals/") and self.path.endswith("/resolve"):
                approval_id = int(self.path.split("/")[3])
                body = read_json_body(self)
                approval = resolve_approval(state.approvals, approval_id, body)
                if approval is None:
                    send_json(self, 404, {"error": {"message": "not found"}})
                    return

                record = approval["audit_record"]
                for index, existing in enumerate(state.records):
                    if existing["id"] == record["id"]:
                        state.records[index] = record
                        break
                send_json(self, 200, approval)
                return

            send_json(self, 404, {"error": {"message": "not found"}})

        def do_GET(self) -> None:  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/v1/audit":
                send_json(self, 200, state.records)
                return

            if parsed.path == "/v1/approvals":
                query = urllib.parse.parse_qs(parsed.query)
                status = query.get("status", ["all"])[0]
                approvals = state.approvals
                if status == "pending":
                    approvals = [item for item in approvals if item["status"] == "pending"]
                send_json(self, 200, approvals)
                return

            send_json(self, 404, {"error": {"message": "not found"}})

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
            return

    return MockDaemonHandler


def make_text_handler(text: str):
    class TextHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            encoded = text.encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "text/plain")
            self.send_header("content-length", str(len(encoded)))
            self.send_header("connection", "close")
            self.end_headers()
            self.wfile.write(encoded)

        def do_POST(self) -> None:  # noqa: N802
            self.do_GET()

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
            return

    return TextHandler


class MockServer:
    def __init__(self, handler_factory: Callable[..., type[BaseHTTPRequestHandler]]):
        self._handler_factory = handler_factory
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self.state: Any = None

    def start(self, state: Any) -> None:
        self.state = state
        handler = self._handler_factory(state)
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2)
        self._server = None
        self._thread = None
        self.state = None

    @property
    def base_url(self) -> str:
        assert self._server is not None
        host, port = self._server.server_address
        return f"http://{host}:{port}"


def read_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    content_length = int(handler.headers.get("content-length", "0"))
    payload = handler.rfile.read(content_length)
    return json.loads(payload.decode("utf-8"))


def send_json(handler: BaseHTTPRequestHandler, status: int, body: Any) -> None:
    encoded = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json")
    handler.send_header("content-length", str(len(encoded)))
    handler.end_headers()
    handler.wfile.write(encoded)


def make_record(record_id: int, event: dict[str, Any], decision: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record_id,
        "recorded_at_unix_ms": int(time.time() * 1000),
        "event": event,
        "decision": decision,
    }


def make_evaluation_outcome(
    record: dict[str, Any], approvals: list[dict[str, Any]]
) -> dict[str, Any]:
    if record["decision"]["action"] != "ask":
        return {
            "status": "completed",
            "audit_record": record,
            "approval_request": None,
        }

    approval = {
        "id": len(approvals) + 1,
        "created_at_unix_ms": int(time.time() * 1000),
        "resolved_at_unix_ms": None,
        "status": "pending",
        "audit_record": record,
        "requested_decision": record["decision"],
        "resolved_decision": None,
        "decided_by": None,
        "resolution_note": None,
    }
    approvals.insert(0, approval)
    return {
        "status": "pending_approval",
        "audit_record": record,
        "approval_request": approval,
    }


def resolve_approval(
    approvals: list[dict[str, Any]],
    approval_id: int,
    body: dict[str, Any],
) -> Optional[dict[str, Any]]:
    for approval in approvals:
        if approval["id"] != approval_id:
            continue

        status = {
            "allow": "approved",
            "warn": "approved",
            "block": "denied",
            "kill": "killed",
        }[body["action"]]
        reason = body.get("reason") or "Resolved by Python test."
        resolved_decision = {
            **approval["audit_record"]["decision"],
            "action": body["action"],
            "reason": reason,
        }
        approval["status"] = status
        approval["resolved_at_unix_ms"] = int(time.time() * 1000)
        approval["resolved_decision"] = resolved_decision
        approval["decided_by"] = body["decided_by"]
        approval["resolution_note"] = reason
        approval["audit_record"] = {
            **approval["audit_record"],
            "decision": resolved_decision,
        }
        return approval

    return None


if __name__ == "__main__":
    unittest.main()
