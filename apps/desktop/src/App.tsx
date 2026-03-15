import { startTransition, useEffect, useMemo, useState } from "react";
import { loadDashboard, submitSampleEvent } from "./api";
import type {
  AuditRecord,
  DashboardSnapshot,
  RiskCounts,
  RiskLevel,
  SampleEventKind,
} from "./types";

const SAMPLE_SCENARIOS: Array<{
  kind: SampleEventKind;
  title: string;
  eyebrow: string;
  description: string;
}> = [
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
    description: "Attempts to read `~/.ssh/id_rsa` to confirm sensitive path protection stays locked down.",
  },
  {
    kind: "prompt_injection",
    eyebrow: "Prompt guard",
    title: "Inject a suspicious instruction",
    description: "Submits a prompt with `ignore previous instructions` to demonstrate warning-level prompt review.",
  },
  {
    kind: "safe_read",
    eyebrow: "Happy path",
    title: "Record a normal workspace read",
    description: "Shows what a low-risk event looks like when an assistant touches an approved project file.",
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
  const [selectedScenario, setSelectedScenario] = useState<SampleEventKind>("blocked_command");
  const [submitting, setSubmitting] = useState(false);
  const [lastRecord, setLastRecord] = useState<AuditRecord | null>(null);

  useEffect(() => {
    void refreshDashboard(true);

    const timer = window.setInterval(() => {
      void refreshDashboard(false);
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

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
      { label: "Needs review", value: counts.ask },
      { label: "Blocked", value: counts.block + counts.kill },
    ] as const;
  }, [snapshot]);

  const selectedScenarioMeta = SAMPLE_SCENARIOS.find(
    (scenario) => scenario.kind === selectedScenario,
  );

  return (
    <div className="app-shell">
      <div className="backdrop" />
      <main className="dashboard">
        <section className="hero card glass">
          <div className="hero-copy">
            <p className="eyebrow">AgentGuard Desktop</p>
            <h1>The control room for your local runtime firewall.</h1>
            <p className="hero-text">
              Watch the daemon in real time, inspect risk decisions, and fire known-good
              test scenarios without leaving the desktop app.
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
              <p className="empty-state">Loading daemon activity…</p>
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
              <p className="eyebrow">Operator notes</p>
              <h2>What this build proves</h2>
            </div>
            <ul className="guidance-list">
              <li>The desktop app is reading the daemon through Tauri commands, not browser CORS hacks.</li>
              <li>The dashboard reflects the same SQLite-backed audit log used by the daemon and proxy.</li>
              <li>Sample scenarios let us validate low-risk, warning, and blocked paths from one place.</li>
              <li>The next step is turning `ask` decisions into real interactive approvals instead of passive records.</li>
            </ul>
            <div className="guidance-callout">
              <span>Next milestone</span>
              <strong>Interactive approval loop</strong>
              <p>
                When the daemon returns `ask`, the desktop should own the user decision and feed
                it back into policy enforcement.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown desktop error";
}
