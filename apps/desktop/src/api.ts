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
} from "./mock";
import type {
  ApprovalRequest,
  AuditRecord,
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

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
