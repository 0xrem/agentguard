export type RiskLevel = "low" | "medium" | "high" | "critical";
export type EnforcementAction = "allow" | "warn" | "ask" | "block" | "kill";
export type ApprovalStatus = "pending" | "approved" | "denied" | "killed" | "expired";

export interface AgentIdentity {
  name: string;
  executable_path: string | null;
  process_id: number | null;
  parent_process_id: number | null;
  trust: "trusted" | "unknown" | "high_risk";
}

export type MatchPattern =
  | { type: "any" }
  | { type: "exact"; value: string }
  | { type: "prefix"; value: string }
  | { type: "contains"; value: string }
  | { type: "contains_insensitive"; value: string }
  | { type: "one_of"; value: string[] };

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

export interface PolicyRule {
  id: string;
  priority: number;
  layer: Event["layer"] | null;
  operation: Event["operation"] | null;
  agent: MatchPattern;
  target: MatchPattern;
  minimum_risk: RiskLevel | null;
  action: EnforcementAction;
  reason: string;
}

export interface ManagedRule {
  id: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  enabled: boolean;
  rule: PolicyRule;
}

export interface RuntimeStartResult {
  daemon_started: boolean;
  proxy_started: boolean;
  daemon_pid: number | null;
  proxy_pid: number | null;
  daemon_url: string;
  proxy_url: string;
  message: string;
}

export interface DemoRunResult {
  mode: "python_sdk" | "openai_proxy";
  command: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  message: string;
}

export interface AuditRecord {
  id: number;
  recorded_at_unix_ms: number;
  event: Event;
  decision: Decision;
}

export interface ApprovalRequest {
  id: number;
  created_at_unix_ms: number;
  resolved_at_unix_ms: number | null;
  status: ApprovalStatus;
  audit_record: AuditRecord;
  requested_decision: Decision;
  resolved_decision: Decision | null;
  decided_by: string | null;
  resolution_note: string | null;
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
  pending_approvals: ApprovalRequest[];
  remembered_rules: ManagedRule[];
}

export type SampleEventKind =
  | "review_upload"
  | "safe_read"
  | "blocked_command"
  | "prompt_injection"
  | "sensitive_secret_read";
