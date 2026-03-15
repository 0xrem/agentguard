import type { AuditRecord } from "./types.js";

export class AgentGuardHttpError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "AgentGuardHttpError";
    this.status = status;
    this.details = details;
  }
}

export class PolicyDeniedError extends Error {
  readonly record: AuditRecord;

  constructor(record: AuditRecord) {
    super(record.decision.reason);
    this.name = "PolicyDeniedError";
    this.record = record;
  }
}

