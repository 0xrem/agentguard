import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  deletePolicyRule,
  detectRuleConflicts,
  exportRules,
  getAuditStats,
  getDashboardMetrics,
  importRules,
  loadDashboard,
  loadProcesses,
  queryAuditReviews,
  queryAuditLogs,
  loadRuntimeEnvironment,
  resolveApprovalRequest,
  runRealAgentDemo,
  savePolicyRule,
  setPolicyRuleEnabled,
  startLocalStack,
  submitSampleEvent,
  updateAuditReview,
  type DashboardMetrics,
} from "./api";
import { mockLoadProcesses } from "./mock";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { AuditPage } from "./pages/AuditPage";
import type { AuditFilters } from "./pages/AuditPage";
import { ProcessesPage } from "./pages/ProcessesPage";
import { RulesPage } from "./pages/RulesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";
import { useLanguage, type Language, type NavItem } from "./i18n";
import type {
  ApprovalRequest,
  AuditRecord,
  AuditReview,
  AuditReviewStatus,
  AuditQuery,
  AuditStats,
  DashboardSnapshot,
  RuleConflict,
  DemoRunResult,
  EnforcementAction,
  Layer,
  ManagedRule,
  PolicyRule,
  RiskCounts,
  RiskLevel,
  RuleExport,
  RuntimeEnvironment,
  RuntimeProcessInfo,
  RuntimeStartResult,
  SampleEventKind,
} from "./types";

const AUDIT_PAGE_SIZE = 50;
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const COVERAGE_REGRESSION_MIN_MS = 20_000;
const COVERAGE_REGRESSION_COOLDOWN_MS = 120_000;
const AUTO_START_STACK_KEY = "agentguard:autoStartStack";
const PROCESS_DATA_MODE_KEY = "agentguard:processDataMode";
const SYNTHETIC_AGENT_COUNT_KEY = "agentguard:syntheticAgentCount";

type ProcessDataMode = "live" | "constructed" | "mock";

interface SelfTestCheck {
  id: string;
  label: string;
  status: "pass" | "fail";
  detail: string;
}

interface ProtectionAlert {
  id: string;
  severity: "critical" | "warning";
  message: string;
  processes: Array<RuntimeProcessInfo & { risk: "high" | "medium" | "low" }>;
}

interface ProtectionFixResult {
  status: "success" | "error";
  message: string;
  at: number;
}

interface CoverageRegressionAlert {
  process: RuntimeProcessInfo;
  startedAt: number;
  durationMs: number;
  severity: "critical" | "warning";
}

interface CoverageRecoveryEvent {
  process: RuntimeProcessInfo;
  recoveredAt: number;
  downtimeMs: number;
}

const SAMPLE_SCENARIOS: Array<{
  kind: SampleEventKind;
  title: string;
  eyebrow: string;
  description: string;
}> = [
  {
    kind: "review_upload",
    eyebrow: "Approval flow",
    title: "Queue a high-risk upload for approval",
    description:
      "Creates an outbound upload event that must be approved from the desktop modal before it can proceed.",
  },
  {
    kind: "blocked_command",
    eyebrow: "Critical command",
    title: "Block a destructive shell action",
    description: "Sends `rm -rf ~` through the daemon so we can verify the runtime firewall path.",
  },
  {
    kind: "sensitive_secret_read",
    eyebrow: "Credential path",
    title: "Probe a secret read",
    description:
      "Attempts to read `~/.ssh/id_rsa` to confirm sensitive path protection stays locked down.",
  },
  {
    kind: "prompt_injection",
    eyebrow: "Prompt guard",
    title: "Inject a suspicious instruction",
    description:
      "Submits a prompt with `ignore previous instructions` to demonstrate warning-level prompt review.",
  },
  {
    kind: "safe_read",
    eyebrow: "Happy path",
    title: "Record a normal workspace read",
    description:
      "Shows what a low-risk event looks like when an assistant touches an approved project file.",
  },
];

const EMPTY_COUNTS: RiskCounts = {
  low: 0,
  medium: 0,
  high: 0,
  critical: 0,
  allow: 0,
  warn: 0,
  ask: 0,
  block: 0,
  kill: 0,
};

interface RuleDraft {
  id: string;
  action: "allow" | "block";
  priority: number;
  layer: PolicyRule["layer"];
  operation: PolicyRule["operation"];
  minimum_risk: PolicyRule["minimum_risk"];
  agent_value: string;
  target_value: string;
  reason: string;
}

export default function App() {
  const { t, language, setLanguage } = useLanguage();
  const [currentPage, setCurrentPage] = useState<NavItem['id']>('dashboard');
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<SampleEventKind>("review_upload");
  const [submitting, setSubmitting] = useState(false);
  const [lastRecord, setLastRecord] = useState<AuditRecord | null>(null);
  const [activeApprovalId, setActiveApprovalId] = useState<number | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [rememberDecision, setRememberDecision] = useState(false);
  const [resolvingAction, setResolvingAction] = useState<Exclude<EnforcementAction, "ask"> | null>(
    null,
  );
  const [startingStack, setStartingStack] = useState(false);
  const [runningDemo, setRunningDemo] = useState(false);
  const [stackResult, setStackResult] = useState<RuntimeStartResult | null>(null);
  const [demoResult, setDemoResult] = useState<DemoRunResult | null>(null);
  const [runtimeEnvironment, setRuntimeEnvironment] = useState<RuntimeEnvironment | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [savingRule, setSavingRule] = useState(false);
  const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  const [exportingRules, setExportingRules] = useState(false);
  const [importingRules, setImportingRules] = useState(false);
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [showRuleEditorModal, setShowRuleEditorModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [auditReviewMap, setAuditReviewMap] = useState<Record<number, AuditReview>>({});
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const [auditHasNextPage, setAuditHasNextPage] = useState(false);
  const [auditFilters, setAuditFilters] = useState<AuditFilters>({
    searchQuery: "",
    filterLayer: "all",
    filterAction: "all",
    filterRisk: "all",
    timeRange: "7d",
  });
  const [darkMode, setDarkMode] = useState(false);
  const [processes, setProcesses] = useState<RuntimeProcessInfo[]>([]);
  const [coverageRegressions, setCoverageRegressions] = useState<CoverageRegressionAlert[]>([]);
  const [recentRecoveries, setRecentRecoveries] = useState<CoverageRecoveryEvent[]>([]);
  const [processesLoading, setProcessesLoading] = useState(false);
  const [alertCooldownUntil, setAlertCooldownUntil] = useState<Record<string, number>>({});
  const [lastProtectionFix, setLastProtectionFix] = useState<ProtectionFixResult | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [dataRetentionDays, setDataRetentionDays] = useState(30);
  const processNetworkCacheRef = useRef<Record<number, number>>({});
  const previousCoverageRef = useRef<Record<number, RuntimeProcessInfo["coverageStatus"]>>({});
  const ongoingRegressionRef = useRef<Record<number, { startedAt: number; process: RuntimeProcessInfo }>>({});
  const regressionCooldownUntilRef = useRef<Record<number, number>>({});
  const [autoStartStack, setAutoStartStack] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(AUTO_START_STACK_KEY);
      return raw === null ? true : raw === "1";
    } catch {
      return true;
    }
  });
  const [autoStartAttempted, setAutoStartAttempted] = useState(false);
  const [processDataMode, setProcessDataMode] = useState<ProcessDataMode>(() => {
    try {
      const raw = window.localStorage.getItem(PROCESS_DATA_MODE_KEY);
      return raw === "constructed" || raw === "mock" ? raw : "live";
    } catch {
      return "live";
    }
  });
  const [syntheticAgentCount, setSyntheticAgentCount] = useState<number>(() => {
    try {
      const raw = Number(window.localStorage.getItem(SYNTHETIC_AGENT_COUNT_KEY));
      if (Number.isFinite(raw) && raw >= 0 && raw <= 24) {
        return Math.floor(raw);
      }
      return 6;
    } catch {
      return 6;
    }
  });
  const [selfTestRunning, setSelfTestRunning] = useState(false);
  const [selfTestReport, setSelfTestReport] = useState<{
    checkedAt: number;
    allPassed: boolean;
    checks: SelfTestCheck[];
  } | null>(null);

  const [auditStats, setAuditStats] = useState<AuditStats | null>(null);
  const [ruleConflicts, setRuleConflicts] = useState<RuleConflict[]>([]);
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(Date.now());
  
  // Smart polling: track last metrics to detect changes
  const lastMetricsRef = useRef<DashboardMetrics | null>(null);

  useEffect(() => {
    void refreshDashboard(true);

    const timer = window.setInterval(() => {
      // Smart polling: first check metrics to detect changes
      void (async () => {
        try {
          const metrics = await getDashboardMetrics();
          const lastMetrics = lastMetricsRef.current;
          
          // Only refresh full dashboard if metrics changed or it's first check
          if (!lastMetrics || metrics.hash !== lastMetrics.hash) {
            lastMetricsRef.current = metrics;
            await refreshDashboard(false);
          }
        } catch (e) {
          console.error("[Smart polling] Error:", e);
          // Fallback: do full refresh on error
          await refreshDashboard(false);
        }
      })();
    }, 2000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_START_STACK_KEY, autoStartStack ? "1" : "0");
    } catch {
      // Ignore localStorage persistence issues.
    }
  }, [autoStartStack]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PROCESS_DATA_MODE_KEY, processDataMode);
    } catch {
      // Ignore localStorage persistence issues.
    }
  }, [processDataMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SYNTHETIC_AGENT_COUNT_KEY, String(syntheticAgentCount));
    } catch {
      // Ignore localStorage persistence issues.
    }
  }, [syntheticAgentCount]);

  const pendingApprovals = snapshot?.pending_approvals ?? [];
  const [userDismissedApproval, setUserDismissedApproval] = useState<number | null>(null);

  useEffect(() => {
    if (pendingApprovals.length === 0) {
      if (activeApprovalId !== null) {
        setActiveApprovalId(null);
      }
      setUserDismissedApproval(null);
      return;
    }

    // If user manually dismissed an approval, don't auto-reopen for that specific approval
    if (userDismissedApproval && pendingApprovals.some((approval) => approval.id === userDismissedApproval)) {
      return;
    }

    if (activeApprovalId && pendingApprovals.some((approval) => approval.id === activeApprovalId)) {
      return;
    }

    setActiveApprovalId(pendingApprovals[0].id);
  }, [activeApprovalId, pendingApprovals, userDismissedApproval]);

  useEffect(() => {
    setResolutionNote("");
    setRememberDecision(false);
  }, [activeApprovalId]);

  useEffect(() => {
    if (editingRuleId === null) {
      return;
    }

    const activeRule = snapshot?.remembered_rules.find((rule) => rule.id === editingRuleId);
    if (!activeRule) {
      setEditingRuleId(null);
      setRuleDraft(null);
    }
  }, [editingRuleId, snapshot]);

  async function refreshDashboard(initial: boolean) {
    if (initial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [nextSnapshot, nextRuntimeEnvironment, nextProcesses, nextStats] = await Promise.all([
        loadDashboard(30),
        loadRuntimeEnvironment(),
        fetchProcessFeed(processDataMode, syntheticAgentCount).catch(() => []),
        getAuditStats(Date.now() - 86_400_000).catch(() => null),
      ]);
      setError(null);
      startTransition(() => {
        if (nextStats) setAuditStats(nextStats);
        setSnapshot(nextSnapshot);
        setRuntimeEnvironment(nextRuntimeEnvironment);
        setProcesses(smoothRuntimeProcesses(nextProcesses, processNetworkCacheRef.current));
        setLastRefreshTime(Date.now());
      });
    } catch (refreshError) {
      setError(getErrorMessage(refreshError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleScenarioSubmit() {
    setSubmitting(true);
    try {
      const record = await submitSampleEvent(selectedScenario);
      setLastRecord(record);
      setError(null);
      await refreshDashboard(false);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshAuditLogs() {
    setAuditLoading(true);
    try {
      const now = Date.now();
      const startTime = auditFilters.timeRange === "today"
        ? new Date(now).setHours(0, 0, 0, 0)
        : auditFilters.timeRange === "7d"
          ? now - 7 * 24 * 60 * 60 * 1000
          : auditFilters.timeRange === "30d"
            ? now - 30 * 24 * 60 * 60 * 1000
            : undefined;

      const query: AuditQuery = {
        layer: auditFilters.filterLayer !== "all" ? auditFilters.filterLayer : undefined,
        agent_name: auditFilters.searchQuery.trim() || undefined,
        action: auditFilters.filterAction !== "all" ? auditFilters.filterAction : undefined,
        risk_level: auditFilters.filterRisk !== "all" ? auditFilters.filterRisk : undefined,
        start_time: startTime,
        end_time: startTime ? now : undefined,
        limit: AUDIT_PAGE_SIZE + 1,
        offset: (auditPage - 1) * AUDIT_PAGE_SIZE,
      };
      const raw = await queryAuditLogs(query);
      const pageRecords = raw.slice(0, AUDIT_PAGE_SIZE);
      setAuditHasNextPage(raw.length > AUDIT_PAGE_SIZE);
      setAuditRecords(pageRecords);

      const reviewRows = await queryAuditReviews({
        record_ids: pageRecords.map((item) => item.id),
        limit: AUDIT_PAGE_SIZE,
      });
      setAuditReviewMap(
        reviewRows.reduce<Record<number, AuditReview>>((acc, item) => {
          acc[item.audit_record_id] = item;
          return acc;
        }, {}),
      );
      setAuditLoaded(true);
      setError(null);
    } catch (auditError) {
      setError(getErrorMessage(auditError));
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    if (currentPage !== "audit") {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshAuditLogs();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [currentPage, auditFilters, auditPage]);

  function handleAuditFiltersChange(nextFilters: AuditFilters) {
    setAuditPage(1);
    setAuditFilters(nextFilters);
  }

  async function handleAuditReviewUpdate(
    auditRecordId: number,
    status: AuditReviewStatus,
    note?: string,
    label?: string,
  ) {
    try {
      const updated = await updateAuditReview(auditRecordId, {
        status,
        note: note ?? null,
        label: label ?? null,
        reviewed_by: "desktop_user",
      });
      setAuditReviewMap((prev) => ({
        ...prev,
        [updated.audit_record_id]: updated,
      }));
      setError(null);
    } catch (reviewError) {
      setError(getErrorMessage(reviewError));
    }
  }

  async function refreshProcesses() {
    setProcessesLoading(true);
    try {
      const next = await fetchProcessFeed(processDataMode, syntheticAgentCount);
      setProcesses(smoothRuntimeProcesses(next, processNetworkCacheRef.current));
      setError(null);
    } catch (processError) {
      setError(getErrorMessage(processError));
    } finally {
      setProcessesLoading(false);
    }
  }

  useEffect(() => {
    if (currentPage !== "processes") {
      return;
    }

    void refreshProcesses();
    const timer = window.setInterval(() => {
      void refreshProcesses();
    }, 2000);

    return () => window.clearInterval(timer);
  }, [currentPage, processDataMode, syntheticAgentCount]);

  async function runSelfTestSuite() {
    setSelfTestRunning(true);
    const checks: SelfTestCheck[] = [];

    async function check(label: string, fn: () => Promise<void>) {
      try {
        await fn();
        checks.push({ id: label, label, status: "pass", detail: "OK" });
      } catch (error) {
        checks.push({
          id: label,
          label,
          status: "fail",
          detail: getErrorMessage(error),
        });
      }
    }

    await check("Runtime environment", async () => {
      await loadRuntimeEnvironment();
    });
    await check("Dashboard snapshot", async () => {
      const dashboard = await loadDashboard(10);
      if (!dashboard.status) {
        throw new Error("Missing dashboard status payload");
      }
    });
    await check("Process feed", async () => {
      const list = await fetchProcessFeed(processDataMode, syntheticAgentCount);
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error("No process data returned");
      }
    });
    await check("Audit stats", async () => {
      await getAuditStats(Date.now() - 86_400_000);
    });
    await check("Rule conflict detector", async () => {
      await detectRuleConflicts();
    });
    await check("Sample event path", async () => {
      await submitSampleEvent("safe_read");
    });
    await check("Approval interception loop", async () => {
      await submitSampleEvent("review_upload");
      const nextSnapshot = await loadDashboard(20);
      const pending = nextSnapshot.pending_approvals[0];
      if (!pending) {
        throw new Error("No pending approval generated by review_upload");
      }
      await resolveApprovalRequest(pending.id, "allow", "Self-test approval loop");
    });

    const allPassed = checks.every((item) => item.status === "pass");
    setSelfTestReport({
      checkedAt: Date.now(),
      allPassed,
      checks,
    });
    setSelfTestRunning(false);
  }

  useEffect(() => {
    if (!autoStartStack || autoStartAttempted || loading || startingStack || !runtimeEnvironment) {
      return;
    }

    const stackReady = Boolean(runtimeEnvironment.daemon_source) && Boolean(runtimeEnvironment.proxy_source);
    if (stackReady) {
      return;
    }

    setAutoStartAttempted(true);
    void handleStartLocalStack();
  }, [autoStartAttempted, autoStartStack, loading, runtimeEnvironment, startingStack]);

  async function handleResolveApproval(action: Exclude<EnforcementAction, "ask">) {
    const activeApproval = getActiveApproval(pendingApprovals, activeApprovalId);
    if (!activeApproval) {
      return;
    }

    setResolvingAction(action);
    try {
      const note = resolutionNote.trim() || null;
      const resolved = await resolveApprovalRequest(
        activeApproval.id,
        action,
        note,
      );
      setLastRecord(resolved.audit_record);
      let nextError: string | null = null;

      if (rememberDecision) {
        const rememberedRule = buildRememberedRule(resolved, action, note);
        if (rememberedRule) {
          try {
            await savePolicyRule(rememberedRule);
          } catch (ruleError) {
            nextError = `Decision saved, but remembering the rule failed: ${getErrorMessage(ruleError)}`;
          }
        }
      }

      await refreshDashboard(false);
      setError(nextError);
    } catch (resolveError) {
      setError(getErrorMessage(resolveError));
    } finally {
      setResolvingAction(null);
    }
  }

  async function handleQuickResolveApproval(approvalId: number, action: "allow" | "block") {
    try {
      await resolveApprovalRequest(approvalId, action, "Quick resolve from control room");
      // Immediate refresh for snappy feedback
      await refreshDashboard(false);
    } catch (resolveError) {
      setError(getErrorMessage(resolveError));
    }
  }

  async function handleDismissApproval() {
    const activeApproval = getActiveApproval(pendingApprovals, activeApprovalId);
    if (!activeApproval) {
      return;
    }

    // Dismiss by denying without killing - just close the modal
    setResolvingAction("block");
    try {
      await resolveApprovalRequest(
        activeApproval.id,
        "block",
        "Dismissed by user",
      );
      // Immediate refresh to reflect dismissal
      await refreshDashboard(false);
    } catch (dismissError) {
      setError(getErrorMessage(dismissError));
    } finally {
      setResolvingAction(null);
    }
  }

  function handleCloseApprovalModal() {
    // Clear the active approval ID without resolving the approval
    // This allows the user to dismiss the modal temporarily without making a decision
    // The approval will remain in the pending queue for later review
    if (activeApprovalId !== null) {
      setUserDismissedApproval(activeApprovalId);
    }
    setActiveApprovalId(null);
  }

  async function handleStartLocalStack(
    options: { silent?: boolean; retries?: number } = {},
  ): Promise<RuntimeStartResult | null> {
    const { silent = false, retries = 2 } = options;

    setStartingStack(true);
    try {
      const result = await retryWithBackoff(
        () => startLocalStack(),
        retries,
        700,
      );
      setStackResult(result);
      if (!silent) {
        setError(null);
      }
      await refreshDashboard(false);
      return result;
    } catch (stackError) {
      if (!silent) {
        setError(classifyRuntimeError(getErrorMessage(stackError), "stack"));
      }
      return null;
    } finally {
      setStartingStack(false);
    }
  }

  async function handleProtectionQuickFix() {
    const result = await handleStartLocalStack();
    if (result) {
      setLastProtectionFix({
        status: "success",
        message: result.message,
        at: Date.now(),
      });
      return;
    }

    setLastProtectionFix({
      status: "error",
      message: t.dashboard.fixFailed,
      at: Date.now(),
    });
  }

  function dismissProtectionAlert(id: string) {
    setAlertCooldownUntil((prev) => ({
      ...prev,
      [id]: Date.now() + ALERT_COOLDOWN_MS,
    }));
  }

  function dismissProtectionAlertsBySeverity(severity: "critical" | "warning") {
    const now = Date.now();
    setAlertCooldownUntil((prev) => {
      const next = { ...prev };
      for (const alert of protectionAlerts) {
        if (alert.severity === severity) {
          next[alert.id] = now + ALERT_COOLDOWN_MS;
        }
      }
      return next;
    });
  }

  async function handleRunRealDemo() {
    setRunningDemo(true);
    try {
      const runtimeReady = Boolean(runtimeEnvironment?.daemon_source) && Boolean(runtimeEnvironment?.proxy_source);
      if (!runtimeReady) {
        const stackResult = await handleStartLocalStack({ silent: true, retries: 2 });
        if (!stackResult) {
          throw new Error("failed to start local stack before running demo");
        }
      }

      const result = await retryWithBackoff(
        () => runRealAgentDemo("python_sdk"),
        2,
        900,
      );

      setDemoResult(result);
      setError(null);
      await refreshDashboard(false);
    } catch (demoError) {
      setError(classifyRuntimeError(getErrorMessage(demoError), "demo"));
    } finally {
      setRunningDemo(false);
    }
  }

  async function handleSaveRuleEdit() {
    if (!ruleDraft) {
      return;
    }

    setSavingRule(true);
    try {
      await savePolicyRule(policyRuleFromDraft(ruleDraft));
      setEditingRuleId(null);
      setRuleDraft(null);
      setShowRuleEditorModal(false);
      setError(null);
      await refreshDashboard(false);
    } catch (ruleError) {
      setError(getErrorMessage(ruleError));
    } finally {
      setSavingRule(false);
    }
  }

  async function handleToggleRule(ruleId: string, enabled: boolean) {
    setTogglingRuleId(ruleId);
    try {
      await setPolicyRuleEnabled(ruleId, enabled);
      setError(null);
      await refreshDashboard(false);
    } catch (ruleError) {
      setError(getErrorMessage(ruleError));
    } finally {
      setTogglingRuleId(null);
    }
  }

  async function handleDeleteRule(ruleId: string) {
    setDeletingRuleId(ruleId);
    try {
      await deletePolicyRule(ruleId);
      if (editingRuleId === ruleId) {
        setEditingRuleId(null);
        setRuleDraft(null);
      }
      setError(null);
      await refreshDashboard(false);
    } catch (ruleError) {
      setError(getErrorMessage(ruleError));
    } finally {
      setDeletingRuleId(null);
    }
  }

  async function handleExportRules() {
    setExportingRules(true);
    try {
      const exportData = await exportRules();
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `agentguard-rules-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setError(null);
    } catch (exportError) {
      setError(getErrorMessage(exportError));
    } finally {
      setExportingRules(false);
    }
  }

  async function handleImportRules(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setImportingRules(true);
    try {
      const text = await file.text();
      const exportData = JSON.parse(text) as RuleExport;
      if (!exportData.version || !Array.isArray(exportData.rules)) {
        throw new Error("Invalid rule export file format");
      }
      await importRules(exportData);
      setError(null);
      await refreshDashboard(false);
    } catch (importError) {
      setError(getErrorMessage(importError));
    } finally {
      setImportingRules(false);
      event.target.value = "";
    }
  }

  function handleAddNewRule() {
    setRuleDraft({
      id: "new",
      action: "allow",
      priority: 100,
      layer: null,
      operation: null,
      minimum_risk: null,
      agent_value: "*",
      target_value: "*",
      reason: "",
    });
    setEditingRuleId(null);
    setShowAddRuleModal(true);
  }

  function handleEditRule(rule: ManagedRule) {
    setEditingRuleId(rule.id);
    setRuleDraft(ruleDraftFromManagedRule(rule));
    setShowRuleEditorModal(true);
  }

  /**
   * Rule templates - pre-configured rule patterns for common security policies
   * Each template provides a starting point for creating rules without writing from scratch
   * Users can select a template and customize the details in the rule editor
   */
  const ruleTemplates: Array<{
    id: string;
    name: string;
    description: string;
    template: Omit<RuleDraft, "id" | "reason">;
  }> = [
    {
      id: "block-shell-escape",
      name: "Block shell escape",
      description: "Block any attempt to escape to shell via bash, sh, zsh, etc.",
      template: {
        action: "block",
        priority: 900,
        layer: "command",
        operation: "exec_command",
        minimum_risk: "low",
        agent_value: "*",
        target_value: "*",
      },
    },
    {
      id: "block-network-tools",
      name: "Block network tools",
      description: "Block curl, wget, and other network utilities",
      template: {
        action: "block",
        priority: 850,
        layer: "command",
        operation: "exec_command",
        minimum_risk: "medium",
        agent_value: "*",
        target_value: "curl|wget|nc|netcat",
      },
    },
    {
      id: "block-file-deletion",
      name: "Block file deletion",
      description: "Block rm -rf and dangerous file operations",
      template: {
        action: "block",
        priority: 950,
        layer: "command",
        operation: "exec_command",
        minimum_risk: "high",
        agent_value: "*",
        target_value: "rm\\s+(-[rf]+\\s+)?(/|~|$)",
      },
    },
    {
      id: "warn-on-env-access",
      name: "Warn on environment access",
      description: "Warn when agent tries to read environment variables",
      template: {
        action: "block",
        priority: 500,
        layer: "tool",
        operation: "exec_command",
        minimum_risk: "low",
        agent_value: "*",
        target_value: "*",
      },
    },
    {
      id: "allow-safe-reads",
      name: "Allow safe file reads",
      description: "Allow reading files in project directory",
      template: {
        action: "allow",
        priority: 200,
        layer: "tool",
        operation: "read_file",
        minimum_risk: null,
        agent_value: "*",
        target_value: "^(?!/|~|/etc|/var).*$",
      },
    },
  ];

  /**
   * Handle creating a new rule from a selected template
   * Opens the rule editor with pre-filled values from the template
   */
  function handleCreateFromTemplate(templateId: string) {
    const template = ruleTemplates.find((t) => t.id === templateId);
    if (!template) return;
    
    setRuleDraft({
      id: "new",
      action: template.template.action === "block" ? "block" : "allow",
      priority: template.template.priority,
      layer: template.template.layer,
      operation: template.template.operation,
      minimum_risk: template.template.minimum_risk,
      agent_value: template.template.agent_value,
      target_value: template.template.target_value,
      reason: `Created from template: ${template.name}`,
    });
    setEditingRuleId(null);
    setSelectedTemplateId(null);
    setShowTemplateModal(false);
    setShowAddRuleModal(true);
  }

  const filteredAuditRecords = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.records;
  }, [snapshot]);

  const riskCards = useMemo(() => {
    const counts = snapshot?.counts ?? EMPTY_COUNTS;
    return [
      { label: "Critical", value: counts.critical, tone: "critical" },
      { label: "High", value: counts.high, tone: "high" },
      { label: "Medium", value: counts.medium, tone: "medium" },
      { label: "Low", value: counts.low, tone: "low" },
    ] as const;
  }, [snapshot]);

  const actionCards = useMemo(() => {
    const counts = snapshot?.counts ?? EMPTY_COUNTS;
    return [
      { label: "Allowed", value: counts.allow },
      { label: "Warned", value: counts.warn },
      { label: "Pending approvals", value: pendingApprovals.length },
      { label: "Blocked", value: counts.block + counts.kill },
    ] as const;
  }, [pendingApprovals.length, snapshot]);

  const selectedScenarioMeta = SAMPLE_SCENARIOS.find(
    (scenario) => scenario.kind === selectedScenario,
  );
  const activeApproval = getActiveApproval(pendingApprovals, activeApprovalId);
  const rememberedRules = snapshot?.remembered_rules ?? [];
  const rememberableDecision = activeApproval
    ? buildRememberedRule(activeApproval, "allow", resolutionNote.trim() || null) !== null
    : false;
  const editingRule = rememberedRules.find((rule) => rule.id === editingRuleId) ?? null;
  const runtimeIssues = runtimeEnvironment?.issues ?? [];
  const likelyAgentProcesses = useMemo(
    () => processes.filter((process) => process.isAgentLike),
    [processes],
  );

  useEffect(() => {
    const now = Date.now();
    const nextMap: Record<number, RuntimeProcessInfo["coverageStatus"]> = {};
    const nextOngoing = { ...ongoingRegressionRef.current };
    const recovered: CoverageRecoveryEvent[] = [];

    for (const process of likelyAgentProcesses) {
      const previous = previousCoverageRef.current[process.pid];
      const isProtected = process.coverageStatus === "protected";

      if (previous === "protected" && !isProtected) {
        const cooldownUntil = regressionCooldownUntilRef.current[process.pid] ?? 0;
        if (cooldownUntil <= now) {
          nextOngoing[process.pid] = {
            startedAt: now,
            process,
          };
        }
      }

      if (isProtected && nextOngoing[process.pid]) {
        const startedAt = nextOngoing[process.pid].startedAt;
        recovered.push({
          process,
          recoveredAt: now,
          downtimeMs: Math.max(0, now - startedAt),
        });
        regressionCooldownUntilRef.current[process.pid] = now + COVERAGE_REGRESSION_COOLDOWN_MS;
        delete nextOngoing[process.pid];
      }

      if (!isProtected && nextOngoing[process.pid]) {
        nextOngoing[process.pid] = {
          ...nextOngoing[process.pid],
          process,
        };
      }

      nextMap[process.pid] = process.coverageStatus;
    }

    for (const pidText of Object.keys(nextOngoing)) {
      const pid = Number(pidText);
      const stillPresent = likelyAgentProcesses.some((process) => process.pid === pid);
      if (!stillPresent) {
        delete nextOngoing[pid];
      }
    }

    previousCoverageRef.current = nextMap;
    ongoingRegressionRef.current = nextOngoing;
    setCoverageRegressions(
      Object.values(nextOngoing)
        .filter((item) => now - item.startedAt >= COVERAGE_REGRESSION_MIN_MS)
        .map((item) => {
          const severity: CoverageRegressionAlert["severity"] =
            item.process.risk === "high" || item.process.coverageConfidence === "high"
              ? "critical"
              : "warning";

          return {
            process: item.process,
            startedAt: item.startedAt,
            durationMs: Math.max(0, now - item.startedAt),
            severity,
          };
        })
        .sort((a, b) => b.durationMs - a.durationMs),
    );
    if (recovered.length > 0) {
      setRecentRecoveries((prev) =>
        [...recovered, ...prev]
          .sort((a, b) => b.recoveredAt - a.recoveredAt)
          .slice(0, 12),
      );
    }
  }, [likelyAgentProcesses]);

  const coverageSummary = useMemo(() => {
    const total = likelyAgentProcesses.length;
    const protectedCount = likelyAgentProcesses.filter((process) => process.coverageStatus === "protected").length;
    const likelyUnprotectedCount = likelyAgentProcesses.filter((process) => process.coverageStatus === "likely_unprotected").length;
    const unknownCount = likelyAgentProcesses.filter((process) => process.coverageStatus === "unknown").length;
    const highRiskUnprotected = likelyAgentProcesses.filter(
      (process) => process.risk === "high" && process.coverageStatus !== "protected",
    ).length;

    return {
      total,
      protectedCount,
      likelyUnprotectedCount,
      unknownCount,
      highRiskUnprotected,
    };
  }, [likelyAgentProcesses]);

  const protectionAlerts = useMemo<ProtectionAlert[]>(() => {
    if (likelyAgentProcesses.length === 0) {
      return [];
    }

    const rawAlerts: Omit<ProtectionAlert, "id">[] = [];
    const proxyRunning = Boolean(runtimeEnvironment?.proxy_source);
    const enrichedAgentProcesses = likelyAgentProcesses
      .map((process) => ({ ...process, risk: process.risk }))
      .sort((left, right) => {
        const byRisk = riskWeight(right.risk) - riskWeight(left.risk);
        if (byRisk !== 0) return byRisk;
        if (right.events !== left.events) return right.events - left.events;
        return right.cpu - left.cpu;
      });

    if (!proxyRunning) {
      rawAlerts.push({
        severity: "critical",
        message: t.dashboard.proxyDownWithAgents,
        processes: enrichedAgentProcesses.slice(0, 8),
      });
      return rawAlerts.map((alert) => ({
        ...alert,
        id: buildProtectionAlertId(alert),
      }));
    }

    const unprotected = enrichedAgentProcesses.filter(
      (process) =>
        process.coverageStatus === "likely_unprotected" &&
        (process.coverageConfidence === "high" || process.risk !== "low"),
    );
    if (unprotected.length > 0) {
      rawAlerts.push({
        severity: "warning",
        message: t.dashboard.unprotectedAgentSessions,
        processes: unprotected.slice(0, 8),
      });
    }

    return rawAlerts
      .map((alert) => ({
        ...alert,
        id: buildProtectionAlertId(alert),
      }))
      .filter((alert, index, arr) => arr.findIndex((x) => x.id === alert.id) === index)
      .filter((alert) => {
        const cooldownUntil = alertCooldownUntil[alert.id] ?? 0;
        return cooldownUntil <= Date.now();
      });
  }, [
    alertCooldownUntil,
    likelyAgentProcesses,
    runtimeEnvironment?.proxy_source,
    t.dashboard.proxyDownWithAgents,
    t.dashboard.unprotectedAgentSessions,
  ]);

  function handleAddFromTemplate() {
    setShowTemplateModal(true);
  }

  function triggerImportRules() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const event = e as unknown as React.ChangeEvent<HTMLInputElement>;
      handleImportRules(event);
    };
    input.click();
  }

  return (
    <Layout
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      onRefresh={() => void refreshDashboard(false)}
      onStartStack={() => void handleStartLocalStack()}
      onRunDemo={() => void handleRunRealDemo()}
    >
      {currentPage === 'dashboard' && (
        <Dashboard
          snapshot={snapshot}
          auditStats={auditStats}
          refreshing={refreshing}
          error={error}
          lastRefreshTime={lastRefreshTime}
          selectedScenario={selectedScenario}
          onScenarioChange={setSelectedScenario}
          onScenarioSubmit={handleScenarioSubmit}
          submitting={submitting}
          lastRecord={lastRecord}
          runtimeEnvironment={runtimeEnvironment}
          processes={processes}
          runtimeIssues={runtimeIssues}
          protectionAlerts={protectionAlerts}
          coverageRegressions={coverageRegressions}
          recentRecoveries={recentRecoveries}
          coverageSummary={coverageSummary}
          lastProtectionFix={lastProtectionFix}
          onDismissProtectionAlert={dismissProtectionAlert}
          onDismissProtectionWarnings={() => dismissProtectionAlertsBySeverity("warning")}
          onProtectionQuickFix={() => void handleProtectionQuickFix()}
          onOpenSetup={() => setCurrentPage('setup')}
          onOpenProcesses={() => setCurrentPage('processes')}
          onStartLocalStack={handleStartLocalStack}
          onQuickResolveApproval={(approvalId, action) => void handleQuickResolveApproval(approvalId, action)}
          startingStack={startingStack}
          stackResult={stackResult ? {
            mode: stackResult.daemon_pid ? 'bundled' : 'workspace',
            command: stackResult.message,
            exit_code: stackResult.daemon_pid ? 0 : 1,
            stdout: `Daemon PID: ${stackResult.daemon_pid ?? 'N/A'}`,
            stderr: '',
            message: stackResult.message
          } : null}
          onRunRealDemo={handleRunRealDemo}
          runningDemo={runningDemo}
          demoResult={demoResult}
          onRefresh={() => refreshDashboard(false)}
          riskCards={riskCards.map(card => ({
            label: card.label,
            value: card.value,
            color: card.tone === 'critical' ? '#ef4444' : 
                   card.tone === 'high' ? '#f97316' : 
                   card.tone === 'medium' ? '#eab308' : '#22c55e'
          }))}
          actionCards={actionCards.map(card => ({
            label: card.label,
            value: card.value,
            color: card.label === 'Allowed' ? '#22c55e' :
                   card.label === 'Warned' ? '#eab308' :
                   card.label === 'Blocked' ? '#ef4444' : '#3b82f6'
          }))}
        />
      )}
      
      {currentPage === 'audit' && (
        <AuditPage
          records={auditLoaded ? auditRecords : filteredAuditRecords}
          reviewMap={auditReviewMap}
          loading={auditLoading || loading}
          currentPage={auditPage}
          hasNextPage={auditHasNextPage}
          onPageChange={setAuditPage}
          filters={auditFilters}
          onFiltersChange={handleAuditFiltersChange}
          onUpdateReview={handleAuditReviewUpdate}
          onRefresh={() => void refreshAuditLogs()}
        />
      )}
      
      {currentPage === 'processes' && (
        <ProcessesPage
          loading={processesLoading || loading}
          processes={processes}
          onRefresh={() => void refreshProcesses()}
          onOpenSetup={() => setCurrentPage('setup')}
          processDataMode={processDataMode}
          syntheticAgentCount={syntheticAgentCount}
          onProcessDataModeChange={setProcessDataMode}
          onSyntheticAgentCountChange={setSyntheticAgentCount}
        />
      )}
      
      {currentPage === 'rules' && (
        <RulesPage
          rules={rememberedRules}
          loading={loading}
          conflicts={ruleConflicts}
          onAddRule={handleAddNewRule}
          onAddFromTemplate={handleAddFromTemplate}
          onEditRule={handleEditRule}
          onDeleteRule={handleDeleteRule}
          onToggleRule={handleToggleRule}
          onExportRules={handleExportRules}
          onImportRules={triggerImportRules}
          onCheckConflicts={() => detectRuleConflicts().then(setRuleConflicts).catch(() => {})}
        />
      )}
      
      {currentPage === 'settings' && (
        <SettingsPage
          currentLanguage={language}
          onLanguageChange={setLanguage}
          darkMode={darkMode}
          onDarkModeChange={setDarkMode}
          notificationsEnabled={notificationsEnabled}
          onNotificationsChange={setNotificationsEnabled}
          autoStartStack={autoStartStack}
          onAutoStartStackChange={setAutoStartStack}
          dataRetentionDays={dataRetentionDays}
          onDataRetentionChange={setDataRetentionDays}
          processDataMode={processDataMode}
          syntheticAgentCount={syntheticAgentCount}
          onProcessDataModeChange={setProcessDataMode}
          onSyntheticAgentCountChange={setSyntheticAgentCount}
          selfTestRunning={selfTestRunning}
          selfTestReport={selfTestReport}
          onRunSelfTest={() => void runSelfTestSuite()}
        />
      )}

      {currentPage === 'setup' && (
        <SetupPage
          runtimeEnvironment={runtimeEnvironment}
          onStartLocalStack={handleStartLocalStack}
          startingStack={startingStack}
          stackResult={stackResult}
        />
      )}

      {/* Approval Modal */}
      {activeApproval ? (
        <div className="modal-overlay" onClick={handleCloseApprovalModal}>
          <section className="approval-modal" onClick={(e) => e.stopPropagation()}>
            <header className="approval-modal-header">
              <div>
                <p className="scenario-eyebrow">Approval required</p>
                <h2>Review pending action</h2>
              </div>
              <button
                className="button button-ghost button-icon"
                type="button"
                onClick={handleCloseApprovalModal}
              >
                ✕
              </button>
            </header>

            <div className="approval-modal-badges">
              <span className={`decision-chip ${activeApproval.requested_decision.action}`}>
                {activeApproval.requested_decision.action}
              </span>
              <span className={`risk-chip ${activeApproval.audit_record.decision.risk}`}>
                {activeApproval.audit_record.decision.risk}
              </span>
            </div>

            <p className="approval-modal-copy">{activeApproval.requested_decision.reason}</p>

            <dl className="approval-facts">
              <div>
                <dt>Operation</dt>
                <dd>{activeApproval.audit_record.event.operation}</dd>
              </div>
              <div>
                <dt>Layer</dt>
                <dd>{activeApproval.audit_record.event.layer}</dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd>{formatTarget(activeApproval.audit_record.event.target)}</dd>
              </div>
              {activeApproval.audit_record.event.agent.process_id ? (
                <div>
                  <dt>PID</dt>
                  <dd>{activeApproval.audit_record.event.agent.process_id}</dd>
                </div>
              ) : null}
              {activeApproval.audit_record.event.agent.executable_path ? (
                <div>
                  <dt>Executable</dt>
                  <dd>{activeApproval.audit_record.event.agent.executable_path}</dd>
                </div>
              ) : null}
              {activeApproval.audit_record.event.metadata.cwd ? (
                <div>
                  <dt>Working Dir</dt>
                  <dd>{activeApproval.audit_record.event.metadata.cwd}</dd>
                </div>
              ) : null}
            </dl>

            <div className="approval-metadata">
              {Object.entries(activeApproval.audit_record.event.metadata).map(([key, value]) => (
                <div key={key} className="approval-metadata-row">
                  <span>{key}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>

            <label className="approval-note-field">
              <span>Operator note</span>
              <textarea
                placeholder="Optional context to store with this decision"
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
              />
            </label>

            {rememberableDecision ? (
              <label className="remember-toggle">
                <input
                  type="checkbox"
                  checked={rememberDecision}
                  onChange={(event) => setRememberDecision(event.target.checked)}
                  disabled={resolvingAction !== null}
                />
                <div>
                  <strong>Remember this decision as a local rule</strong>
                  <span>
                    Save a per-agent, per-target rule so the same action does not need manual
                    approval next time.
                  </span>
                </div>
              </label>
            ) : null}

            <div className="approval-actions">
              <button
                className="button button-ghost"
                type="button"
                onClick={() => void handleResolveApproval("block")}
                disabled={resolvingAction !== null}
              >
                {resolvingAction === "block" ? "Denying..." : "Deny request"}
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={() => void handleResolveApproval("allow")}
                disabled={resolvingAction !== null}
              >
                {resolvingAction === "allow" ? "Approving..." : "Approve action"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* Rule Editor Modal */}
      {showRuleEditorModal && ruleDraft ? (
        <div className="modal-overlay" onClick={() => setShowRuleEditorModal(false)}>
          <section className="rule-editor-modal" onClick={(e) => e.stopPropagation()}>
            <header className="rule-editor-header">
              <h2>{editingRuleId ? 'Edit Rule' : 'New Rule'}</h2>
              <button
                className="button button-ghost button-icon"
                onClick={() => setShowRuleEditorModal(false)}
              >
                ✕
              </button>
            </header>
            
            <div className="rule-editor-form">
              <label className="rule-field">
                <span>Reason</span>
                <input
                  type="text"
                  value={ruleDraft.reason}
                  onChange={(e) => setRuleDraft({ ...ruleDraft, reason: e.target.value })}
                  placeholder="Why does this rule exist?"
                />
              </label>

              <div className="rule-field-row">
                <label className="rule-field">
                  <span>Layer</span>
                  <select
                    value={ruleDraft.layer ?? ''}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, layer: e.target.value as any || null })}
                  >
                    <option value="">Any</option>
                    <option value="command">Command</option>
                    <option value="tool">Tool</option>
                    <option value="network">Network</option>
                    <option value="prompt">Prompt</option>
                  </select>
                </label>

                <label className="rule-field">
                  <span>Operation</span>
                  <input
                    type="text"
                    value={ruleDraft.operation ?? ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      const validOperations = ['read_file', 'write_file', 'http_request', 'database_query', 
                                               'browser_open', 'send_email', 'exec_command', 'model_request', 
                                               'model_response'] as const;
                      const operation = value && validOperations.includes(value as any) 
                        ? value as typeof validOperations[number] 
                        : null;
                      setRuleDraft({ ...ruleDraft, operation });
                    }}
                    placeholder="exec_command, read_file, etc."
                  />
                </label>
              </div>

              <div className="rule-field-row">
                <label className="rule-field">
                  <span>Agent Pattern</span>
                  <input
                    type="text"
                    value={ruleDraft.agent_value}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, agent_value: e.target.value })}
                    placeholder="* for any, or exact name"
                  />
                </label>

                <label className="rule-field">
                  <span>Target Pattern</span>
                  <input
                    type="text"
                    value={ruleDraft.target_value}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, target_value: e.target.value })}
                    placeholder="* for any, or path/regex"
                  />
                </label>
              </div>

              <div className="rule-field-row">
                <label className="rule-field">
                  <span>Action</span>
                  <select
                    value={ruleDraft.action}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, action: e.target.value as any })}
                  >
                    <option value="allow">Allow</option>
                    <option value="block">Block</option>
                  </select>
                </label>

                <label className="rule-field">
                  <span>Priority</span>
                  <input
                    type="number"
                    value={ruleDraft.priority}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, priority: Number(e.target.value) })}
                  />
                </label>

                <label className="rule-field">
                  <span>Min Risk</span>
                  <select
                    value={ruleDraft.minimum_risk ?? ''}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, minimum_risk: e.target.value as any || null })}
                  >
                    <option value="">Any</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="rule-editor-actions">
              <button
                className="button button-ghost"
                onClick={() => setShowRuleEditorModal(false)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                onClick={handleSaveRuleEdit}
                disabled={savingRule || !ruleDraft.reason.trim()}
              >
                {savingRule ? 'Saving...' : 'Save Rule'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* Template Selection Modal */}
      {showTemplateModal ? (
        <div className="modal-overlay" onClick={() => setShowTemplateModal(false)}>
          <section className="template-modal" onClick={(e) => e.stopPropagation()}>
            <header className="template-modal-header">
              <h2>Create Rule from Template</h2>
              <button
                className="button button-ghost button-icon"
                onClick={() => setShowTemplateModal(false)}
              >
                ✕
              </button>
            </header>
            
            <div className="template-list">
              {ruleTemplates.map((template: { id: string; name: string; description: string }) => (
                <button
                  key={template.id}
                  className="template-card"
                  onClick={() => handleCreateFromTemplate(template.id)}
                >
                  <h3>{template.name}</h3>
                  <p>{template.description}</p>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </Layout>
  );
}

function getActiveApproval(
  approvals: ApprovalRequest[],
  activeApprovalId: number | null,
): ApprovalRequest | null {
  if (approvals.length === 0) {
    return null;
  }

  // Only return an approval if activeApprovalId is set and matches an approval
  // This allows the user to dismiss the modal without resolving the approval
  if (activeApprovalId === null) {
    return null;
  }

  return approvals.find((approval) => approval.id === activeApprovalId) ?? null;
}

function formatTime(unixMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "numeric",
  }).format(unixMs);
}

function formatTarget(target: AuditRecord["event"]["target"]): string {
  if ("value" in target) {
    return target.value;
  }

  return "none";
}

function buildRememberedRule(
  approval: ApprovalRequest,
  action: Exclude<EnforcementAction, "ask">,
  note: string | null,
): PolicyRule | null {
  if ((action !== "allow" && action !== "block") || approval.audit_record.event.target.kind === "none") {
    return null;
  }

  const targetValue = approval.audit_record.event.target.value;
  if (!targetValue) {
    return null;
  }

  return {
    id: createRememberedRuleId(approval, action),
    priority: 875,
    layer: approval.audit_record.event.layer,
    operation: approval.audit_record.event.operation,
    agent: {
      type: "exact",
      value: approval.audit_record.event.agent.name,
    },
    target: {
      type: "exact",
      value: targetValue,
    },
    minimum_risk: approval.audit_record.decision.risk,
    action,
    reason: note ?? defaultRememberedRuleReason(approval, action),
  };
}

function createRememberedRuleId(
  approval: ApprovalRequest,
  action: "allow" | "block",
): string {
  const fingerprint = [
    approval.audit_record.event.agent.name,
    approval.audit_record.event.layer,
    approval.audit_record.event.operation,
    formatTarget(approval.audit_record.event.target),
    action,
  ].join("|");

  let hash = 0;
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash = (hash * 31 + fingerprint.charCodeAt(index)) >>> 0;
  }

  return `remembered-${action}-${hash.toString(16)}`;
}

function defaultRememberedRuleReason(
  approval: ApprovalRequest,
  action: "allow" | "block",
): string {
  return action === "allow"
    ? `Remembered operator approval for ${approval.audit_record.event.agent.name} on ${formatTarget(approval.audit_record.event.target)}.`
    : `Remembered operator deny rule for ${approval.audit_record.event.agent.name} on ${formatTarget(approval.audit_record.event.target)}.`;
}

function ruleDraftFromManagedRule(rule: ManagedRule): RuleDraft {
  return {
    id: rule.id,
    action: rule.rule.action === "block" ? "block" : "allow",
    priority: rule.rule.priority,
    layer: rule.rule.layer,
    operation: rule.rule.operation,
    minimum_risk: rule.rule.minimum_risk,
    agent_value: getPatternValue(rule.rule.agent),
    target_value: getPatternValue(rule.rule.target),
    reason: rule.rule.reason,
  };
}

function policyRuleFromDraft(draft: RuleDraft): PolicyRule {
  return {
    id: draft.id,
    priority: draft.priority,
    layer: draft.layer,
    operation: draft.operation,
    minimum_risk: draft.minimum_risk,
    action: draft.action,
    reason: draft.reason.trim(),
    agent: draft.agent_value.trim()
      ? { type: "exact", value: draft.agent_value.trim() }
      : { type: "any" },
    target: draft.target_value.trim()
      ? { type: "exact", value: draft.target_value.trim() }
      : { type: "any" },
  };
}

function getPatternValue(pattern: PolicyRule["agent"]): string {
  switch (pattern.type) {
    case "exact":
    case "prefix":
    case "contains":
    case "contains_insensitive":
      return pattern.value;
    case "one_of":
      return pattern.value.join(", ");
    case "any":
    default:
      return "";
  }
}

function formatMatchPattern(pattern: PolicyRule["agent"]): string {
  switch (pattern.type) {
    case "any":
      return "any";
    case "exact":
    case "prefix":
    case "contains":
    case "contains_insensitive":
      return pattern.value;
    case "one_of":
      return pattern.value.join(", ");
    default:
      return "any";
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown desktop error";
}

async function retryWithBackoff<T>(
  task: () => Promise<T>,
  retries: number,
  delayMs: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }
      await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function classifyRuntimeError(message: string, phase: "stack" | "demo"): string {
  const text = message.toLowerCase();

  if (text.includes("timed out") || text.includes("timeout")) {
    return phase === "demo"
      ? "Demo 执行超时：通常是本地栈刚启动未完全就绪。请 3-5 秒后重试，或先点击 Start Stack。"
      : "本地栈启动超时：请检查 8790/8787 端口占用，或停止旧进程后重试。";
  }

  if (text.includes("connection") || text.includes("refused") || text.includes("unreachable")) {
    return phase === "demo"
      ? "Demo 无法连接到本地服务：请确认 Daemon/Proxy 在线后再运行。"
      : "无法连接到本地运行时：请确认网络回环地址可用并重试。";
  }

  if (text.includes("openai") || text.includes("api key") || text.includes("auth")) {
    return "Demo 鉴权配置可能不完整：请在 Setup 中检查代理地址/API Key 配置。";
  }

  return message;
}

function buildProtectionAlertId(alert: {
  severity: "critical" | "warning";
  message: string;
  processes: Array<RuntimeProcessInfo & { risk: "high" | "medium" | "low" }>;
}): string {
  const pids = alert.processes.map((process) => process.pid).sort((a, b) => a - b);
  return `${alert.severity}:${alert.message}:${pids.join(",")}`;
}

function riskWeight(risk: "high" | "medium" | "low"): number {
  return risk === "high" ? 3 : risk === "medium" ? 2 : 1;
}

function smoothRuntimeProcesses(
  nextProcesses: RuntimeProcessInfo[],
  cache: Record<number, number>,
): RuntimeProcessInfo[] {
  const nextCache: Record<number, number> = {};
  const smoothed = nextProcesses.map((process) => {
    const previous = cache[process.pid];
    let network = process.network;

    if (process.networkSource === "nettop_delta" && typeof previous === "number") {
      network = Math.round(previous * 0.65 + process.network * 0.35);
    }

    nextCache[process.pid] = network;
    return {
      ...process,
      network,
    };
  });

  Object.keys(cache).forEach((key) => {
    delete cache[Number(key)];
  });
  Object.assign(cache, nextCache);

  return smoothed;
}

async function fetchProcessFeed(
  mode: ProcessDataMode,
  syntheticAgentCount: number,
): Promise<RuntimeProcessInfo[]> {
  if (mode === "mock") {
    return mockLoadProcesses(120);
  }

  const live = await loadProcesses(120);
  if (mode !== "constructed") {
    return live;
  }

  return [...live, ...buildSyntheticAgents(syntheticAgentCount)];
}

function buildSyntheticAgents(count: number): RuntimeProcessInfo[] {
  const safeCount = Math.max(0, Math.min(24, Math.floor(count)));
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const families: RuntimeProcessInfo["agentFamily"][] = [
    "claude",
    "cursor",
    "aider",
    "copilot",
    "langchain",
    "llamaindex",
    "generic",
  ];

  return Array.from({ length: safeCount }, (_, index) => {
    const family = families[index % families.length];
    const risk: RuntimeProcessInfo["risk"] = index % 5 === 0 ? "high" : index % 2 === 0 ? "medium" : "low";
    const coverageStatus: RuntimeProcessInfo["coverageStatus"] = index % 4 === 0 ? "likely_unprotected" : "protected";
    const events = coverageStatus === "protected" ? 6 + (index % 9) : index % 3;
    return {
      pid: 70000 + index,
      name: `synthetic-${family}-agent-${index + 1}`,
      isAgentLike: true,
      agentFamily: family,
      risk,
      status: "running",
      coverageStatus,
      coverageReason:
        coverageStatus === "protected"
          ? `Synthetic probe confirms protected flow with ${events} event(s).`
          : "Synthetic probe marks this session as likely unprotected.",
      coverageConfidence: coverageStatus === "protected" ? "high" : "medium",
      coverageScore: coverageStatus === "protected" ? 82 - (index % 7) : 34 + (index % 12),
      coverageEvidence: [
        { kind: "agent_signature", label: "Synthetic Agent Signature", value: family, weight: 36 },
        { kind: "runtime_signal", label: "Synthetic Runtime Events", value: String(events), weight: 48 },
      ],
      lastEventAtUnixMs: nowMs - (index + 1) * 10_000,
      cpu: 2 + (index % 7) * 3.1,
      memory: 140 + (index % 8) * 62,
      network: coverageStatus === "protected" ? 3 + (index % 6) : 0,
      networkSource: "nettop_delta",
      events,
      uptime: 900 + (index % 6) * 1400,
      command: `${family} --synthetic --workspace /tmp/agentguard-lab-${index + 1}`,
      user: "synthetic",
      threads: 4 + (index % 4),
      openFiles: 11 + (index % 9),
    };
  });
}
