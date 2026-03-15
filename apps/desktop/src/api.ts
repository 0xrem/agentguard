import { invoke } from "@tauri-apps/api/core";
import {
  mockDashboard,
  mockResolveApprovalRequest,
  mockSavePolicyRule,
  mockSubmitSampleEvent,
} from "./mock";
import type {
  ApprovalRequest,
  AuditRecord,
  DashboardSnapshot,
  EnforcementAction,
  PolicyRule,
  SampleEventKind,
} from "./types";

export async function loadDashboard(limit = 25): Promise<DashboardSnapshot> {
  if (!isTauriRuntime()) {
    return mockDashboard(limit);
  }

  return invoke<DashboardSnapshot>("load_dashboard_snapshot", { limit });
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

export async function savePolicyRule(rule: PolicyRule): Promise<PolicyRule> {
  if (!isTauriRuntime()) {
    return mockSavePolicyRule(rule);
  }

  return invoke<PolicyRule>("save_policy_rule", { rule });
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
