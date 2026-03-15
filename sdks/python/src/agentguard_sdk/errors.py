from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .types import AuditRecord, EvaluationOutcome


@dataclass(slots=True)
class AgentGuardHttpError(Exception):
    message: str
    status: int
    details: Any

    def __post_init__(self) -> None:
        Exception.__init__(self, self.message)

    def __str__(self) -> str:
        return self.message


@dataclass(slots=True)
class PolicyDeniedError(Exception):
    record: AuditRecord

    def __post_init__(self) -> None:
        Exception.__init__(self, self.record.decision.reason)

    def __str__(self) -> str:
        return self.record.decision.reason


@dataclass(slots=True)
class PendingApprovalError(Exception):
    outcome: EvaluationOutcome

    def __post_init__(self) -> None:
        Exception.__init__(self, self.outcome.audit_record.decision.reason)

    def __str__(self) -> str:
        return self.outcome.audit_record.decision.reason
