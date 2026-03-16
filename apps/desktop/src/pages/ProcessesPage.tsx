import { useMemo, useState } from 'react';
import { useLanguage } from '../i18n';
import type { RuntimeProcessInfo } from '../types';

interface ProcessesPageProps {
  loading: boolean;
  processes: RuntimeProcessInfo[];
  onRefresh: () => void;
  onOpenSetup: () => void;
}

export function ProcessesPage({ loading, processes, onRefresh, onOpenSetup }: ProcessesPageProps) {
  const { t } = useLanguage();
  const [selectedProcess, setSelectedProcess] = useState<RuntimeProcessInfo | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showOnlyAgents, setShowOnlyAgents] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [riskFilter, setRiskFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  const AGENT_PATTERNS = [/claude/i, /cursor/i, /aider/i, /autogpt/i, /copilot/i, /codex/i, /agent/i, /langchain/i, /llamaindex/i];

  const isLikelyAgent = (process: RuntimeProcessInfo) => {
    const text = `${process.name} ${process.command}`;
    return AGENT_PATTERNS.some((pattern) => pattern.test(text));
  };

  const isProtected = (process: RuntimeProcessInfo) => process.coverageStatus === 'protected';
  const riskWeight = (risk: RuntimeProcessInfo['risk']) => (risk === 'high' ? 3 : risk === 'medium' ? 2 : 1);

  const likelyAgentProcesses = useMemo(
    () => processes.filter((process) => isLikelyAgent(process)),
    [processes],
  );

  const visibleProcesses = useMemo(() => {
    const base = showOnlyAgents ? likelyAgentProcesses : processes;
    const keyword = searchText.trim().toLowerCase();

    return base
      .filter((process) => {
        if (riskFilter !== 'all' && process.risk !== riskFilter) {
          return false;
        }

        if (!keyword) {
          return true;
        }

        const text = `${process.name} ${process.command} ${process.user}`.toLowerCase();
        return text.includes(keyword);
      })
      .sort((a, b) => {
        const byRisk = riskWeight(b.risk) - riskWeight(a.risk);
        if (byRisk !== 0) return byRisk;
        return b.events - a.events || b.cpu - a.cpu || b.memory - a.memory;
      });
  }, [showOnlyAgents, likelyAgentProcesses, processes, riskFilter, searchText]);

  const overview = useMemo(() => {
    const scoped = likelyAgentProcesses;
    const protectedCount = scoped.filter((p) => isProtected(p)).length;
    const unprotected = scoped.filter((p) => p.coverageStatus === 'likely_unprotected');

    return {
      totalAgents: scoped.length,
      highRisk: scoped.filter((p) => p.risk === 'high').length,
      mediumRisk: scoped.filter((p) => p.risk === 'medium').length,
      lowRisk: scoped.filter((p) => p.risk === 'low').length,
      protectedCount,
      unprotectedCount: unprotected.length,
      urgentUnprotected: [...unprotected]
        .sort((a, b) => riskWeight(b.risk) - riskWeight(a.risk) || b.cpu - a.cpu)
        .slice(0, 5),
    };
  }, [likelyAgentProcesses]);

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#28a745';
      case 'stopped': return '#dc3545';
      case 'zombie': return '#ffc107';
      default: return '#6c757d';
    }
  };

  const handleViewDetails = (process: RuntimeProcessInfo) => {
    setSelectedProcess(process);
    setShowDetails(true);
  };

  const formatNetworkValue = (process: RuntimeProcessInfo) => {
    if (process.networkSource === 'nettop_delta') {
      return `${process.network} KB/s`;
    }
    if (process.networkSource === 'lsof_sockets') {
      return `${process.network} sockets`;
    }
    return '-';
  };

  const networkFillPercent = (process: RuntimeProcessInfo) => {
    if (process.networkSource === 'nettop_delta') {
      return Math.min(100, process.network / 50);
    }
    if (process.networkSource === 'lsof_sockets') {
      return Math.min(100, process.network / 20);
    }
    return 0;
  };

  const networkSourceLabel = (source: RuntimeProcessInfo['networkSource']) => {
    if (source === 'nettop_delta') return 'Source: nettop delta (~1s)';
    if (source === 'lsof_sockets') return 'Source: lsof socket count';
    return 'Source: unavailable';
  };

  const trend = useMemo(() => {
    const now = Date.now();
    const oneHour = now - 3_600_000;
    const oneDay = now - 86_400_000;
    const active1h = likelyAgentProcesses.filter((p) => (p.lastEventAtUnixMs ?? 0) >= oneHour).length;
    const active24h = likelyAgentProcesses.filter((p) => (p.lastEventAtUnixMs ?? 0) >= oneDay).length;
    const newAgents1h = likelyAgentProcesses.filter((p) => p.uptime <= 3600).length;
    const highRiskUnprotected = likelyAgentProcesses.filter(
      (p) => p.risk === 'high' && p.coverageStatus !== 'protected',
    ).length;
    return { active1h, active24h, newAgents1h, highRiskUnprotected };
  }, [likelyAgentProcesses]);

  const getSetupGuidance = (process: RuntimeProcessInfo) => {
    const text = `${process.name} ${process.command}`.toLowerCase();
    if (text.includes('claude')) {
      return {
        title: 'Claude Code 快速接入建议',
        steps: [
          '打开 Setup 页，切到 Claude Code 标签。',
          '复制环境变量配置到 Claude 启动环境。',
          '重启 Claude 会话后再观察本进程是否出现审计事件。',
        ],
      };
    }
    if (text.includes('cursor')) {
      return {
        title: 'Cursor 快速接入建议',
        steps: [
          '打开 Setup 页，切到 Cursor 标签。',
          '将代理地址与 API 基地址改为 AgentGuard Proxy。',
          '重新触发一次读写操作，确认进程出现最近审计事件。',
        ],
      };
    }
    if (text.includes('python') || text.includes('aider') || text.includes('langchain') || text.includes('llamaindex')) {
      return {
        title: 'Python Agent 快速接入建议',
        steps: [
          '打开 Setup 页，切到 Python 标签。',
          '按文档设置 SDK/代理环境变量。',
          '执行一次最小请求并回到进程页验证覆盖状态。',
        ],
      };
    }

    return {
      title: '通用接入建议',
      steps: [
        '打开 Setup 页，选择与你进程最接近的集成类型。',
        '优先配置 Proxy 模式，确保请求先经过 AgentGuard。',
        '回到进程页刷新，确认覆盖状态变为 Protected。',
      ],
    };
  };

  if (loading) {
    return (
      <div className="processes-page">
        <div className="loading-state">{t.common.loading}</div>
      </div>
    );
  }

  return (
    <div className="processes-page">
      <header className="page-header">
        <div className="page-title">
          <h1>{t.processes.title}</h1>
          <p>{t.processes.subtitle}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={onRefresh}>
            {t.processes.refresh}
          </button>
          <button className="btn btn-primary" onClick={onOpenSetup}>
            去快速接入
          </button>
        </div>
      </header>

      <div className="processes-overview">
        <div className="overview-card">
          <div className="overview-label">识别到 Agent 进程</div>
          <div className="overview-value">{overview.totalAgents}</div>
        </div>
        <div className="overview-card high">
          <div className="overview-label">高风险</div>
          <div className="overview-value">{overview.highRisk}</div>
        </div>
        <div className="overview-card protected">
          <div className="overview-label">已受保护</div>
          <div className="overview-value">{overview.protectedCount}</div>
        </div>
        <div className="overview-card unprotected">
          <div className="overview-label">未受保护</div>
          <div className="overview-value">{overview.unprotectedCount}</div>
        </div>
      </div>

      <div className="processes-trend">
        <div className="trend-item">
          <div className="trend-label">近 1 小时活跃 Agent</div>
          <div className="trend-value">{trend.active1h}</div>
        </div>
        <div className="trend-item">
          <div className="trend-label">近 24 小时活跃 Agent</div>
          <div className="trend-value">{trend.active24h}</div>
        </div>
        <div className="trend-item">
          <div className="trend-label">近 1 小时新出现 Agent</div>
          <div className="trend-value">{trend.newAgents1h}</div>
        </div>
        <div className="trend-item danger">
          <div className="trend-label">高风险且未保护</div>
          <div className="trend-value">{trend.highRiskUnprotected}</div>
        </div>
      </div>

      {overview.urgentUnprotected.length > 0 && (
        <div className="urgent-panel">
          <div className="urgent-title">需要优先处理的未受保护 Agent</div>
          <div className="urgent-list">
            {overview.urgentUnprotected.map((process) => (
              <button
                key={`urgent-${process.pid}`}
                className="urgent-item"
                onClick={() => handleViewDetails(process)}
              >
                <span className={`risk-chip ${process.risk}`}>{process.risk.toUpperCase()}</span>
                <span className="urgent-name">{process.name}</span>
                <span className="urgent-meta">PID {process.pid} · CPU {process.cpu.toFixed(1)}%</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="process-filters">
        <label className="toggle-inline">
          <input
            type="checkbox"
            checked={showOnlyAgents}
            onChange={(e) => setShowOnlyAgents(e.target.checked)}
          />
          仅看 Agent 相关进程
        </label>

        <input
          className="search-input"
          placeholder="搜索进程名 / 命令 / 用户"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />

        <select
          className="filter-select"
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value as 'all' | 'high' | 'medium' | 'low')}
        >
          <option value="all">全部风险</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* 进程卡片网格 */}
      <div className="processes-grid">
        {visibleProcesses.map((process) => (
          <div key={process.pid} className="process-card">
            <div className="process-header">
              <div className="process-icon">⚙️</div>
              <div className="process-basic">
                <h3 className="process-name">{process.name}</h3>
                <span className="process-pid">PID: {process.pid}</span>
              </div>
              <div className={`coverage-chip ${isProtected(process) ? 'protected' : 'unprotected'}`}>
                {isProtected(process) ? 'Protected' : process.coverageStatus === 'likely_unprotected' ? 'Likely Unprotected' : 'Unknown'}
              </div>
              <div className={`risk-chip ${process.risk}`}>{process.risk.toUpperCase()}</div>
              <div 
                className="process-status"
                style={{ backgroundColor: getStatusColor(process.status) }}
              >
                {process.status}
              </div>
            </div>

            <div className="process-metrics">
              <div className="metric">
                <div className="metric-label">{t.processes.cpuUsage}</div>
                <div className="metric-bar">
                  <div 
                    className="metric-fill cpu"
                    style={{ width: `${Math.min(100, process.cpu)}%` }}
                  ></div>
                </div>
                <div className="metric-value">{process.cpu.toFixed(1)}%</div>
              </div>

              <div className="metric">
                <div className="metric-label">{t.processes.memoryUsage}</div>
                <div className="metric-bar">
                  <div 
                    className="metric-fill memory"
                    style={{ width: `${Math.min(100, process.memory / 10)}%` }}
                  ></div>
                </div>
                <div className="metric-value">{process.memory.toFixed(1)} MB</div>
              </div>

              <div className="metric">
                <div className="metric-label">{t.processes.networkActivity}</div>
                <div className="metric-bar">
                  <div 
                    className="metric-fill network"
                    style={{ width: `${networkFillPercent(process)}%` }}
                  ></div>
                </div>
                <div className="metric-value">{formatNetworkValue(process)}</div>
              </div>
            </div>

            <div className="process-footer">
              <div className="process-stats">
                <span className="stat">⏱️ {formatUptime(process.uptime)}</span>
                <span className="stat">⚡ {process.events} events</span>
              </div>
              <button 
                className="btn btn-sm btn-primary"
                onClick={() => handleViewDetails(process)}
              >
                {t.processes.viewDetails}
              </button>
            </div>
            <div className="process-coverage-reason">
              {process.coverageReason}
            </div>
          </div>
        ))}
      </div>

      {visibleProcesses.length === 0 && (
        <div className="empty-state">{t.processes.noProcesses}</div>
      )}

      {/* 进程详情模态框 */}
      {showDetails && selectedProcess && (
        <div className="modal-overlay" onClick={() => setShowDetails(false)}>
          <div className="modal-content process-details" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Process Details - {selectedProcess.name}</h2>
              <button className="modal-close" onClick={() => setShowDetails(false)}>×</button>
            </div>

            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <label>PID</label>
                  <span className="detail-value">{selectedProcess.pid}</span>
                </div>
                <div className="detail-item">
                  <label>Status</label>
                  <span className="detail-value">
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(selectedProcess.status) }}
                    >
                      {selectedProcess.status}
                    </span>
                  </span>
                </div>
                <div className="detail-item">
                  <label>User</label>
                  <span className="detail-value">{selectedProcess.user}</span>
                </div>
                <div className="detail-item">
                  <label>Threads</label>
                  <span className="detail-value">{selectedProcess.threads}</span>
                </div>
              </div>

              <div className="detail-section">
                <h3>Command</h3>
                <code className="command-code">{selectedProcess.command}</code>
              </div>

              <div className="detail-section">
                <h3>Resource Usage</h3>
                <div className="resource-grid">
                  <div className="resource-card">
                    <div className="resource-icon">🔥</div>
                    <div className="resource-value">{selectedProcess.cpu.toFixed(2)}%</div>
                    <div className="resource-label">CPU</div>
                  </div>
                  <div className="resource-card">
                    <div className="resource-icon">💾</div>
                    <div className="resource-value">{selectedProcess.memory.toFixed(2)} MB</div>
                    <div className="resource-label">Memory</div>
                  </div>
                  <div className="resource-card">
                    <div className="resource-icon">🌐</div>
                    <div className="resource-value">{formatNetworkValue(selectedProcess)}</div>
                    <div className="resource-label">Network</div>
                  </div>
                  <div className="resource-card">
                    <div className="resource-icon">📁</div>
                    <div className="resource-value">{selectedProcess.openFiles}</div>
                    <div className="resource-label">Open Files</div>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h3>Network Source</h3>
                <div className="setting-description">{networkSourceLabel(selectedProcess.networkSource)}</div>
              </div>

              <div className="detail-section">
                <h3>Coverage Proof</h3>
                <div className="detail-grid">
                  <div className="detail-row">
                    <span className="detail-label">Status:</span>
                    <span className="detail-value">{selectedProcess.coverageStatus}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Confidence:</span>
                    <span className="detail-value">{selectedProcess.coverageConfidence}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Last Event:</span>
                    <span className="detail-value">
                      {selectedProcess.lastEventAtUnixMs
                        ? new Date(selectedProcess.lastEventAtUnixMs).toLocaleString()
                        : 'No linked event'}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Reason:</span>
                    <span className="detail-value">{selectedProcess.coverageReason}</span>
                  </div>
                </div>
              </div>

              {selectedProcess.coverageStatus !== 'protected' && (
                <div className="detail-section">
                  <h3>{getSetupGuidance(selectedProcess).title}</h3>
                  <ol className="guidance-list">
                    {getSetupGuidance(selectedProcess).steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <div className="page-actions">
                    <button className="btn btn-primary" onClick={onOpenSetup}>前往快速接入</button>
                  </div>
                </div>
              )}

              <div className="detail-section">
                <h3>Activity Timeline</h3>
                <div className="timeline">
                  <div className="timeline-item">
                    <div className="timeline-dot"></div>
                    <div className="timeline-content">
                      <div className="timeline-time">Process started</div>
                      <div className="timeline-desc">{formatUptime(selectedProcess.uptime)} ago</div>
                    </div>
                  </div>
                  <div className="timeline-item">
                    <div className="timeline-dot"></div>
                    <div className="timeline-content">
                      <div className="timeline-time">First event captured</div>
                      <div className="timeline-desc">Monitoring active</div>
                    </div>
                  </div>
                  <div className="timeline-item">
                    <div className="timeline-dot active"></div>
                    <div className="timeline-content">
                      <div className="timeline-time">Currently monitoring</div>
                      <div className="timeline-desc">{selectedProcess.events} events recorded</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDetails(false)}>
                {t.common.close}
              </button>
              <button className="btn btn-danger">
                {t.processes.stopProcess}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
