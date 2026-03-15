import { startTransition, useEffect, useMemo, useState } from "react";
import {
  loadDashboard,
  resolveApprovalRequest,
  savePolicyRule,
  submitSampleEvent,
} from "./api";
import type {
  ApprovalRequest,
  AuditRecord,
  DashboardSnapshot,
  EnforcementAction,
  PolicyRule,
  RiskCounts,
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

  useEffect(() => {
    void refreshDashboard(true);

    const timer = window.setInterval(() => {
      void refreshDashboard(false);
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  const pendingApprovals = snapshot?.pending_approvals ?? [];

  useEffect(() => {
    if (pendingApprovals.length === 0) {
      if (activeApprovalId !== null) {
        setActiveApprovalId(null);
      }
      return;
    }

    if (activeApprovalId && pendingApprovals.some((approval) => approval.id === activeApprovalId)) {
      return;
    }

    setActiveApprovalId(pendingApprovals[0].id);
  }, [activeApprovalId, pendingApprovals]);

  useEffect(() => {
    setResolutionNote("");
    setRememberDecision(false);
  }, [activeApprovalId]);

  async function refreshDashboard(initial: boolean) {
    if (initial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const nextSnapshot = await loadDashboard(30);
      setError(null);
      startTransition(() => {
        setSnapshot(nextSnapshot);
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
          </div>
        </section>

        <section className="timeline-layout">
          <div className="card timeline-panel">
            <div className="section-heading">
              <p className="eyebrow">Audit stream</p>
              <h2>Recent runtime decisions</h2>
            </div>
            {loading ? (
              <p className="empty-state">Loading daemon activity...</p>
            ) : snapshot && snapshot.records.length > 0 ? (
              <div className="timeline">
                {snapshot.records.map((record) => (
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
                      </dl>
                    </div>
                  </article>
                ))}
              </div>
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
              {rememberedRules.length > 0 ? (
                <div className="remembered-rule-list">
                  {rememberedRules.map((rule) => (
                    <article key={rule.id} className="remembered-rule-card">
                      <div className="remembered-rule-header">
                        <span className={`decision-chip ${rule.action}`}>{rule.action}</span>
                        <span className="rule-priority">priority {rule.priority}</span>
                      </div>
                      <strong>{rule.reason}</strong>
                      <dl className="remembered-rule-details">
                        <div>
                          <dt>Agent</dt>
                          <dd>{formatMatchPattern(rule.agent)}</dd>
                        </div>
                        <div>
                          <dt>Operation</dt>
                          <dd>{rule.operation ?? "any"}</dd>
                        </div>
                        <div>
                          <dt>Target</dt>
                          <dd>{formatMatchPattern(rule.target)}</dd>
                        </div>
                      </dl>
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

      {activeApproval ? (
        <div className="approval-modal-scrim">
          <section className="approval-modal card" aria-modal="true" role="dialog">
            <div className="approval-modal-header">
              <div>
                <p className="eyebrow">Approval required</p>
                <h2>{activeApproval.audit_record.event.agent.name} needs a decision</h2>
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
                className="button button-danger"
                type="button"
                onClick={() => void handleResolveApproval("kill")}
                disabled={resolvingAction !== null}
              >
                {resolvingAction === "kill" ? "Stopping..." : "Deny and kill"}
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

  return approvals.find((approval) => approval.id === activeApprovalId) ?? approvals[0];
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
