from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Generic, Literal, Optional, TypeVar

RiskLevel = Literal["low", "medium", "high", "critical"]
Layer = Literal["prompt", "tool", "command"]
TrustLevel = Literal["trusted", "unknown", "high_risk"]
EnforcementAction = Literal["allow", "warn", "ask", "block", "kill"]
ApprovalStatus = Literal["pending", "approved", "denied", "killed", "expired"]
EvaluationStatus = Literal["completed", "pending_approval"]
Operation = Literal[
    "read_file",
    "write_file",
    "http_request",
    "database_query",
    "browser_open",
    "send_email",
    "exec_command",
    "model_request",
    "model_response",
]
ResourceKind = Literal["path", "command", "domain", "prompt", "database", "none"]


@dataclass(slots=True)
class AgentIdentity:
    name: str
    executable_path: Optional[str] = None
    process_id: Optional[int] = None
    parent_process_id: Optional[int] = None
    trust: TrustLevel = "unknown"

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "executable_path": self.executable_path,
            "process_id": self.process_id,
            "parent_process_id": self.parent_process_id,
            "trust": self.trust,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentIdentity":
        return cls(
            name=data["name"],
            executable_path=data.get("executable_path"),
            process_id=data.get("process_id"),
            parent_process_id=data.get("parent_process_id"),
            trust=data.get("trust", "unknown"),
        )


@dataclass(slots=True)
class ResourceTarget:
    kind: ResourceKind
    value: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"kind": self.kind}
        if self.value is not None:
            payload["value"] = self.value
        return payload

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ResourceTarget":
        return cls(kind=data["kind"], value=data.get("value"))


@dataclass(slots=True)
class Event:
    layer: Layer
    operation: Operation
    agent: AgentIdentity
    target: ResourceTarget
    risk_hint: Optional[RiskLevel] = None
    metadata: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "layer": self.layer,
            "operation": self.operation,
            "agent": self.agent.to_dict(),
            "target": self.target.to_dict(),
            "risk_hint": self.risk_hint,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Event":
        return cls(
            layer=data["layer"],
            operation=data["operation"],
            agent=AgentIdentity.from_dict(data["agent"]),
            target=ResourceTarget.from_dict(data["target"]),
            risk_hint=data.get("risk_hint"),
            metadata=dict(data.get("metadata", {})),
        )


@dataclass(slots=True)
class Decision:
    action: EnforcementAction
    risk: RiskLevel
    reason: str
    matched_rule_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "risk": self.risk,
            "reason": self.reason,
            "matched_rule_id": self.matched_rule_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Decision":
        return cls(
            action=data["action"],
            risk=data["risk"],
            reason=data["reason"],
            matched_rule_id=data.get("matched_rule_id"),
        )


@dataclass(slots=True)
class AuditRecord:
    id: int
    recorded_at_unix_ms: int
    event: Event
    decision: Decision

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AuditRecord":
        return cls(
            id=data["id"],
            recorded_at_unix_ms=data["recorded_at_unix_ms"],
            event=Event.from_dict(data["event"]),
            decision=Decision.from_dict(data["decision"]),
        )


@dataclass(slots=True)
class ApprovalRequest:
    id: int
    created_at_unix_ms: int
    resolved_at_unix_ms: Optional[int]
    status: ApprovalStatus
    audit_record: AuditRecord
    requested_decision: Decision
    resolved_decision: Optional[Decision]
    decided_by: Optional[str]
    resolution_note: Optional[str]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ApprovalRequest":
        resolved_decision = data.get("resolved_decision")
        return cls(
            id=data["id"],
            created_at_unix_ms=data["created_at_unix_ms"],
            resolved_at_unix_ms=data.get("resolved_at_unix_ms"),
            status=data["status"],
            audit_record=AuditRecord.from_dict(data["audit_record"]),
            requested_decision=Decision.from_dict(data["requested_decision"]),
            resolved_decision=(
                Decision.from_dict(resolved_decision)
                if resolved_decision is not None
                else None
            ),
            decided_by=data.get("decided_by"),
            resolution_note=data.get("resolution_note"),
        )


@dataclass(slots=True)
class EvaluationOutcome:
    status: EvaluationStatus
    audit_record: AuditRecord
    approval_request: Optional[ApprovalRequest]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "EvaluationOutcome":
        approval_request = data.get("approval_request")
        return cls(
            status=data["status"],
            audit_record=AuditRecord.from_dict(data["audit_record"]),
            approval_request=(
                ApprovalRequest.from_dict(approval_request)
                if approval_request is not None
                else None
            ),
        )


@dataclass(slots=True)
class GuardEventInput:
    layer: Layer
    operation: Operation
    target: ResourceTarget
    metadata: dict[str, str] = field(default_factory=dict)
    risk_hint: Optional[RiskLevel] = None
    agent: Optional["AgentLike"] = None
    wait_for_approval_ms: Optional[int] = None


@dataclass(slots=True)
class ResolveApprovalInput:
    action: EnforcementAction
    decided_by: str
    reason: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "decided_by": self.decided_by,
            "reason": self.reason,
        }


T = TypeVar("T")


@dataclass(slots=True)
class GuardedResult(Generic[T]):
    audit_record: AuditRecord
    value: T


AgentLike = str | AgentIdentity | dict[str, Any]
