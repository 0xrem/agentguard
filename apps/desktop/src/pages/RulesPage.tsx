import { useState } from 'react';
import { useLanguage } from '../i18n';
import type { ManagedRule, Layer, EnforcementAction, RiskLevel } from '../types';

interface RulesPageProps {
  rules: ManagedRule[];
  loading: boolean;
  onAddRule: () => void;
  onAddFromTemplate: () => void;
  onEditRule: (rule: ManagedRule) => void;
  onDeleteRule: (ruleId: string) => void;
  onToggleRule: (ruleId: string, enabled: boolean) => void;
  onExportRules: () => void;
  onImportRules: () => void;
}

export function RulesPage({
  rules,
  loading,
  onAddRule,
  onAddFromTemplate,
  onEditRule,
  onDeleteRule,
  onToggleRule,
  onExportRules,
  onImportRules,
}: RulesPageProps) {
  const { t } = useLanguage();
  const [filterLayer, setFilterLayer] = useState<Layer | 'all'>('all');
  const [filterAction, setFilterAction] = useState<EnforcementAction | 'all'>('all');

  const filteredRules = rules.filter((rule) => {
    if (filterLayer !== 'all' && rule.rule.layer !== filterLayer) return false;
    if (filterAction !== 'all' && rule.rule.action !== filterAction) return false;
    return true;
  });

  const getLayerIcon = (layer: Layer | null) => {
    if (!layer) return '📌';
    switch (layer) {
      case 'command': return '💻';
      case 'tool': return '🔧';
      case 'prompt': return '💬';
      default: return '📌';
    }
  };

  const getActionIcon = (action: EnforcementAction) => {
    switch (action) {
      case 'block': return '🚫';
      case 'warn': return '⚠️';
      case 'ask': return '⏳';
      case 'allow': return '✅';
      case 'kill': return '❌';
      default: return '❓';
    }
  };

  const getRiskColor = (risk: RiskLevel | null) => {
    if (!risk) return '#6c757d';
    switch (risk) {
      case 'critical': return '#dc3545';
      case 'high': return '#fd7e14';
      case 'medium': return '#ffc107';
      case 'low': return '#28a745';
      default: return '#6c757d';
    }
  };

  if (loading) {
    return (
      <div className="rules-page">
        <div className="loading-state">{t.common.loading}</div>
      </div>
    );
  }

  return (
    <div className="rules-page">
      <header className="page-header">
        <div className="page-title">
          <h1>{t.rules.title}</h1>
          <p>{t.rules.subtitle}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={onImportRules}>
            {t.rules.importRules}
          </button>
          <button className="btn btn-secondary" onClick={onExportRules}>
            {t.rules.exportRules}
          </button>
          <button className="btn btn-secondary" onClick={onAddFromTemplate}>
            {t.rules.fromTemplate}
          </button>
          <button className="btn btn-primary" onClick={onAddRule}>
            {t.rules.addRule}
          </button>
        </div>
      </header>

      {/* 筛选器 */}
      <div className="filters-bar">
        <div className="filters-group">
          <select
            className="filter-select"
            value={filterLayer}
            onChange={(e) => setFilterLayer(e.target.value as Layer | 'all')}
          >
            <option value="all">{t.rules.layer}</option>
            <option value="command">Command</option>
            <option value="tool">Tool</option>
            <option value="prompt">Prompt</option>
          </select>

          <select
            className="filter-select"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value as EnforcementAction | 'all')}
          >
            <option value="all">{t.rules.action}</option>
            <option value="block">Blocked</option>
            <option value="allow">Allowed</option>
            <option value="warn">Warn</option>
            <option value="ask">Ask</option>
            <option value="kill">Kill</option>
          </select>
        </div>
      </div>

      {/* 规则表格 */}
      <div className="rules-table-container">
        <table className="rules-table">
          <thead>
            <tr>
              <th>{t.rules.enabled}</th>
              <th>{t.rules.name}</th>
              <th>{t.rules.layer}</th>
              <th>{t.rules.operation}</th>
              <th>{t.rules.action}</th>
              <th>{t.rules.priority}</th>
              <th>{t.rules.risk}</th>
              <th>{t.rules.actions}</th>
            </tr>
          </thead>
          <tbody>
            {filteredRules.length > 0 ? (
              filteredRules.map((rule) => (
                <tr key={rule.id} className="rule-row">
                  <td className="toggle-cell">
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => onToggleRule(rule.id, e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </td>
                  <td className="rule-name">
                    <div className="rule-icon">{getLayerIcon(rule.rule.layer)}</div>
                    <span>{rule.rule.reason || 'Unnamed Rule'}</span>
                  </td>
                  <td>
                    <span className="badge">{rule.rule.layer || 'Any'}</span>
                  </td>
                  <td className="operation">{rule.rule.operation || 'Any'}</td>
                  <td className="action">
                    <span className="action-icon">{getActionIcon(rule.rule.action)}</span>
                    <span className={`action-label ${rule.rule.action}`}>{rule.rule.action}</span>
                  </td>
                  <td className="priority">{rule.rule.priority}</td>
                  <td className="risk">
                    <span 
                      className="risk-badge"
                      style={{ backgroundColor: getRiskColor(rule.rule.minimum_risk) }}
                    >
                      {rule.rule.minimum_risk || 'Any'}
                    </span>
                  </td>
                  <td className="actions">
                    <button 
                      className="btn btn-sm btn-secondary"
                      onClick={() => onEditRule(rule)}
                    >
                      {t.rules.edit}
                    </button>
                    <button 
                      className="btn btn-sm btn-danger"
                      onClick={() => onDeleteRule(rule.id)}
                    >
                      {t.rules.delete}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="empty-state">
                  {rules.length === 0 ? t.rules.createFirst : t.rules.noRules}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 结果统计 */}
      <div className="results-summary">
        Showing {filteredRules.length} of {rules.length} rules
      </div>
    </div>
  );
}
