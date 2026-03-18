import { invoke } from "@tauri-apps/api/core";
import {
  mockDeletePolicyRule,
  mockDashboard,
  mockLoadProcesses,
  mockLoadRuntimeEnvironment,
  mockQueryAuditLogs,
  mockResolveApprovalRequest,
  mockSavePolicyRule,
  mockSetPolicyRuleEnabled,
  mockStartLocalStack,
  mockRunRealAgentDemo,
  mockSubmitSampleEvent,
  mockGetAuditStats,
  mockDetectRuleConflicts,
  mockQueryAuditReviews,
  mockUpdateAuditReview,
} from "./mock";
import type {
  ApprovalRequest,
  AuditRecord,
  AuditReview,
  AuditReviewQuery,
  AuditReviewUpdate,
  AuditQuery,
  AuditStats,
  DashboardSnapshot,
  DemoRunResult,
  EnforcementAction,
  ManagedRule,
  PolicyRule,
  RuleConflict,
  RuleExport,
  RuntimeEnvironment,
  RuntimeProcessInfo,
  RuntimeStartResult,
  SampleEventKind,
} from "./types";

export async function loadDashboard(limit = 25): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) {
    return mockDashboard(limit);
  }

  return invoke<DashboardSnapshot>("load_dashboard_snapshot", { limit });
}

export interface DashboardMetrics {
  agentCount: number;
  pendingApprovalCount: number;
  latestRecordId: number | null;
  totalRiskCount: number;
  hash: string; // Used for change detection
}

export type RealtimeTopic = "dashboard" | "audit" | "rules" | "processes";

export interface RealtimeEvent {
  seq: number;
  topic: RealtimeTopic;
  source: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface RealtimeTopicSnapshot {
  topic: RealtimeTopic;
  version: number;
  seq: number;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface RealtimeTopicReplay {
  watermark_seq: number;
  gap_detected: boolean;
  snapshots: RealtimeTopicSnapshot[];
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  if (!isTauriRuntime()) {
    // Generate metrics from mock dashboard
    const dashboard = await mockDashboard(25);
    const totalRisk = Object.values(dashboard.counts).reduce((a, b) => a + b, 0);
    const data = JSON.stringify([
      dashboard.records.length,
      dashboard.pending_approvals.length,
      dashboard.records[0]?.id ?? 0,
      totalRisk,
    ]);
    return {
      agentCount: dashboard.records.length,
      pendingApprovalCount: dashboard.pending_approvals.length,
      latestRecordId: dashboard.records[0]?.id ?? null,
      totalRiskCount: totalRisk,
      hash: `h${data.length}`, // Simple hash
    };
  }

  return invoke<DashboardMetrics>("get_dashboard_metrics");
}

export async function getRealtimeEventsSince(
  sinceSeq?: number,
  limit = 64,
): Promise<RealtimeEvent[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  return invoke<RealtimeEvent[]>("get_realtime_events_since", {
    sinceSeq: sinceSeq ?? null,
    limit,
  });
}

export async function getRealtimeTopicSnapshots(
  topicVersions: Partial<Record<RealtimeTopic, number>>,
  sinceSeq?: number,
  limit = 16,
): Promise<RealtimeTopicReplay> {
  if (!isTauriRuntime()) {
    return {
      watermark_seq: sinceSeq ?? 0,
      gap_detected: false,
      snapshots: [],
    };
  }

  return invoke<RealtimeTopicReplay>("get_realtime_topic_snapshots", {
    topicVersions,
    sinceSeq: sinceSeq ?? null,
    limit,
  });
}

export async function loadRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  if (!isTauriRuntime()) {
    return mockLoadRuntimeEnvironment();
  }

  return invoke<RuntimeEnvironment>("load_runtime_environment");
}

export async function loadProcesses(limit = 80): Promise<RuntimeProcessInfo[]> {
  if (!isTauriRuntime()) {
    return mockLoadProcesses(limit);
  }

  return invoke<RuntimeProcessInfo[]>("list_runtime_processes", { limit });
}

export async function submitSampleEvent(kind: SampleEventKind): Promise<AuditRecord> {
  if (!isTauriRuntime()) {
    return mockSubmitSampleEvent(kind);
  }

  return invoke<AuditRecord>("submit_sample_event", { kind });
}

export async function resolveApprovalRequest(
  approvalId: number,
  action: Exclude<EnforcementAction, "ask">,
  reason: string | null,
): Promise<ApprovalRequest> {
  if (!isTauriRuntime()) {
    return mockResolveApprovalRequest(approvalId, action, reason);
  }

  return invoke<ApprovalRequest>("resolve_approval_request", {
    approvalId,
    action,
    reason,
  });
}

export async function savePolicyRule(rule: PolicyRule): Promise<ManagedRule> {
  if (!isTauriRuntime()) {
    return mockSavePolicyRule(rule);
  }

  return invoke<ManagedRule>("save_policy_rule", { rule });
}

export async function setPolicyRuleEnabled(
  ruleId: string,
  enabled: boolean,
): Promise<ManagedRule> {
  if (!isTauriRuntime()) {
    return mockSetPolicyRuleEnabled(ruleId, enabled);
  }

  return invoke<ManagedRule>("set_policy_rule_enabled", { ruleId, enabled });
}

export async function deletePolicyRule(ruleId: string): Promise<void> {
  if (!isTauriRuntime()) {
    return mockDeletePolicyRule(ruleId);
  }

  await invoke("delete_policy_rule", { ruleId });
}

export async function startLocalStack(): Promise<RuntimeStartResult> {
  if (!isTauriRuntime()) {
    return mockStartLocalStack();
  }

  return invoke<RuntimeStartResult>("start_local_stack");
}

export async function runRealAgentDemo(mode: "python_sdk" | "openai_proxy"): Promise<DemoRunResult> {
  console.log("[runRealAgentDemo] Mode:", mode);
  console.log("[runRealAgentDemo] Is Tauri runtime:", isTauriRuntime());
  if (!isTauriRuntime()) {
    console.log("[runRealAgentDemo] Using mock implementation");
    return mockRunRealAgentDemo(mode);
  }

  console.log("[runRealAgentDemo] Invoking Tauri command");
  return invoke<DemoRunResult>("run_real_agent_demo", { mode });
}

export async function exportRules(): Promise<RuleExport> {
  if (!isTauriRuntime()) {
    return {
      version: "1.0",
      exported_at: Date.now(),
      rules: [],
    };
  }

  return invoke<RuleExport>("export_policy_rules");
}

export async function importRules(exportData: RuleExport): Promise<ManagedRule[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  return invoke<ManagedRule[]>("import_policy_rules", { exportData });
}

export async function queryAuditLogs(query: AuditQuery): Promise<AuditRecord[]> {
  if (!isTauriRuntime()) {
    return mockQueryAuditLogs(query);
  }

  return invoke<AuditRecord[]>("query_audit_logs", { query });
}

export async function getAuditStats(since?: number): Promise<AuditStats> {
  if (!isTauriRuntime()) {
    return mockGetAuditStats(since);
  }

  return invoke<AuditStats>("get_audit_stats", { since: since ?? null });
}

export async function detectRuleConflicts(): Promise<RuleConflict[]> {
  if (!isTauriRuntime()) {
    return mockDetectRuleConflicts();
  }

  return invoke<RuleConflict[]>("detect_rule_conflicts");
}

export async function queryAuditReviews(query: AuditReviewQuery): Promise<AuditReview[]> {
  if (!isTauriRuntime()) {
    return mockQueryAuditReviews(query);
  }

  return invoke<AuditReview[]>("query_audit_reviews", { query });
}

export async function updateAuditReview(
  auditRecordId: number,
  review: AuditReviewUpdate,
): Promise<AuditReview> {
  if (!isTauriRuntime()) {
    return mockUpdateAuditReview(auditRecordId, review);
  }

  return invoke<AuditReview>("update_audit_review", {
    auditRecordId,
    review,
  });
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
