import { invoke } from "@tauri-apps/api/core";
import { mockDashboard, mockSubmitSampleEvent } from "./mock";
import type { AuditRecord, DashboardSnapshot, SampleEventKind } from "./types";

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

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
