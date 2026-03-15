import { useState } from 'react';
import { useLanguage } from '../i18n';
import type { DashboardSnapshot, RuntimeEnvironment, SampleEventKind, AuditRecord, PolicyRule } from '../types';
import { startLocalStack, runRealAgentDemo } from '../api';

interface DashboardProps {
  snapshot: DashboardSnapshot | null;
  refreshing: boolean;
  error: string | null;
  selectedScenario: SampleEventKind;
  onScenarioChange: (scenario: SampleEventKind) => void;
  onScenarioSubmit: () => void;
  submitting: boolean;
  lastRecord: AuditRecord | null;
  runtimeEnvironment: RuntimeEnvironment | null;
  runtimeIssues: string[];
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
  refreshing,
  error,
  selectedScenario,
  onScenarioChange,
  onScenarioSubmit,
  submitting,
  lastRecord,
  runtimeEnvironment,
  runtimeIssues,
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
