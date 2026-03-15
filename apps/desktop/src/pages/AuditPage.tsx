import { useState, useMemo } from 'react';
import { useLanguage } from '../i18n';
import type { AuditRecord, Layer, EnforcementAction, RiskLevel } from '../types';

interface AuditPageProps {
  records: AuditRecord[];
  loading: boolean;
}

export function AuditPage({ records, loading }: AuditPageProps) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLayer, setFilterLayer] = useState<Layer | 'all'>('all');
  const [filterAction, setFilterAction] = useState<EnforcementAction | 'all'>('all');
  const [filterRisk, setFilterRisk] = useState<RiskLevel | 'all'>('all');

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (searchQuery && !record.event.agent.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (filterLayer !== 'all' && record.event.layer !== filterLayer) {
        return false;
      }
      if (filterAction !== 'all' && record.decision.action !== filterAction) {
        return false;
      }
      if (filterRisk !== 'all' && record.decision.risk !== filterRisk) {
        return false;
      }
      return true;
    });
  }, [records, searchQuery, filterLayer, filterAction, filterRisk]);

  const clearFilters = () => {
    setSearchQuery('');
    setFilterLayer('all');
    setFilterAction('all');
    setFilterRisk('all');
  };

  const getRiskColor = (risk: RiskLevel | null) => {
    switch (risk) {
      case 'critical': return '#dc3545';
      case 'high': return '#fd7e14';
      case 'medium': return '#ffc107';
      case 'low': return '#28a745';
      default: return '#6c757d';
    }
  };

  const getActionIcon = (action: EnforcementAction) => {
    switch (action) {
      case 'block': return '🚫';
      case 'allow': return '✅';
      case 'ask': return '⏳';
      default: return '❓';
    }
  };

  if (loading) {
    return (
      <div className="audit-page">
        <div className="loading-state">{t.common.loading}</div>
      </div>
    );
  }

  return (
    <div className="audit-page">
      <header className="page-header">
        <div className="page-title">
          <h1>{t.audit.title}</h1>
          <p>{t.audit.subtitle}</p>
        </div>
      </header>

      {/* 搜索和筛选 */}
      <div className="filters-bar">
        <div className="search-box">
          <input
            type="text"
            className="search-input"
            placeholder={t.audit.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className="search-icon">🔍</span>
        </div>

        <div className="filters-group">
          <select
            className="filter-select"
            value={filterLayer}
            onChange={(e) => setFilterLayer(e.target.value as Layer | 'all')}
          >
            <option value="all">{t.audit.allLayers}</option>
            <option value="command">Command</option>
            <option value="tool">Tool</option>
            <option value="network">Network</option>
            <option value="prompt">Prompt</option>
          </select>

          <select
            className="filter-select"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value as EnforcementAction | 'all')}
          >
            <option value="all">{t.audit.allActions}</option>
            <option value="blocked">Blocked</option>
            <option value="allowed">Allowed</option>
            <option value="ask">Ask</option>
          </select>

          <select
            className="filter-select"
            value={filterRisk}
            onChange={(e) => setFilterRisk(e.target.value as RiskLevel | 'all')}
          >
            <option value="all">{t.audit.allRisks}</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          {(filterLayer !== 'all' || filterAction !== 'all' || filterRisk !== 'all' || searchQuery) && (
            <button className="btn btn-text" onClick={clearFilters}>
              {t.audit.clearFilters}
            </button>
          )}
        </div>
      </div>

      {/* 日志表格 */}
      <div className="logs-table-container">
        <table className="logs-table">
          <thead>
            <tr>
              <th>{t.audit.time}</th>
              <th>{t.audit.agent}</th>
              <th>{t.audit.operation}</th>
              <th>{t.audit.target}</th>
              <th>{t.audit.action}</th>
              <th>{t.audit.risk}</th>
              <th>{t.audit.details}</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length > 0 ? (
              filteredRecords.map((record, index) => (
                <tr key={index} className="log-row">
                  <td className="timestamp">
                    {new Date(record.recorded_at_unix_ms).toLocaleString()}
                  </td>
                  <td className="agent">{record.event.agent.name}</td>
                  <td className="operation">
                    <span className="badge">{record.event.layer}</span>
                    {record.event.operation}
                  </td>
                  <td className="target">
                    <code className="target-code">
                      {record.event.target.kind === 'path' ? record.event.target.value : 
                       record.event.target.kind === 'command' ? record.event.target.value :
                       record.event.target.kind === 'domain' ? record.event.target.value :
                       record.event.target.kind === 'prompt' ? record.event.target.value :
                       record.event.target.kind === 'database' ? record.event.target.value : '-'}
                    </code>
                  </td>
                  <td className="action">
                    <span className="action-icon">{getActionIcon(record.decision.action)}</span>
                    <span className={`action-label ${record.decision.action}`}>{record.decision.action}</span>
                  </td>
                  <td className="risk">
                    <span 
                      className="risk-badge"
                      style={{ backgroundColor: getRiskColor(record.decision.risk) }}
                    >
                      {record.decision.risk || 'N/A'}
                    </span>
                  </td>
                  <td className="details">
                    <button className="btn btn-sm">View</button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="empty-state">
                  {t.audit.noLogs}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 结果统计 */}
      <div className="results-summary">
        Showing {filteredRecords.length} of {records.length} logs
      </div>
    </div>
  );
}
