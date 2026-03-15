export type RiskLevel = "low" | "medium" | "high" | "critical";
export type EnforcementAction = "allow" | "warn" | "ask" | "block" | "kill";

export interface AgentIdentity {
  name: string;
  executable_path: string | null;
  process_id: number | null;
  parent_process_id: number | null;
  trust: "trusted" | "unknown" | "high_risk";
}

export type ResourceTarget =
  | { kind: "path"; value: string }
  | { kind: "command"; value: string }
  | { kind: "domain"; value: string }
  | { kind: "prompt"; value: string }
  | { kind: "database"; value: string }
  | { kind: "none" };

export interface Event {
  layer: "prompt" | "tool" | "command";
  operation:
    | "read_file"
    | "write_file"
    | "http_request"
    | "database_query"
    | "browser_open"
    | "send_email"
    | "exec_command"
    | "model_request"
    | "model_response";
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

export interface DaemonStatus {
  daemon_url: string;
  healthy: boolean;
  checked_at_unix_ms: number;
  message: string;
  preview_mode?: boolean;
}

export interface RiskCounts {
  low: number;
  medium: number;
  high: number;
  critical: number;
  allow: number;
  warn: number;
  ask: number;
  block: number;
  kill: number;
}

export interface DashboardSnapshot {
  status: DaemonStatus;
  records: AuditRecord[];
  counts: RiskCounts;
}

export type SampleEventKind =
  | "safe_read"
  | "blocked_command"
  | "prompt_injection"
  | "sensitive_secret_read";
