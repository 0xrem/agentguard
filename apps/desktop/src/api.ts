import { invoke } from "@tauri-apps/api/core";
import {
  mockDeletePolicyRule,
  mockDashboard,
  mockLoadRuntimeEnvironment,
  mockResolveApprovalRequest,
  mockSavePolicyRule,
  mockSetPolicyRuleEnabled,
  mockStartLocalStack,
  mockRunRealAgentDemo,
  mockSubmitSampleEvent,
} from "./mock";
import type {
  ApprovalRequest,
  AuditRecord,
  DashboardSnapshot,
  DemoRunResult,
  EnforcementAction,
  ManagedRule,
  PolicyRule,
  RuntimeEnvironment,
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

export async function runRealAgentDemo(): Promise<DemoRunResult> {
  if (!isTauriRuntime()) {
    return mockRunRealAgentDemo();
  }

  return invoke<DemoRunResult>("run_real_agent_demo");
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
