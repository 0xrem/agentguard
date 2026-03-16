import { useMemo, useState } from 'react';
import { useLanguage } from '../i18n';
import type { RuntimeProcessInfo } from '../types';

interface ProcessesPageProps {
  loading: boolean;
  processes: RuntimeProcessInfo[];
  onRefresh: () => void;
}

export function ProcessesPage({ loading, processes, onRefresh }: ProcessesPageProps) {
  const { t } = useLanguage();
  const [selectedProcess, setSelectedProcess] = useState<RuntimeProcessInfo | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const sortedProcesses = useMemo(
    () => [...processes].sort((a, b) => b.events - a.events || b.cpu - a.cpu || b.memory - a.memory),
    [processes],
  );

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
        <button className="btn btn-secondary" onClick={onRefresh}>
          {t.processes.refresh}
        </button>
      </header>

      {/* 进程卡片网格 */}
      <div className="processes-grid">
        {sortedProcesses.map((process) => (
          <div key={process.pid} className="process-card">
            <div className="process-header">
              <div className="process-icon">⚙️</div>
              <div className="process-basic">
                <h3 className="process-name">{process.name}</h3>
                <span className="process-pid">PID: {process.pid}</span>
              </div>
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
                    style={{ width: `${Math.min(100, process.network / 50)}%` }}
                  ></div>
                </div>
                <div className="metric-value">{process.network} sockets</div>
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
          </div>
        ))}
      </div>

      {sortedProcesses.length === 0 && (
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
                    <div className="resource-value">{selectedProcess.network} sockets</div>
                    <div className="resource-label">Network Sockets</div>
                  </div>
                  <div className="resource-card">
                    <div className="resource-icon">📁</div>
                    <div className="resource-value">{selectedProcess.openFiles}</div>
                    <div className="resource-label">Open Files</div>
                  </div>
                </div>
              </div>

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
