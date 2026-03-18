import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../i18n';
import type { AuditRecord, AuditReview, AuditReviewStatus, Layer, EnforcementAction, RiskLevel } from '../types';

export interface AuditFilters {
  searchQuery: string;
  filterLayer: Layer | 'all';
  filterAction: EnforcementAction | 'all';
  filterRisk: RiskLevel | 'all';
  timeRange: 'today' | '7d' | '30d' | 'custom';
}

interface AuditPageProps {
  records: AuditRecord[];
  reviewMap?: Record<number, AuditReview>;
  loading: boolean;
  onRefresh?: () => void;
  currentPage?: number;
  hasNextPage?: boolean;
  onPageChange?: (page: number) => void;
  filters?: AuditFilters;
  onFiltersChange?: (filters: AuditFilters) => void;
  onUpdateReview?: (auditRecordId: number, status: AuditReviewStatus, note?: string, label?: string) => void;
}

export function AuditPage({
  records,
  reviewMap = {},
  loading,
  onRefresh,
  currentPage = 1,
  hasNextPage = false,
  onPageChange,
  filters,
  onFiltersChange,
  onUpdateReview,
}: AuditPageProps) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState(filters?.searchQuery ?? '');
  const [filterLayer, setFilterLayer] = useState<Layer | 'all'>(filters?.filterLayer ?? 'all');
  const [filterAction, setFilterAction] = useState<EnforcementAction | 'all'>(filters?.filterAction ?? 'all');
  const [filterRisk, setFilterRisk] = useState<RiskLevel | 'all'>(filters?.filterRisk ?? 'all');
  const [timeRange, setTimeRange] = useState<'today' | '7d' | '30d' | 'custom'>(filters?.timeRange ?? '7d');
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<'all' | AuditReviewStatus>('all');
  const [reviewNote, setReviewNote] = useState('');

  const selectedReview = selectedRecord ? reviewMap[selectedRecord.id] : undefined;

  useEffect(() => {
    onFiltersChange?.({
      searchQuery,
      filterLayer,
      filterAction,
      filterRisk,
      timeRange,
    });
  }, [filterAction, filterLayer, filterRisk, onFiltersChange, searchQuery, timeRange]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      // Server-side query already handles search/action/risk/time filters.
      if (filterLayer !== 'all' && record.event.layer !== filterLayer) {
        return false;
      }
      if (reviewFilter !== 'all') {
        const status = reviewMap[record.id]?.status ?? 'unreviewed';
        if (status !== reviewFilter) {
          return false;
        }
      }
      return true;
    });
  }, [records, filterLayer, reviewFilter, reviewMap]);

  const clearFilters = () => {
    setSearchQuery('');
    setFilterLayer('all');
    setFilterAction('all');
    setFilterRisk('all');
    setTimeRange('7d');
    setReviewFilter('all');
  };

  const handleViewDetails = (record: AuditRecord) => {
    setSelectedRecord(record);
    setReviewNote(reviewMap[record.id]?.note ?? '');
    setShowDetailModal(true);
  };

  const reviewStatusLabel = (status: AuditReviewStatus) => {
    switch (status) {
      case 'false_positive':
        return '误报';
      case 'resolved':
        return '已处理';
      case 'needs_attention':
        return '需关注';
      default:
        return '未复核';
    }
  };

  const handleReview = (recordId: number, status: AuditReviewStatus, label?: string) => {
    onUpdateReview?.(recordId, status, reviewNote.trim() || undefined, label);
  };

  const handleExport = async (format: 'json' | 'csv') => {
    const dataStr = format === 'json' 
      ? JSON.stringify(filteredRecords, null, 2)
      : convertToCSV(filteredRecords);
    
    const blob = new Blob([dataStr], { 
      type: format === 'json' ? 'application/json' : 'text/csv' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const convertToCSV = (recs: AuditRecord[]): string => {
    const headers = ['Time', 'Agent', 'Layer', 'Operation', 'Target', 'Action', 'Risk', 'Reason'];
    const rows = recs.map(r => [
      new Date(r.recorded_at_unix_ms).toISOString(),
      r.event.agent.name,
      r.event.layer,
      r.event.operation,
      formatTarget(r),
      r.decision.action,
      r.decision.risk || 'N/A',
      r.decision.reason
    ]);
    return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  };

  const formatTarget = (record: AuditRecord): string => {
    if (record.event.target.kind === 'none') {
      return '-';
    }

    return record.event.target.value;
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
      case 'block': return 'BLK';
      case 'allow': return 'ALW';
      case 'ask': return 'ASK';
      case 'warn': return 'WRN';
      case 'kill': return 'KIL';
      default: return 'UNK';
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
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => handleExport('json')}>
            Export JSON
          </button>
          <button className="btn btn-secondary" onClick={() => handleExport('csv')}>
            Export CSV
          </button>
          {onRefresh && (
            <button className="btn btn-primary" onClick={onRefresh}>
              Refresh
            </button>
          )}
        </div>
      </header>

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
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as any)}
          >
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="custom">Custom</option>
          </select>

          <select
            className="filter-select"
            value={filterLayer}
            onChange={(e) => setFilterLayer(e.target.value as Layer | 'all')}
          >
            <option value="all">{t.audit.allLayers}</option>
            <option value="command">Command</option>
            <option value="tool">Tool</option>
            <option value="prompt">Prompt</option>
          </select>

          <select
            className="filter-select"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value as EnforcementAction | 'all')}
          >
            <option value="all">{t.audit.allActions}</option>
            <option value="block">Blocked</option>
            <option value="allow">Allowed</option>
            <option value="warn">Warn</option>
            <option value="ask">Ask</option>
            <option value="kill">Kill</option>
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

          <select
            className="filter-select"
            value={reviewFilter}
            onChange={(e) => setReviewFilter(e.target.value as 'all' | AuditReviewStatus)}
          >
            <option value="all">全部复核状态</option>
            <option value="unreviewed">未复核</option>
            <option value="false_positive">误报</option>
            <option value="resolved">已处理</option>
            <option value="needs_attention">需关注</option>
          </select>

          {(filterLayer !== 'all' || filterAction !== 'all' || filterRisk !== 'all' || searchQuery || timeRange !== '7d' || reviewFilter !== 'all') && (
            <button className="btn btn-text" onClick={clearFilters}>
              {t.audit.clearFilters}
            </button>
          )}
        </div>
      </div>

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
              <th>复核</th>
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
                      {formatTarget(record)}
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
                  <td>
                    <span className={`badge review-badge review-${reviewMap[record.id]?.status ?? 'unreviewed'}`}>
                      {reviewStatusLabel(reviewMap[record.id]?.status ?? 'unreviewed')}
                    </span>
                  </td>
                  <td className="details">
                    <button className="btn btn-sm" onClick={() => handleViewDetails(record)}>
                      View
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="empty-state">
                  {t.audit.noLogs}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="results-summary">
        Showing {filteredRecords.length} of {records.length} logs
      </div>

      <div className="pagination-controls">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => onPageChange?.(Math.max(1, currentPage - 1))}
          disabled={loading || currentPage <= 1}
        >
          Previous
        </button>
        <span className="pagination-label">Page {currentPage}</span>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => onPageChange?.(currentPage + 1)}
          disabled={loading || !hasNextPage}
        >
          Next
        </button>
      </div>

      {showDetailModal && selectedRecord && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Event Details</h2>
              <button className="close-btn" onClick={() => setShowDetailModal(false)}>×</button>
            </div>
            <div className="modal-content">
              <div className="detail-section">
                <h3>Event Information</h3>
                <div className="detail-grid">
                  <div className="detail-row">
                    <span className="detail-label">Time:</span>
                    <span className="detail-value">
                      {new Date(selectedRecord.recorded_at_unix_ms).toLocaleString()}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Agent:</span>
                    <span className="detail-value">{selectedRecord.event.agent.name}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Layer:</span>
                    <span className="detail-value">{selectedRecord.event.layer}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Operation:</span>
                    <span className="detail-value">{selectedRecord.event.operation}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Target:</span>
                    <span className="detail-value">
                      {selectedRecord.event.target.kind}: {formatTarget(selectedRecord)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h3>Decision</h3>
                <div className="detail-grid">
                  <div className="detail-row">
                    <span className="detail-label">Action:</span>
                    <span className="detail-value">
                      {getActionIcon(selectedRecord.decision.action)} {selectedRecord.decision.action}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Risk Level:</span>
                    <span className="detail-value" style={{ color: getRiskColor(selectedRecord.decision.risk) }}>
                      {selectedRecord.decision.risk || 'N/A'}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Matched Rule:</span>
                    <span className="detail-value">
                      {selectedRecord.decision.matched_rule_id || 'No rule matched'}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Reason:</span>
                    <span className="detail-value">{selectedRecord.decision.reason}</span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h3>Review Workflow</h3>
                <div className="detail-grid">
                  <div className="detail-row">
                    <span className="detail-label">Current:</span>
                    <span className="detail-value">
                      {reviewStatusLabel(selectedReview?.status ?? 'unreviewed')}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Reviewer Note:</span>
                    <input
                      className="search-input"
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      placeholder="e.g. safe internal endpoint / expected behavior"
                    />
                  </div>
                </div>
                <div className="page-actions" style={{ marginTop: 12 }}>
                  <button className="btn btn-secondary" onClick={() => handleReview(selectedRecord.id, 'false_positive', 'false_positive')}>
                    标记误报
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleReview(selectedRecord.id, 'needs_attention', 'needs_attention')}>
                    标记需关注
                  </button>
                  <button className="btn btn-primary" onClick={() => handleReview(selectedRecord.id, 'resolved', 'resolved')}>
                    标记已处理
                  </button>
                </div>
              </div>

              {Object.keys(selectedRecord.event.metadata).length > 0 && (
                <div className="detail-section">
                  <h3>Metadata</h3>
                  <pre className="metadata-json">
                    {JSON.stringify(selectedRecord.event.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
