from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

from .errors import AgentGuardHttpError, PendingApprovalError, PolicyDeniedError
from .types import (
    AgentIdentity,
    AgentLike,
    ApprovalRequest,
    AuditRecord,
    Event,
    EvaluationOutcome,
    GuardEventInput,
    ResourceTarget,
    ResolveApprovalInput,
    RiskLevel,
)

DEFAULT_BASE_URL = "http://127.0.0.1:8790"
DEFAULT_TIMEOUT_SECONDS = 30.0
JsonMapping = dict[str, Any]
UrlOpenLike = Callable[..., Any]


class AgentGuardClient:
    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        agent: Optional[AgentLike] = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        opener: Optional[UrlOpenLike] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> None:
        self.base_url = normalize_base_url(
            base_url or os.environ.get("AGENTGUARD_DAEMON_URL") or DEFAULT_BASE_URL
        )
        self.timeout = timeout
        self._opener = opener or urllib.request.urlopen
        self.default_agent = normalize_agent_identity(agent)
        self.headers = dict(headers or {})

    def record_event(self, event: Event) -> AuditRecord:
        payload = self._request_json(
            "/v1/events",
            method="POST",
            body=event.to_dict(),
        )
        return AuditRecord.from_dict(payload)

    def evaluate_event(self, event_or_input: Event | GuardEventInput) -> EvaluationOutcome:
        event, wait_for_approval_ms = self._normalize_evaluate_input(event_or_input)
        payload = self._request_json(
            "/v1/evaluate",
            method="POST",
            body={
                "event": event.to_dict(),
                "wait_for_approval_ms": wait_for_approval_ms,
            },
        )
        return EvaluationOutcome.from_dict(payload)

    def list_audit(self, limit: int = 25) -> list[AuditRecord]:
        safe_limit = max(1, min(limit, 500))
        payload = self._request_json(f"/v1/audit?limit={safe_limit}")
        return [AuditRecord.from_dict(record) for record in payload]

    def list_approvals(
        self,
        *,
        limit: int = 25,
        status: str = "all",
    ) -> list[ApprovalRequest]:
        safe_limit = max(1, min(limit, 500))
        query = urllib.parse.urlencode({"limit": safe_limit, "status": status})
        payload = self._request_json(f"/v1/approvals?{query}")
        return [ApprovalRequest.from_dict(item) for item in payload]

    def resolve_approval_request(
        self,
        approval_id: int,
        resolution: ResolveApprovalInput,
    ) -> ApprovalRequest:
        payload = self._request_json(
            f"/v1/approvals/{approval_id}/resolve",
            method="POST",
            body=resolution.to_dict(),
        )
        return ApprovalRequest.from_dict(payload)

    def build_event(self, input_data: GuardEventInput) -> Event:
        return Event(
            layer=input_data.layer,
            operation=input_data.operation,
            target=input_data.target,
            risk_hint=input_data.risk_hint,
            metadata=dict(input_data.metadata),
            agent=normalize_agent_identity(input_data.agent or self.default_agent),
        )

    def guard_event(self, input_data: GuardEventInput) -> AuditRecord:
        outcome = self.evaluate_event(input_data)

        if outcome.status == "pending_approval":
            raise PendingApprovalError(outcome)

        if should_deny(outcome.audit_record.decision.action):
            raise PolicyDeniedError(outcome.audit_record)

        return outcome.audit_record

    def _normalize_evaluate_input(
        self, event_or_input: Event | GuardEventInput
    ) -> tuple[Event, Optional[int]]:
        if isinstance(event_or_input, Event):
            return event_or_input, None

        return self.build_event(event_or_input), event_or_input.wait_for_approval_ms

    def _request_json(
        self,
        path: str,
        *,
        method: str = "GET",
        body: Optional[JsonMapping] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> Any:
        payload = None if body is None else json.dumps(body).encode("utf-8")
        request_headers = {"content-type": "application/json", **self.headers, **dict(headers or {})}
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=payload,
            method=method,
            headers=request_headers,
        )

        try:
            response = self._opener(request, timeout=self.timeout)
        except urllib.error.HTTPError as error:
            raise build_http_error(error) from error
        except urllib.error.URLError as error:
            raise AgentGuardHttpError(str(error.reason), 0, None) from error

        try:
            response_bytes = response.read()
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                close()

        if not response_bytes:
            return None

        return json.loads(response_bytes.decode("utf-8"))


def normalize_agent_identity(agent: Optional[AgentLike]) -> AgentIdentity:
    runtime = infer_runtime_agent_identity()

    if isinstance(agent, AgentIdentity):
        return AgentIdentity(
            name=agent.name,
            executable_path=agent.executable_path or runtime.executable_path,
            process_id=agent.process_id or runtime.process_id,
            parent_process_id=agent.parent_process_id or runtime.parent_process_id,
            trust=agent.trust,
        )

    if isinstance(agent, str):
        return AgentIdentity(
            name=agent,
            executable_path=runtime.executable_path,
            process_id=runtime.process_id,
            parent_process_id=runtime.parent_process_id,
            trust="unknown",
        )

    if not agent:
        return runtime

    return AgentIdentity(
        name=agent["name"],
        executable_path=agent.get("executable_path") or runtime.executable_path,
        process_id=agent.get("process_id") or runtime.process_id,
        parent_process_id=agent.get("parent_process_id") or runtime.parent_process_id,
        trust=agent.get("trust", "unknown"),
    )


def named_agent(name: str) -> AgentIdentity:
    return AgentIdentity(name=name)


def infer_runtime_agent_identity(name: Optional[str] = None) -> AgentIdentity:
    script_path = Path(sys.argv[0]).expanduser()
    inferred_name = (
        name
        or (script_path.stem if script_path.name else None)
        or Path(sys.executable).name
        or "unknown-agent"
    )
    executable_path = sys.executable or None

    return AgentIdentity(
        name=inferred_name,
        executable_path=executable_path,
        process_id=os.getpid(),
        parent_process_id=os.getppid(),
        trust="unknown",
    )


def path_target(value: str) -> ResourceTarget:
    return ResourceTarget(kind="path", value=value)


def command_target(value: str) -> ResourceTarget:
    return ResourceTarget(kind="command", value=value)


def domain_target(value: str) -> ResourceTarget:
    return ResourceTarget(kind="domain", value=value)


def prompt_target(value: str) -> ResourceTarget:
    return ResourceTarget(kind="prompt", value=value)


def should_deny(action: str) -> bool:
    return action in {"ask", "block", "kill"}


def with_metadata(
    metadata: Optional[Mapping[str, str]],
    additions: Mapping[str, Optional[str]],
) -> dict[str, str]:
    merged = dict(metadata or {})
    for key, value in additions.items():
        if value is not None:
            merged[key] = value
    return merged


def normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def build_http_error(error: urllib.error.HTTPError) -> AgentGuardHttpError:
    response_bytes = error.read()
    details: Any = None
    message = f"{error.code} {error.reason}"

    if response_bytes:
        content_type = error.headers.get("content-type", "")
        if "application/json" in content_type:
            details = json.loads(response_bytes.decode("utf-8"))
            maybe_message = (
                details.get("error", {}).get("message")
                if isinstance(details, dict)
                else None
            )
            if isinstance(maybe_message, str):
                message = maybe_message
        else:
            message = response_bytes.decode("utf-8")
            details = message

    return AgentGuardHttpError(message=message, status=error.code, details=details)


__all__ = [
    "AgentGuardClient",
    "command_target",
    "domain_target",
    "infer_runtime_agent_identity",
    "named_agent",
    "normalize_agent_identity",
    "path_target",
    "prompt_target",
    "should_deny",
    "with_metadata",
    "RiskLevel",
]
