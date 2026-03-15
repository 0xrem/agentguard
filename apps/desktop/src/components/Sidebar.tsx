import { useLanguage, NAV_ITEMS, type Page } from '../i18n';

interface SidebarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
}

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const { t, language, toggleLanguage } = useLanguage();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-icon">🛡️</span>
          <span className="logo-text">AgentGuard</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
            onClick={() => onPageChange(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">
              {language === 'en' ? item.label : item.labelZh}
            </span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="language-toggle" onClick={toggleLanguage}>
          <span className="language-icon">🌐</span>
          <span className="language-label">{language === 'en' ? '中文' : 'English'}</span>
        </button>
      </div>
    </aside>
  );
}
