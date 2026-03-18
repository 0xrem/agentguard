import { useLanguage, NAV_ITEMS, type Page } from '../i18n';

interface SidebarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ currentPage, onPageChange, collapsed, onToggleCollapse }: SidebarProps) {
  const { language, toggleLanguage } = useLanguage();

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="logo-row">
          <div className="logo">
            <span className="logo-icon">AG</span>
            {!collapsed ? <span className="logo-text">AgentGuard</span> : null}
          </div>
          <button className="sidebar-collapse-btn" type="button" onClick={onToggleCollapse}>
            {collapsed ? '>' : '<'}
          </button>
        </div>
        {!collapsed ? <p className="sidebar-subtitle">Security Operations</p> : null}
      </div>

      {!collapsed ? <div className="sidebar-section-label">Workspace</div> : null}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
            onClick={() => onPageChange(item.id)}
            title={language === 'en' ? item.label : item.labelZh}
          >
            <span className="nav-icon">{item.icon}</span>
            {!collapsed ? (
              <span className="nav-label">
                {language === 'en' ? item.label : item.labelZh}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-runtime-chip" title={language === 'en' ? 'Runtime Connected' : '运行时已连接'}>
          <span className="sidebar-runtime-dot" aria-hidden="true"></span>
          {!collapsed ? <span>{language === 'en' ? 'Runtime Connected' : '运行时已连接'}</span> : null}
        </div>
        <button className="language-toggle" onClick={toggleLanguage} title={language === 'en' ? 'Switch language' : '切换语言'}>
          <span className="language-icon">A/文</span>
          {!collapsed ? <span className="language-label">{language === 'en' ? '中文' : 'English'}</span> : null}
        </button>
      </div>
    </aside>
  );
}
