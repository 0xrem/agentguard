import { startTransition, useEffect, useMemo, useState } from "react";
import {
  deletePolicyRule,
  exportRules,
  importRules,
  loadDashboard,
  loadRuntimeEnvironment,
  resolveApprovalRequest,
  runRealAgentDemo,
  savePolicyRule,
  setPolicyRuleEnabled,
  startLocalStack,
  submitSampleEvent,
} from "./api";
import type {
  ApprovalRequest,
  AuditRecord,
  DashboardSnapshot,
  DemoRunResult,
  EnforcementAction,
  Event,
  Layer,
  ManagedRule,
  PolicyRule,
  RiskCounts,
  RiskLevel,
  RuleExport,
  RuleTemplate,
  RuntimeEnvironment,
  RuntimeStartResult,
  SampleEventKind,
} from "./types";

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

const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: "block-destructive-commands",
    name: "阻止破坏性命令",
    description: "阻止 rm、sudo 等危险命令的执行",
    category: "security",
    rule: {
      priority: 100,
      layer: "command",
      operation: "exec_command",
      agent: { type: "any" },
      target: { type: "contains", value: "rm -rf" },
      minimum_risk: null,
      action: "block",
      reason: "阻止破坏性文件删除操作",
    },
  },
  {
    id: "block-ssh-keys",
    name: "保护 SSH 密钥",
    description: "阻止读取 SSH 私钥文件",
    category: "security",
    rule: {
      priority: 90,
      layer: "tool",
      operation: "read_file",
      agent: { type: "any" },
      target: { type: "contains", value: ".ssh/id_rsa" },
      minimum_risk: null,
      action: "block",
      reason: "保护 SSH 私钥不被泄露",
    },
  },
  {
    id: "block-secrets",
    name: "保护敏感凭证",
    description: "阻止访问 .env、密钥等敏感文件",
    category: "privacy",
    rule: {
      priority: 85,
      layer: "tool",
      operation: "read_file",
      agent: { type: "any" },
      target: { type: "one_of", value: [".env", ".gitconfig", ".netrc", "credentials"] },
      minimum_risk: null,
      action: "block",
      reason: "防止敏感凭证泄露",
    },
  },
  {
    id: "ask-external-requests",
    name: "审批外部请求",
    description: "对所有外部 HTTP 请求要求审批",
    category: "security",
    rule: {
      priority: 70,
      layer: "tool",
      operation: "http_request",
      agent: { type: "any" },
      target: { type: "any" },
      minimum_risk: "medium",
      action: "ask",
      reason: "外部网络请求需要用户确认",
    },
  },
  {
    id: "allow-workspace-reads",
    name: "允许工作区读取",
    description: "允许 AI 代理读取当前工作区文件",
    category: "productivity",
    rule: {
      priority: 50,
      layer: "tool",
      operation: "read_file",
      agent: { type: "any" },
      target: { type: "prefix", value: "/Users/" },
      minimum_risk: "low",
      action: "allow",
      reason: "工作区内文件读取是安全的",
    },
  },
  {
    id: "block-database-writes",
    name: "阻止数据库写入",
    description: "阻止未经授权的数据库修改操作",
    category: "compliance",
    rule: {
      priority: 80,
      layer: "tool",
      operation: "database_query",
      agent: { type: "any" },
      target: { type: "any" },
      minimum_risk: "medium",
      action: "ask",
      reason: "数据库写入操作需要审批",
    },
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
  const [auditSearchQuery, setAuditSearchQuery] = useState("");
  const [auditFilterLayer, setAuditFilterLayer] = useState<Layer | "all">("all");
  const [auditFilterAction, setAuditFilterAction] = useState<EnforcementAction | "all">("all");
  const [auditFilterRisk, setAuditFilterRisk] = useState<RiskLevel | "all">("all");

  useEffect(() => {
    void refreshDashboard(true);

    const timer = window.setInterval(() => {
      void refreshDashboard(false);
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

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
      const [nextSnapshot, nextRuntimeEnvironment] = await Promise.all([
        loadDashboard(30),
        loadRuntimeEnvironment(),
      ]);
      setError(null);
      startTransition(() => {
        setSnapshot(nextSnapshot);
        setRuntimeEnvironment(nextRuntimeEnvironment);
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

  async function handleStartLocalStack() {
    setStartingStack(true);
    try {
      const result = await startLocalStack();
      setStackResult(result);
      setError(null);
      await refreshDashboard(false);
    } catch (stackError) {
      setError(getErrorMessage(stackError));
    } finally {
      setStartingStack(false);
    }
  }

  async function handleRunRealDemo() {
    console.log("[handleRunRealDemo] Starting...");
    setRunningDemo(true);
    try {
      console.log("[handleRunRealDemo] Calling runRealAgentDemo...");
      const result = await runRealAgentDemo("python_sdk");
      console.log("[handleRunRealDemo] Result:", result);
      setDemoResult(result);
      setError(null);
      await refreshDashboard(false);
    } catch (demoError) {
      console.error("[handleRunRealDemo] Error:", demoError);
      setError(getErrorMessage(demoError));
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

  async function handleToggleRule(rule: ManagedRule) {
    setTogglingRuleId(rule.id);
    try {
      await setPolicyRuleEnabled(rule.id, !rule.enabled);
      setError(null);
      await refreshDashboard(false);
    } catch (ruleError) {
      setError(getErrorMessage(ruleError));
    } finally {
      setTogglingRuleId(null);
    }
  }

  async function handleDeleteRule(rule: ManagedRule) {
    setDeletingRuleId(rule.id);
    try {
      await deletePolicyRule(rule.id);
      if (editingRuleId === rule.id) {
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
      ...template.template,
      id: "new",
      reason: `Created from template: ${template.name}`,
    });
    setEditingRuleId(null);
    setSelectedTemplateId(null);
    setShowTemplateModal(false);
    setShowAddRuleModal(true);
  }

  const filteredAuditRecords = useMemo(() => {
    if (!snapshot) return [];
    
    return snapshot.records.filter((record) => {
      // Search query filter
      if (auditSearchQuery) {
        const query = auditSearchQuery.toLowerCase();
        const searchText = [
          record.event.agent.name,
          record.event.operation,
          record.event.layer,
          record.decision.reason,
          JSON.stringify(record.event.metadata),
        ]
          .join(" ")
          .toLowerCase();
        
        if (!searchText.includes(query)) {
          return false;
        }
      }
      
      // Layer filter
      if (auditFilterLayer !== "all" && record.event.layer !== auditFilterLayer) {
        return false;
      }
      
      // Action filter
      if (auditFilterAction !== "all" && record.decision.action !== auditFilterAction) {
        return false;
      }
      
      // Risk filter
      if (auditFilterRisk !== "all" && record.decision.risk !== auditFilterRisk) {
        return false;
      }
      
      return true;
    });
  }, [snapshot, auditSearchQuery, auditFilterLayer, auditFilterAction, auditFilterRisk]);

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

  return (
    <div className="app-shell">
      <div className="backdrop" />
      <main className="dashboard">
        <section className="hero card glass">
          <div className="hero-copy">
            <p className="eyebrow">AgentGuard Desktop</p>
            <h1>The control room for your local runtime firewall.</h1>
            <p className="hero-text">
              Watch the daemon in real time, approve high-risk actions from a native modal, and
              inspect every decision the runtime firewall makes.
            </p>
          </div>
          <div className="hero-side">
            <div className={`status-pill ${snapshot?.status.healthy ? "online" : "offline"}`}>
              <span className="status-dot" />
              <span>
                {snapshot?.status.preview_mode
                  ? "Preview mode"
                  : snapshot?.status.healthy
                    ? "Daemon online"
                    : "Daemon offline"}
              </span>
            </div>
            <p className="status-meta">
              {snapshot?.status.message ??
                "Waiting for the first health check from the local daemon."}
            </p>
            <div className="hero-actions">
              <button
                className="button button-primary"
                type="button"
                onClick={() => void refreshDashboard(false)}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing..." : "Refresh dashboard"}
              </button>
              <span className="daemon-url">
                {snapshot?.status.daemon_url ?? "http://127.0.0.1:8790"}
              </span>
            </div>
          </div>
        </section>

        {error ? (
          <section className="banner banner-error">
            <strong>Desktop app could not sync.</strong>
            <span>{error}</span>
          </section>
        ) : null}

        <section className="summary-grid">
          <div className="card stats-panel">
            <div className="section-heading">
              <p className="eyebrow">Risk mix</p>
              <h2>What the daemon has seen recently</h2>
            </div>
            <div className="risk-grid">
              {riskCards.map((card) => (
                <article key={card.label} className={`risk-card ${card.tone}`}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </article>
              ))}
            </div>
            <div className="action-grid">
              {actionCards.map((card) => (
                <article key={card.label} className="action-card">
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </article>
              ))}
            </div>
          </div>

          <div className="card scenario-panel">
            <div className="section-heading">
              <p className="eyebrow">Scenario runner</p>
              <h2>Drive the daemon from the desktop</h2>
            </div>
            <div className="scenario-list">
              {SAMPLE_SCENARIOS.map((scenario) => (
                <button
                  key={scenario.kind}
                  className={`scenario-card ${
                    selectedScenario === scenario.kind ? "selected" : ""
                  }`}
                  type="button"
                  onClick={() => setSelectedScenario(scenario.kind)}
                >
                  <span className="scenario-eyebrow">{scenario.eyebrow}</span>
                  <strong>{scenario.title}</strong>
                  <span>{scenario.description}</span>
                </button>
              ))}
            </div>
            <div className="scenario-footer">
              <div>
                <p className="scenario-selected-label">Selected scenario</p>
                <h3>{selectedScenarioMeta?.title}</h3>
              </div>
              <button
                className="button button-accent"
                type="button"
                onClick={() => void handleScenarioSubmit()}
                disabled={submitting}
              >
                {submitting ? "Sending..." : "Send test event"}
              </button>
            </div>
            {lastRecord ? (
              <div className="last-record">
                <span className={`decision-chip ${lastRecord.decision.action}`}>
                  {lastRecord.decision.action}
                </span>
                <div>
                  <strong>{lastRecord.decision.reason}</strong>
                  <p>{formatTarget(lastRecord.event.target)}</p>
                </div>
              </div>
            ) : null}
            <div className="live-demo-panel">
              <div className="section-heading section-heading-compact">
                <p className="eyebrow">Live integration</p>
                <h2>Start the real runtime path</h2>
              </div>
              <p className="hero-text">
                Bring up the local daemon and proxy from the desktop, then run a real SDK-backed
                demo agent that waits on the same approval loop as external integrations.
              </p>
              {runtimeEnvironment ? (
                <div className="runtime-diagnostics">
                  <div className="remembered-rule-header">
                    <span className="scenario-eyebrow">Runtime environment</span>
                    <span className="rule-priority">{runtimeEnvironment.mode}</span>
                  </div>
                  <strong>{runtimeEnvironment.message}</strong>
                  <div className="runtime-diagnostic-grid">
                    <div>
                      <span className="scenario-eyebrow">Daemon</span>
                      <p>{runtimeEnvironment.daemon_source}</p>
                    </div>
                    <div>
                      <span className="scenario-eyebrow">Proxy</span>
                      <p>{runtimeEnvironment.proxy_source}</p>
                    </div>
                    <div>
                      <span className="scenario-eyebrow">Python</span>
                      <p>{runtimeEnvironment.python_command ?? "missing"}</p>
                    </div>
                    <div>
                      <span className="scenario-eyebrow">Data root</span>
                      <p>{runtimeEnvironment.app_support_root}</p>
                    </div>
                  </div>
                  {runtimeIssues.length > 0 ? (
                    <ul className="runtime-issues">
                      {runtimeIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="runtime-ready">
                      Bundled runtime assets and the live demo path are ready on this machine.
                    </p>
                  )}
                </div>
              ) : null}
              <div className="live-demo-actions">
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={() => void handleStartLocalStack()}
                  disabled={startingStack}
                >
                  {startingStack ? "Starting stack..." : "Start local stack"}
                </button>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => void handleRunRealDemo()}
                  disabled={runningDemo}
                >
                  {runningDemo ? "Running live demo..." : "Run real agent demo"}
                </button>
              </div>
              {stackResult ? (
                <div className="live-demo-status">
                  <strong>{stackResult.message}</strong>
                  <span>
                    Daemon: {stackResult.daemon_url}
                    {stackResult.daemon_pid ? ` (pid ${stackResult.daemon_pid})` : ""}
                  </span>
                  <span>
                    Proxy: {stackResult.proxy_url}
                    {stackResult.proxy_pid ? ` (pid ${stackResult.proxy_pid})` : ""}
                  </span>
                </div>
              ) : null}
              {demoResult ? (
                <div className="demo-result">
                  <div className="remembered-rule-header">
                    <span className="scenario-eyebrow">Last real run</span>
                    <span className="rule-priority">{demoResult.mode}</span>
                  </div>
                  <strong>{demoResult.message}</strong>
                  <p className="daemon-url">{demoResult.command}</p>
                  <div className="demo-result-grid">
                    <div>
                      <span className="scenario-eyebrow">stdout</span>
                      <pre>{demoResult.stdout || "(empty)"}</pre>
                    </div>
                    <div>
                      <span className="scenario-eyebrow">stderr</span>
                      <pre>{demoResult.stderr || "(empty)"}</pre>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="timeline-layout">
          <div className="card timeline-panel">
            <div className="section-heading">
              <p className="eyebrow">Audit stream</p>
              <h2>Recent runtime decisions</h2>
            </div>
            
            <div className="audit-filters">
              <input
                type="text"
                className="audit-search-input"
                placeholder="Search agent, operation, metadata..."
                value={auditSearchQuery}
                onChange={(e) => setAuditSearchQuery(e.target.value)}
              />
              
              <div className="audit-filter-group">
                <select
                  className="audit-filter-select"
                  value={auditFilterLayer}
                  onChange={(e) => setAuditFilterLayer(e.target.value as Layer | "all")}
                >
                  <option value="all">All Layers</option>
                  <option value="tool">Tool</option>
                  <option value="command">Command</option>
                  <option value="model">Model</option>
                  <option value="any">Any</option>
                </select>
                
                <select
                  className="audit-filter-select"
                  value={auditFilterAction}
                  onChange={(e) => setAuditFilterAction(e.target.value as EnforcementAction | "all")}
                >
                  <option value="all">All Actions</option>
                  <option value="allow">Allow</option>
                  <option value="warn">Warn</option>
                  <option value="ask">Ask</option>
                  <option value="block">Block</option>
                  <option value="kill">Kill</option>
                </select>
                
                <select
                  className="audit-filter-select"
                  value={auditFilterRisk}
                  onChange={(e) => setAuditFilterRisk(e.target.value as RiskLevel | "all")}
                >
                  <option value="all">All Risk Levels</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={() => {
                    setAuditSearchQuery("");
                    setAuditFilterLayer("all");
                    setAuditFilterAction("all");
                    setAuditFilterRisk("all");
                  }}
                >
                  Clear filters
                </button>
              </div>
            </div>
            
            {loading ? (
              <p className="empty-state">Loading daemon activity...</p>
            ) : filteredAuditRecords.length > 0 ? (
              <div className="timeline">
                {snapshot?.records.map((record) => (
                  <article key={record.id} className="timeline-row">
                    <div className="timeline-pin" />
                    <div className="timeline-content">
                      <div className="timeline-meta">
                        <span className={`decision-chip ${record.decision.action}`}>
                          {record.decision.action}
                        </span>
                        <span className={`risk-chip ${record.decision.risk}`}>
                          {record.decision.risk}
                        </span>
                        <span>{formatTime(record.recorded_at_unix_ms)}</span>
                      </div>
                      <h3>{record.event.agent.name}</h3>
                      <p>{record.decision.reason}</p>
                      <dl className="timeline-details">
                        <div>
                          <dt>Layer</dt>
                          <dd>{record.event.layer}</dd>
                        </div>
                        <div>
                          <dt>Operation</dt>
                          <dd>{record.event.operation}</dd>
                        </div>
                        <div>
                          <dt>Target</dt>
                          <dd>{formatTarget(record.event.target)}</dd>
                        </div>
                        {record.event.agent.process_id ? (
                          <div>
                            <dt>PID</dt>
                            <dd>{record.event.agent.process_id}</dd>
                          </div>
                        ) : null}
                        {record.event.agent.executable_path ? (
                          <div>
                            <dt>Executable</dt>
                            <dd>{record.event.agent.executable_path}</dd>
                          </div>
                        ) : null}
                        {record.event.metadata.cwd ? (
                          <div>
                            <dt>Working Dir</dt>
                            <dd>{record.event.metadata.cwd}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  </article>
                ))}
              </div>
            ) : snapshot && snapshot.records.length > 0 ? (
              <p className="empty-state">
                No records match your current filters. Try adjusting the search or filters.
              </p>
            ) : (
              <p className="empty-state">
                No audit records yet. Run the daemon and fire a scenario to populate the timeline.
              </p>
            )}
          </div>

          <div className="card guidance-panel">
            <div className="section-heading">
              <p className="eyebrow">Approval queue</p>
              <h2>The desktop now owns `ask` decisions</h2>
            </div>
            {pendingApprovals.length > 0 ? (
              <div className="approval-list">
                {pendingApprovals.map((approval) => (
                  <button
                    key={approval.id}
                    className={`approval-card ${
                      activeApproval?.id === approval.id ? "selected" : ""
                    }`}
                    type="button"
                    onClick={() => setActiveApprovalId(approval.id)}
                  >
                    <div className="approval-card-header">
                      <span className="scenario-eyebrow">Pending review</span>
                      <span className={`risk-chip ${approval.audit_record.decision.risk}`}>
                        {approval.audit_record.decision.risk}
                      </span>
                    </div>
                    <strong>{approval.audit_record.event.agent.name}</strong>
                    <span>{approval.requested_decision.reason}</span>
                    <span>{formatTarget(approval.audit_record.event.target)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-state">
                No pending approvals right now. Run the review scenario to trigger the desktop
                approval modal.
              </p>
            )}
            <ul className="guidance-list">
              <li>High-risk uploads now create a queued approval request instead of becoming passive audit noise.</li>
              <li>Approving or denying from the desktop updates the same SQLite-backed audit record the daemon serves.</li>
              <li>Node and proxy clients can now wait on this approval loop instead of treating `ask` as a hard stop.</li>
            </ul>
            <div className="guidance-callout">
              <span>Current objective</span>
              <strong>Teach the firewall as you go</strong>
              <p>
                We now use operator decisions to build local rules, so repeated safe actions can
                stop coming back for the same review.
              </p>
            </div>
            <div className="remembered-rules-section">
              <div className="section-heading section-heading-compact">
                <p className="eyebrow">Remembered rules</p>
                <h2>What the daemon has learned locally</h2>
              </div>
              <div className="rule-list-toolbar">
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={() => setShowTemplateModal(true)}
                  title="Create rule from template"
                >
                  📋 From template
                </button>
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={handleAddNewRule}
                  title="Add a new rule"
                >
                  + Add rule
                </button>
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={handleExportRules}
                  disabled={exportingRules}
                  title="Export rules to JSON file"
                >
                  {exportingRules ? "Exporting..." : "Export"}
                </button>
                <label className="button button-ghost" style={{ cursor: "pointer" }}>
                  {importingRules ? "Importing..." : "Import"}
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleImportRules}
                    disabled={importingRules}
                    style={{ display: "none" }}
                  />
                </label>
              </div>
              {rememberedRules.length > 0 ? (
                <div className="remembered-rule-list">
                  {rememberedRules.map((rule) => (
                    <article
                      key={rule.id}
                      className={`remembered-rule-card ${rule.enabled ? "" : "disabled"}`}
                    >
                      <div className="remembered-rule-header">
                        <span className={`decision-chip ${rule.rule.action}`}>
                          {rule.rule.action}
                        </span>
                        <span className="rule-priority">
                          {rule.enabled ? "enabled" : "disabled"} · priority {rule.rule.priority}
                        </span>
                      </div>
                      <strong>{rule.rule.reason}</strong>
                      <dl className="remembered-rule-details">
                        <div>
                          <dt>Agent</dt>
                          <dd>{formatMatchPattern(rule.rule.agent)}</dd>
                        </div>
                        <div>
                          <dt>Operation</dt>
                          <dd>{rule.rule.operation ?? "any"}</dd>
                        </div>
                        <div>
                          <dt>Target</dt>
                          <dd>{formatMatchPattern(rule.rule.target)}</dd>
                        </div>
                      </dl>
                      <div className="rule-actions">
                        <button
                          className="button button-ghost button-inline"
                          type="button"
                          onClick={() => handleEditRule(rule)}
                        >
                          Edit
                        </button>
                        <button
                          className="button button-ghost button-inline"
                          type="button"
                          onClick={() => void handleToggleRule(rule)}
                          disabled={togglingRuleId === rule.id}
                        >
                          {togglingRuleId === rule.id
                            ? "Saving..."
                            : rule.enabled
                              ? "Disable"
                              : "Enable"}
                        </button>
                        <button
                          className="button button-danger button-inline"
                          type="button"
                          onClick={() => void handleDeleteRule(rule)}
                          disabled={deletingRuleId === rule.id}
                        >
                          {deletingRuleId === rule.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state">
                  No remembered rules yet. Approve or deny a repeated action and opt in to save it
                  as a local rule.
                </p>
              )}
            </div>
          </div>
        </section>
      </main>

      {showTemplateModal ? (
        <div className="approval-modal-scrim" onClick={() => setShowTemplateModal(false)}>
          <section 
            className="approval-modal card" 
            aria-modal="true" 
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="approval-modal-header">
              <div className="approval-modal-title-group">
                <p className="eyebrow">Create from template</p>
                <h2>Choose a rule template</h2>
              </div>
              <div className="approval-modal-header-actions">
                <button
                  className="button button-ghost button-icon"
                  type="button"
                  onClick={() => setShowTemplateModal(false)}
                  title="Close"
                  aria-label="Close template selector"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="template-grid" style={{ display: 'grid', gap: '12px', padding: '20px 0' }}>
              {ruleTemplates.map((template) => (
                <div
                  key={template.id}
                  className="template-card"
                  style={{
                    padding: '16px',
                    border: '1px solid rgba(24, 35, 50, 0.08)',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.72)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => handleCreateFromTemplate(template.id)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(24, 35, 50, 0.12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = '';
                    e.currentTarget.style.boxShadow = '';
                  }}
                >
                  <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>{template.name}</h3>
                  <p style={{ margin: 0, color: '#677486', fontSize: '0.9rem' }}>{template.description}</p>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                    <span className={`decision-chip ${template.template.action}`} style={{ fontSize: '0.76rem', padding: '4px 8px' }}>
                      {template.template.action}
                    </span>
                    <span style={{ fontSize: '0.76rem', color: '#677486' }}>
                      Priority: {template.template.priority}
                    </span>
                    <span style={{ fontSize: '0.76rem', color: '#677486' }}>
                      Layer: {template.template.layer}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="approval-actions">
              <button
                className="button button-ghost"
                type="button"
                onClick={() => setShowTemplateModal(false)}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showRuleEditorModal && ruleDraft ? (
        <div className="approval-modal-scrim" onClick={() => setShowRuleEditorModal(false)}>
          <section 
            className="approval-modal card" 
            aria-modal="true" 
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="approval-modal-header">
              <div className="approval-modal-title-group">
                <p className="eyebrow">Editing rule</p>
                <h2>Edit rule {editingRuleId}</h2>
              </div>
              <div className="approval-modal-header-actions">
                <button
                  className="button button-ghost button-icon"
                  type="button"
                  onClick={() => setShowRuleEditorModal(false)}
                  title="Close"
                  aria-label="Close rule editor"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="rule-editor-grid">
              <label className="rule-editor-field">
                <span>Reason</span>
                <textarea
                  value={ruleDraft.reason}
                  onChange={(event) =>
                    setRuleDraft({ ...ruleDraft, reason: event.target.value })
                  }
                />
              </label>
              <label className="rule-editor-field">
                <span>Action</span>
                <select
                  value={ruleDraft.action}
                  onChange={(event) =>
                    setRuleDraft({
                      ...ruleDraft,
                      action: event.target.value as RuleDraft["action"],
                    })
                  }
                >
                  <option value="allow">allow</option>
                  <option value="block">block</option>
                </select>
              </label>
              <label className="rule-editor-field">
                <span>Priority</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={ruleDraft.priority}
                  onChange={(event) =>
                    setRuleDraft({
                      ...ruleDraft,
                      priority: Number(event.target.value) || 100,
                    })
                  }
                />
              </label>
              <label className="rule-editor-field">
                <span>Minimum Risk</span>
                <select
                  value={ruleDraft.minimum_risk ?? "any"}
                  onChange={(event) =>
                    setRuleDraft({
                      ...ruleDraft,
                      minimum_risk:
                        event.target.value === "any"
                          ? null
                          : (event.target.value as RuleDraft["minimum_risk"]),
                    })
                  }
                >
                  <option value="any">any</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
              </label>
              <label className="rule-editor-field">
                <span>Layer</span>
                <select
                  value={ruleDraft.layer ?? "any"}
                  onChange={(event) =>
                    setRuleDraft({
                      ...ruleDraft,
                      layer:
                        event.target.value === "any"
                          ? null
                          : (event.target.value as RuleDraft["layer"]),
                    })
                  }
                >
                  <option value="any">any</option>
                  <option value="tool">tool</option>
                  <option value="command">command</option>
                  <option value="prompt">prompt</option>
                </select>
              </label>
              <label className="rule-editor-field">
                <span>Operation</span>
                <input
                  value={ruleDraft.operation ?? ""}
                  placeholder="read_file, exec_command, model_response..."
                  onChange={(event) =>
                    setRuleDraft({
                      ...ruleDraft,
                      operation:
                        event.target.value.trim() === ""
                          ? null
                          : (event.target.value as RuleDraft["operation"]),
                    })
                  }
                />
              </label>
              <label className="rule-editor-field">
                <span>Agent Match</span>
                <input
                  value={ruleDraft.agent_value}
                  onChange={(event) =>
                    setRuleDraft({ ...ruleDraft, agent_value: event.target.value })
                  }
                />
              </label>
              <label className="rule-editor-field">
                <span>Target Match</span>
                <input
                  value={ruleDraft.target_value}
                  onChange={(event) =>
                    setRuleDraft({ ...ruleDraft, target_value: event.target.value })
                  }
                />
              </label>
            </div>

            <div className="rule-actions">
              <button
                className="button button-ghost button-inline"
                type="button"
                onClick={() => setShowRuleEditorModal(false)}
              >
                Cancel
              </button>
              <button
                className="button button-primary button-inline"
                type="button"
                onClick={() => void handleSaveRuleEdit()}
                disabled={savingRule}
              >
                {savingRule ? "Saving..." : "Save rule"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {activeApproval ? (
        <div className="approval-modal-scrim" onClick={() => void handleCloseApprovalModal()}>
          <section 
            className="approval-modal card" 
            aria-modal="true" 
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="approval-modal-header">
              <div className="approval-modal-title-group">
                <p className="eyebrow">Approval required</p>
                <h2>{activeApproval.audit_record.event.agent.name} needs a decision</h2>
              </div>
              <div className="approval-modal-header-actions">
                <button
                  className="button button-ghost button-icon"
                  type="button"
                  onClick={() => void handleCloseApprovalModal()}
                  title="Close"
                  aria-label="Close approval dialog"
                >
                  ✕
                </button>
              </div>
              <div className="approval-modal-badges">
                <span className={`decision-chip ${activeApproval.requested_decision.action}`}>
                  {activeApproval.requested_decision.action}
                </span>
                <span className={`risk-chip ${activeApproval.audit_record.decision.risk}`}>
                  {activeApproval.audit_record.decision.risk}
                </span>
              </div>
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
    </div>
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
