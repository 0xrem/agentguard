export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Layer = "prompt" | "tool" | "command";
export type TrustLevel = "trusted" | "unknown" | "high_risk";
export type EnforcementAction = "allow" | "warn" | "ask" | "block" | "kill";
export type Operation =
  | "read_file"
  | "write_file"
  | "http_request"
  | "database_query"
  | "browser_open"
  | "send_email"
  | "exec_command"
  | "model_request"
  | "model_response";

export interface AgentIdentity {
  name: string;
  executable_path: string | null;
  process_id: number | null;
  parent_process_id: number | null;
  trust: TrustLevel;
}

export type ResourceTarget =
  | { kind: "path"; value: string }
  | { kind: "command"; value: string }
  | { kind: "domain"; value: string }
  | { kind: "prompt"; value: string }
  | { kind: "database"; value: string }
  | { kind: "none" };

export interface Event {
  layer: Layer;
  operation: Operation;
  agent: AgentIdentity;
  target: ResourceTarget;
  risk_hint: RiskLevel | null;
  metadata: Record<string, string>;
}

export interface Decision {
  action: EnforcementAction;
  risk: RiskLevel;
  reason: string;
  matched_rule_id: string | null;
}

export interface AuditRecord {
  id: number;
  recorded_at_unix_ms: number;
  event: Event;
  decision: Decision;
}

export type AgentLike =
  | string
  | {
      name: string;
      executable_path?: string | null;
      process_id?: number | null;
      parent_process_id?: number | null;
      trust?: TrustLevel;
    };

export interface GuardEventInput {
  layer: Layer;
  operation: Operation;
  target: ResourceTarget;
  metadata?: Record<string, string>;
  riskHint?: RiskLevel | null;
  agent?: AgentLike;
}

export interface GuardedResult<T> {
  auditRecord: AuditRecord;
  value: T;
}

