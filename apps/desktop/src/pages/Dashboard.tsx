import { useState } from 'react';
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
  runtimeIssues: string[];
  protectionAlerts: ProtectionAlert[];
  coverageRegressions: Array<{ process: RuntimeProcessInfo; startedAt: number; durationMs: number }>;
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
  
  const totalEvents = snapshot?.records.length ?? 0;
  const blockedCount = snapshot?.counts.block ?? 0;
  const allowedCount = snapshot?.counts.allow ?? 0;
  const pendingApprovals = snapshot?.pending_approvals.length ?? 0;
  const activeRules = snapshot?.remembered_rules.length ?? 0;

  const handleStartLocalStack = async () => {
    await onStartLocalStack();
  };

  const handleRunRealDemo = async () => {
    await onRunRealDemo('python_sdk');
  };

  const isDaemonRunning = runtimeEnvironment?.daemon_source !== null;
  const isProxyRunning = runtimeEnvironment?.proxy_source !== null;

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
    <div className="dashboard-page">
      <header className="page-header">
        <div className="page-title">
          <h1>{t.dashboard.title}</h1>
          <p>{t.dashboard.subtitle}</p>
        </div>
        <div className="page-actions">
          <button 
            className="btn btn-primary" 
            onClick={handleStartLocalStack}
            disabled={startingStack || isDaemonRunning}
          >
            {startingStack ? t.common.loading : t.dashboard.startStack}
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={handleRunRealDemo}
            disabled={runningDemo || !isDaemonRunning}
          >
            {runningDemo ? t.common.loading : t.dashboard.runDemo}
          </button>
        </div>
      </header>

      {/* 统计卡片 */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">{totalEvents.toLocaleString()}</div>
            <div className="stat-label">{t.dashboard.totalEvents}</div>
          </div>
        </div>

        <div className="stat-card blocked">
          <div className="stat-icon">🚫</div>
          <div className="stat-content">
            <div className="stat-value">{blockedCount.toLocaleString()}</div>
            <div className="stat-label">{t.dashboard.blockedEvents}</div>
          </div>
        </div>

        <div className="stat-card allowed">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{allowedCount.toLocaleString()}</div>
            <div className="stat-label">{t.dashboard.allowedEvents}</div>
          </div>
        </div>

        <div className="stat-card pending">
          <div className="stat-icon">⏳</div>
          <div className="stat-content">
            <div className="stat-value">{pendingApprovals}</div>
            <div className="stat-label">{t.dashboard.pendingApprovals}</div>
          </div>
        </div>

        <div className="stat-card rules">
          <div className="stat-icon">📋</div>
          <div className="stat-content">
            <div className="stat-value">{activeRules}</div>
            <div className="stat-label">{t.dashboard.activeRules}</div>
          </div>
        </div>
      </div>

      {/* 24h 统计面板 */}
      {auditStats && auditStats.total > 0 && (
        <div className="section">
          <h2>过去 24 小时活动概览</h2>
          <div className="stats-grid stats-grid-sm">
            <div className="stat-card">
              <div className="stat-icon">📊</div>
              <div className="stat-content">
                <div className="stat-value">{auditStats.total}</div>
                <div className="stat-label">总事件</div>
              </div>
            </div>
            <div className="stat-card blocked">
              <div className="stat-icon">🚫</div>
              <div className="stat-content">
                <div className="stat-value">{auditStats.by_action['block'] ?? 0}</div>
                <div className="stat-label">已拦截</div>
              </div>
            </div>
            <div className="stat-card pending">
              <div className="stat-icon">⏳</div>
              <div className="stat-content">
                <div className="stat-value">{auditStats.by_action['ask'] ?? 0}</div>
                <div className="stat-label">待审批</div>
              </div>
            </div>
            <div className="stat-card allowed">
              <div className="stat-icon">✅</div>
              <div className="stat-content">
                <div className="stat-value">{auditStats.by_action['allow'] ?? 0}</div>
                <div className="stat-label">已放行</div>
              </div>
            </div>
          </div>
          {auditStats.top_agents.length > 0 && (
            <div className="top-agents-row">
              <span className="top-agents-label">活跃 Agent：</span>
              {auditStats.top_agents.slice(0, 5).map(([name, count]) => (
                <span key={name} className="agent-pill">
                  {name} <span className="agent-pill-count">{count}</span>
                </span>
              ))}
            </div>
          )}
          <div className="risk-breakdown-row">
            {Object.entries(auditStats.by_risk).map(([risk, count]) => (
              <span key={risk} className={`risk-badge risk-${risk}`}>
                {risk}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 运行状态 */}
      <div className="section">
        <h2>{t.dashboard.runtimeStatus}</h2>
        <div className="runtime-status">
          <div className={`status-indicator ${isDaemonRunning ? 'online' : 'offline'}`}>
            <div className="status-dot"></div>
            <div className="status-info">
              <div className="status-label">Daemon</div>
              <div className="status-text">
                {isDaemonRunning ? t.dashboard.daemonRunning : t.dashboard.daemonStopped}
              </div>
            </div>
          </div>

          <div className={`status-indicator ${isProxyRunning ? 'online' : 'offline'}`}>
            <div className="status-dot"></div>
            <div className="status-info">
              <div className="status-label">Proxy</div>
              <div className="status-text">
                {isProxyRunning ? t.dashboard.proxyRunning : t.dashboard.proxyStopped}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Agent 覆盖总览</h2>
        <div className="coverage-summary-grid">
          <div className="coverage-summary-card">
            <span>总 Agent</span>
            <strong>{coverageSummary.total}</strong>
          </div>
          <div className="coverage-summary-card success">
            <span>已保护</span>
            <strong>{coverageSummary.protectedCount}</strong>
          </div>
          <div className="coverage-summary-card warning">
            <span>疑似未保护</span>
            <strong>{coverageSummary.likelyUnprotectedCount}</strong>
          </div>
          <div className="coverage-summary-card muted">
            <span>未知</span>
            <strong>{coverageSummary.unknownCount}</strong>
          </div>
          <div className="coverage-summary-card danger">
            <span>高风险未保护</span>
            <strong>{coverageSummary.highRiskUnprotected}</strong>
          </div>
        </div>
      </div>

      {coverageRegressions.length > 0 && (
        <div className="section">
          <h2>覆盖退化告警</h2>
          <div className="protection-alert-list">
            {coverageRegressions.slice(0, 6).map((item) => (
              <div key={`coverage-regression-${item.process.pid}`} className="protection-alert warning">
                <div className="protection-alert-processes">
                  <span className="protection-process-pill">
                    🔴 {item.process.name} (pid {item.process.pid}) · {item.process.coverageStatus}
                  </span>
                  <span className="protection-process-pill">
                    持续 {formatDuration(item.durationMs)}
                  </span>
                </div>
                <div className="setting-description">{item.process.coverageReason}</div>
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
          <h2>最近恢复确认</h2>
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
        </div>
      )}

      <div className="section">
        <h2>{t.dashboard.protectionAlerts}</h2>
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
                  <button className="btn btn-secondary btn-sm" onClick={onOpenSetup}>
                    {t.dashboard.openSetup}
                  </button>
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

      {/* 最近活动 */}
      <div className="section">
        <h2>{t.dashboard.recentActivity}</h2>
        <div className="activity-list">
          {snapshot?.records && snapshot.records.length > 0 ? (
            snapshot.records.slice(0, 5).map((record, index) => (
              <div key={index} className="activity-item">
                <div className="activity-icon">
                  {record.decision.action === 'block' ? '🚫' : record.decision.action === 'allow' ? '✅' : '⏳'}
                </div>
                <div className="activity-content">
                  <div className="activity-title">{record.event.agent.name}</div>
                  <div className="activity-subtitle">{record.event.operation}</div>
                </div>
                <div className="activity-time">
                  {new Date(record.recorded_at_unix_ms).toLocaleTimeString()}
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">{t.dashboard.noRecentActivity}</div>
          )}
        </div>
      </div>
    </div>
  );
}
