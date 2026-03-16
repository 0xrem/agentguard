import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../i18n';
import type { AuditStats, DashboardSnapshot, RuntimeEnvironment, RuntimeProcessInfo, SampleEventKind, AuditRecord } from '../types';

interface ProtectionAlert {
  id: string;
  severity: 'critical' | 'warning';
  message: string;
  processes: Array<RuntimeProcessInfo & { risk: 'high' | 'medium' | 'low' }>;
}

interface ProtectionFixResult {
  status: 'success' | 'error';
  message: string;
  at: number;
}

interface DashboardProps {
  snapshot: DashboardSnapshot | null;
  auditStats: AuditStats | null;
  refreshing: boolean;
  error: string | null;
  selectedScenario: SampleEventKind;
  onScenarioChange: (scenario: SampleEventKind) => void;
  onScenarioSubmit: () => void;
  submitting: boolean;
  lastRecord: AuditRecord | null;
  runtimeEnvironment: RuntimeEnvironment | null;
  processes: RuntimeProcessInfo[];
  runtimeIssues: string[];
  protectionAlerts: ProtectionAlert[];
  coverageRegressions: Array<{ process: RuntimeProcessInfo; startedAt: number; durationMs: number; severity: 'critical' | 'warning' }>;
  recentRecoveries: Array<{ process: RuntimeProcessInfo; recoveredAt: number; downtimeMs: number }>;
  coverageSummary: {
    total: number;
    protectedCount: number;
    likelyUnprotectedCount: number;
    unknownCount: number;
    highRiskUnprotected: number;
  };
  lastProtectionFix: ProtectionFixResult | null;
  onDismissProtectionAlert: (id: string) => void;
  onDismissProtectionWarnings: () => void;
  onProtectionQuickFix: () => void;
  onOpenSetup: () => void;
  onOpenProcesses: () => void;
  onStartLocalStack: () => void;
  onQuickResolveApproval: (approvalId: number, action: 'allow' | 'block') => void;
  startingStack: boolean;
  stackResult: { mode: string; command: string; exit_code: number | null; stdout: string; stderr: string; message: string } | null;
  onRunRealDemo: (mode: 'python_sdk' | 'openai_proxy') => void;
  runningDemo: boolean;
  demoResult: { mode: string; command: string; exit_code: number | null; stdout: string; stderr: string; message: string } | null;
  onRefresh: () => void;
  riskCards: readonly { label: string; value: number; color: string }[];
  actionCards: readonly { label: string; value: number; color: string }[];
}

export function Dashboard({
  snapshot,
  auditStats,
  refreshing,
  error,
  selectedScenario,
  onScenarioChange,
  onScenarioSubmit,
  submitting,
  lastRecord,
  runtimeEnvironment,
  processes,
  runtimeIssues,
  protectionAlerts,
  coverageRegressions,
  recentRecoveries,
  coverageSummary,
  lastProtectionFix,
  onDismissProtectionAlert,
  onDismissProtectionWarnings,
  onProtectionQuickFix,
  onOpenSetup,
  onOpenProcesses,
  onStartLocalStack,
  onQuickResolveApproval,
  startingStack,
  stackResult,
  onRunRealDemo,
  runningDemo,
  demoResult,
  onRefresh,
  riskCards,
  actionCards,
}: DashboardProps) {
  const { t } = useLanguage();
  const [showRecentActivity, setShowRecentActivity] = useState(false);
  const [showRecoveredSessions, setShowRecoveredSessions] = useState(false);
  
  const totalEvents = snapshot?.records.length ?? 0;
  const pendingApprovals = snapshot?.pending_approvals ?? [];

  const handleStartLocalStack = async () => {
    await onStartLocalStack();
  };

  const handleRunRealDemo = async () => {
    await onRunRealDemo('python_sdk');
  };

  const isDaemonRunning = runtimeEnvironment?.daemon_source !== null;
  const isProxyRunning = runtimeEnvironment?.proxy_source !== null;
  const stackReady = isDaemonRunning && isProxyRunning;
  const hasFixableSignals =
    protectionAlerts.length > 0 ||
    coverageRegressions.length > 0 ||
    coverageSummary.highRiskUnprotected > 0;

  const agents = useMemo(
    () => processes
      .filter((process) => process.isAgentLike)
      .sort((left, right) => {
        const riskWeight = (risk: RuntimeProcessInfo['risk']) => (risk === 'high' ? 3 : risk === 'medium' ? 2 : 1);
        const byRisk = riskWeight(right.risk) - riskWeight(left.risk);
        if (byRisk !== 0) return byRisk;
        if (right.events !== left.events) return right.events - left.events;
        return right.cpu - left.cpu;
      }),
    [processes],
  );

  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);

  useEffect(() => {
    if (agents.length === 0) {
      setSelectedAgentName(null);
      return;
    }
    if (!selectedAgentName || !agents.some((agent) => agent.name === selectedAgentName)) {
      setSelectedAgentName(agents[0].name);
    }
  }, [agents, selectedAgentName]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.name === selectedAgentName) ?? null,
    [agents, selectedAgentName],
  );

  const selectedAgentEvents = useMemo(() => {
    if (!selectedAgentName) return [];
    return (snapshot?.records ?? [])
      .filter((record) => record.event.agent.name === selectedAgentName)
      .slice(0, 20);
  }, [selectedAgentName, snapshot]);

  const selectedAgentAnomalies = useMemo(
    () => selectedAgentEvents.filter((record) => ['ask', 'warn', 'block', 'kill'].includes(record.decision.action)),
    [selectedAgentEvents],
  );

  const formatDuration = (ms: number) => {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ${mins % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  };

  return (
    <div className="dashboard-page dashboard-controlroom">
      <header className="page-header">
        <div className="page-title">
          <h1>Agent Runtime Control Room</h1>
          <p>桌面控制台：实时看到系统 Agent、每一步行为、异常与审批。</p>
        </div>
      </header>

      <section className="mission-control">
        <div className="mission-control-summary">
          <span className={`mission-chip ${isDaemonRunning ? 'ok' : 'bad'}`}>
            Daemon {isDaemonRunning ? 'Ready' : 'Offline'}
          </span>
          <span className={`mission-chip ${isProxyRunning ? 'ok' : 'bad'}`}>
            Proxy {isProxyRunning ? 'Ready' : 'Offline'}
          </span>
          <span className={`mission-chip ${hasFixableSignals ? 'warn' : 'ok'}`}>
            Fix Queue {hasFixableSignals ? 'Pending' : 'Clear'}
          </span>
        </div>
        <div className="mission-control-actions">
          <button
            className="btn btn-primary"
            onClick={handleStartLocalStack}
            disabled={startingStack || stackReady}
          >
            {startingStack ? 'Starting...' : '1. Start'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={onRefresh}
            disabled={refreshing || !stackReady}
          >
            {refreshing ? 'Verifying...' : '2. Verify'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={onProtectionQuickFix}
            disabled={startingStack || !hasFixableSignals}
          >
            {startingStack ? 'Fixing...' : '3. Fix'}
          </button>
        </div>
        <p className="mission-control-tip">
          先 Start 拉起运行时，再 Verify 获取最新状态，出现告警后用 Fix 自动修复。
        </p>

        <div className="mission-control-actions" style={{ marginTop: 10 }}>
          <button
            className="btn btn-secondary"
            onClick={handleRunRealDemo}
            disabled={runningDemo || !stackReady}
          >
            {runningDemo ? 'Testing...' : 'Quick Test'}
          </button>
          <button className="btn btn-text" onClick={onOpenSetup}>Setup</button>
          <button className="btn btn-text" onClick={onOpenProcesses}>Processes</button>
        </div>
      </section>

      {error ? (
        <div className="dashboard-banner error">{error}</div>
      ) : null}

      {runtimeIssues.length > 0 ? (
        <div className="dashboard-banner warn">
          <strong>Runtime Issues:</strong> {runtimeIssues.join(' | ')}
        </div>
      ) : null}

      {stackResult ? (
        <div className="dashboard-banner info">
          <strong>Stack:</strong> {stackResult.message}
        </div>
      ) : null}

      {demoResult ? (
        <div className={`dashboard-banner ${demoResult.exit_code === 0 ? 'ok' : 'warn'}`}>
          <strong>Demo:</strong> {demoResult.message}
        </div>
      ) : null}

      <div className="desktop-metrics-row">
        <div className="desktop-metric-card">
          <span>Running Agents</span>
          <strong>{agents.length}</strong>
        </div>
        <div className="desktop-metric-card">
          <span>Live Events</span>
          <strong>{totalEvents}</strong>
        </div>
        <div className="desktop-metric-card warn">
          <span>Anomalies</span>
          <strong>{selectedAgentAnomalies.length}</strong>
        </div>
        <div className="desktop-metric-card danger">
          <span>Pending Approvals</span>
          <strong>{pendingApprovals.length}</strong>
        </div>
      </div>

      <div className="desktop-main-grid">
        <section className="desktop-panel">
          <div className="section-title-row">
            <h2>System Agents</h2>
            <button className="btn btn-text btn-sm" onClick={onOpenProcesses}>Full Process View</button>
          </div>
          {agents.length === 0 ? (
            <div className="empty-state">当前没有检测到 Agent 进程。先点击 Start 或去 Setup 接入。</div>
          ) : (
            <div className="agent-list">
              {agents.map((agent) => (
                <button
                  key={`${agent.pid}-${agent.name}`}
                  className={`agent-list-item ${selectedAgentName === agent.name ? 'active' : ''}`}
                  onClick={() => setSelectedAgentName(agent.name)}
                >
                  <div className="agent-list-main">
                    <strong>{agent.name}</strong>
                    <span>PID {agent.pid} · {agent.agentFamily}</span>
                  </div>
                  <div className="agent-list-meta">
                    <span className={`risk-chip ${agent.risk}`}>{agent.risk.toUpperCase()}</span>
                    <span>{agent.coverageStatus}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="desktop-panel">
          <div className="section-title-row">
            <h2>Live Step Timeline</h2>
            {selectedAgent ? <span className="agent-selected">{selectedAgent.name}</span> : null}
          </div>
          {!selectedAgent ? (
            <div className="empty-state">请先选择一个 Agent。</div>
          ) : selectedAgentEvents.length === 0 ? (
            <div className="empty-state">该 Agent 暂无行为记录。先触发一次操作再观察。</div>
          ) : (
            <div className="timeline-feed">
              {selectedAgentEvents.map((record) => (
                <div key={record.id} className="timeline-event">
                  <div className="timeline-head">
                    <span className={`action-badge ${record.decision.action}`}>{record.decision.action.toUpperCase()}</span>
                    <span className="timeline-time">{new Date(record.recorded_at_unix_ms).toLocaleTimeString()}</span>
                  </div>
                  <div className="timeline-operation">{record.event.operation}</div>
                  <div className="timeline-target">
                    {record.event.target.kind}: {record.event.target.kind === 'none' ? '(none)' : record.event.target.value}
                  </div>
                  <div className="timeline-reason">{record.decision.reason}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {coverageRegressions.length > 0 && (
        <div className="section">
          <h2>覆盖退化告警</h2>
          <div className="protection-alert-list">
            {coverageRegressions.slice(0, 6).map((item) => (
              <div key={`coverage-regression-${item.process.pid}`} className={`protection-alert ${item.severity}`}>
                <div className="protection-alert-processes">
                  <span className="protection-process-pill">
                    🔴 {item.process.name} (pid {item.process.pid}) · {item.process.coverageStatus}
                  </span>
                  <span className="protection-process-pill">
                    持续 {formatDuration(item.durationMs)}
                  </span>
                  <span className="protection-process-pill">
                    置信度 {item.process.coverageConfidence} · 评分 {item.process.coverageScore}
                  </span>
                </div>
                <div className="setting-description">{item.process.coverageReason}</div>
                {item.process.coverageEvidence.length > 0 && (
                  <div className="protection-alert-processes" style={{ marginTop: 8 }}>
                    {item.process.coverageEvidence.slice(0, 3).map((evidence, idx) => (
                      <span key={`${item.process.pid}-evidence-${idx}`} className="protection-process-pill">
                        {evidence.label}: {evidence.value} ({evidence.weight > 0 ? `+${evidence.weight}` : evidence.weight})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="protection-batch-actions">
              <button className="btn btn-secondary btn-sm" onClick={onOpenProcesses}>
                去进程页排查
              </button>
              <button className="btn btn-primary btn-sm" onClick={onOpenSetup}>
                去快速接入
              </button>
            </div>
          </div>
        </div>
      )}

      {recentRecoveries.length > 0 && (
        <div className="section">
          <div className="section-title-row">
            <h2>最近恢复确认</h2>
            <button className="btn btn-text btn-sm" onClick={() => setShowRecoveredSessions((v) => !v)}>
              {showRecoveredSessions ? '收起' : '展开'}
            </button>
          </div>
          {showRecoveredSessions ? (
            <div className="activity-list">
              {recentRecoveries.slice(0, 5).map((item) => (
                <div key={`recovery-${item.process.pid}-${item.recoveredAt}`} className="activity-item">
                  <div className="activity-icon">🟢</div>
                  <div className="activity-content">
                    <div className="activity-title">{item.process.name} 已恢复受保护</div>
                    <div className="activity-subtitle">退化时长 {formatDuration(item.downtimeMs)}</div>
                  </div>
                  <div className="activity-time">{new Date(item.recoveredAt).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">已隐藏恢复详情，点击展开查看。</div>
          )}
        </div>
      )}

      <div className="section">
        <div className="section-title-row">
          <h2>Anomaly Interception & Approval</h2>
          <button className="btn btn-secondary btn-sm" onClick={onOpenSetup}>Approval Setup</button>
        </div>
        {lastProtectionFix ? (
          <div className={`protection-fix-result ${lastProtectionFix.status}`}>
            <strong>{t.dashboard.lastFixStatus}</strong>
            <span>{new Date(lastProtectionFix.at).toLocaleTimeString()} · {lastProtectionFix.message}</span>
          </div>
        ) : null}
        {protectionAlerts.length === 0 ? (
          <div className="protection-ok">✅ {t.dashboard.noProtectionAlerts}</div>
        ) : (
          <div className="protection-alert-list">
            {protectionAlerts.some((alert) => alert.severity === 'warning') ? (
              <div className="protection-batch-actions">
                <button className="btn btn-text btn-sm" onClick={onDismissProtectionWarnings}>
                  {t.dashboard.dismissAllWarningsFor10m}
                </button>
              </div>
            ) : null}

            {pendingApprovals.length > 0 ? (
              <div className="pending-approval-grid">
                {pendingApprovals.slice(0, 4).map((approval) => (
                  <div key={approval.id} className="pending-approval-card">
                    <div className="pending-approval-title">
                      #{approval.id} · {approval.audit_record.event.agent.name}
                    </div>
                    <div className="pending-approval-detail">
                      {approval.audit_record.event.operation} · {approval.audit_record.event.target.kind === 'none' ? '(none)' : approval.audit_record.event.target.value}
                    </div>
                    <div className="pending-approval-actions">
                      <button className="btn btn-primary btn-sm" onClick={() => onQuickResolveApproval(approval.id, 'allow')}>
                        批准
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => onQuickResolveApproval(approval.id, 'block')}>
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {protectionAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`protection-alert ${alert.severity}`}
              >
                    <div className="protection-alert-processes">
                  {alert.processes.map((process) => (
                    <span key={process.pid} className="protection-process-pill">
                      {process.risk === 'high' ? '🔴' : process.risk === 'medium' ? '🟠' : '🟢'} {process.name} (pid {process.pid})
                    </span>
                  ))}
                </div>
                <div className="protection-alert-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={onProtectionQuickFix}
                    disabled={startingStack}
                  >
                    {startingStack ? t.common.loading : t.dashboard.fixNow}
                  </button>
                  <button
                    className="btn btn-text btn-sm"
                    onClick={() => onDismissProtectionAlert(alert.id)}
                  >
                    {t.dashboard.dismissFor10m}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
