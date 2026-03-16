export type RiskLevel = "low" | "medium" | "high" | "critical";
export type EnforcementAction = "allow" | "warn" | "ask" | "block" | "kill";
export type ApprovalStatus = "pending" | "approved" | "denied" | "killed" | "expired";
export type Layer = "prompt" | "tool" | "command";

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

export interface RuntimeEnvironment {
  mode: "bundled" | "workspace";
  runtime_root: string;
  workspace_root: string | null;
  resource_root: string | null;
  app_support_root: string;
  database_path: string;
  daemon_source: string;
  daemon_launch_command: string;
  proxy_source: string;
  proxy_launch_command: string;
  python_command: string | null;
  python_path_root: string | null;
  live_demo_script_path: string | null;
  openai_demo_script_path: string | null;
  bundled_assets_ready: boolean;
  python_available: boolean;
  live_demo_ready: boolean;
  openai_key_available: boolean;
  issues: string[];
  message: string;
}

export interface RuntimeProcessInfo {
  pid: number;
  name: string;
  risk: "high" | "medium" | "low";
  status: "running" | "stopped" | "zombie";
  coverageStatus: "protected" | "likely_unprotected" | "unknown";
  coverageReason: string;
  coverageConfidence: "high" | "medium" | "low";
  coverageScore: number;
  coverageEvidence: CoverageEvidence[];
  lastEventAtUnixMs: number | null;
  cpu: number;
  memory: number;
  network: number;
  networkSource: "nettop_delta" | "lsof_sockets" | "unknown";
  events: number;
  uptime: number;
  command: string;
  user: string;
  threads: number;
  openFiles: number;
}

export interface CoverageEvidence {
  kind: "audit_link" | "agent_signature" | "runtime_signal";
  label: string;
  value: string;
  weight: number;
}

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  category: "security" | "privacy" | "productivity" | "compliance";
  rule: Omit<PolicyRule, "id">;
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

export interface RulePreset {
  id: string;
  name: string;
  description: string;
  rules: PolicyRule[];
}

export interface RuleExport {
  version: string;
  exported_at: number;
  rules: PolicyRule[];
}

export interface AuditQuery {
  layer?: string;
  agent_name?: string;
  operation?: string;
  action?: string;
  risk_level?: string;
  start_time?: number;
  end_time?: number;
  limit?: number;
  offset?: number;
}

export interface AuditStats {
  since_unix_ms: number;
  total: number;
  by_action: Record<string, number>;
  by_risk: Record<string, number>;
  by_layer: Record<string, number>;
  top_agents: [string, number][];
}

export interface RuleConflict {
  kind: "action_conflict" | "shadowed";
  rule_a_id: string;
  rule_b_id: string;
  description: string;
}

export type AuditReviewStatus = "unreviewed" | "false_positive" | "resolved" | "needs_attention";

export interface AuditReview {
  audit_record_id: number;
  status: AuditReviewStatus;
  label: string | null;
  note: string | null;
  reviewed_by: string | null;
  updated_at_unix_ms: number;
}

export interface AuditReviewQuery {
  record_ids?: number[];
  status?: AuditReviewStatus;
  limit?: number;
  offset?: number;
}

export interface AuditReviewUpdate {
  status: AuditReviewStatus;
  label?: string | null;
  note?: string | null;
  reviewed_by?: string | null;
}
