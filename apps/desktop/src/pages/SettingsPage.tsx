import { useLanguage, type Language } from '../i18n';

interface SettingsPageProps {
  currentLanguage: Language;
  onLanguageChange: (language: Language) => void;
  darkMode: boolean;
  onDarkModeChange: (enabled: boolean) => void;
  notificationsEnabled: boolean;
  onNotificationsChange: (enabled: boolean) => void;
  autoStartStack: boolean;
  onAutoStartStackChange: (enabled: boolean) => void;
  dataRetentionDays: number;
  onDataRetentionChange: (days: number) => void;
}

export function SettingsPage({
  currentLanguage,
  onLanguageChange,
  darkMode,
  onDarkModeChange,
  notificationsEnabled,
  onNotificationsChange,
  autoStartStack,
  onAutoStartStackChange,
  dataRetentionDays,
  onDataRetentionChange,
}: SettingsPageProps) {
  const { t } = useLanguage();

  return (
    <div className="settings-page">
      <header className="page-header">
        <div className="page-title">
          <h1>{t.settings.title}</h1>
          <p>{t.settings.subtitle}</p>
        </div>
      </header>

      <div className="settings-grid">
        {/* 语言设置 */}
        <section className="settings-card">
          <div className="settings-card-header">
            <h2>🌐 {t.settings.language}</h2>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="setting-label">{t.settings.language}</label>
              <select
                className="setting-select"
                value={currentLanguage}
                onChange={(e) => onLanguageChange(e.target.value as Language)}
              >
                <option value="en">English</option>
                <option value="zh">中文</option>
              </select>
            </div>
            <p className="setting-description">
              {currentLanguage === 'zh' 
                ? '界面语言将立即切换' 
                : 'Interface language will change immediately'}
            </p>
          </div>
        </section>

        {/* 外观设置 */}
        <section className="settings-card">
          <div className="settings-card-header">
            <h2>🎨 {t.settings.theme}</h2>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="setting-label">{t.settings.themeDescription}</label>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={darkMode}
                  onChange={(e) => onDarkModeChange(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <p className="setting-description">
              {darkMode 
                ? (currentLanguage === 'zh' ? '深色模式已启用' : 'Dark mode is enabled')
                : (currentLanguage === 'zh' ? '浅色模式已启用' : 'Light mode is enabled')}
            </p>
          </div>
        </section>

        {/* 通知设置 */}
        <section className="settings-card">
          <div className="settings-card-header">
            <h2>🔔 {t.settings.notifications}</h2>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="setting-label">{t.settings.notificationsDescription}</label>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(e) => onNotificationsChange(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <p className="setting-description">
              {notificationsEnabled
                ? (currentLanguage === 'zh' ? '审批请求和重要事件将显示通知' : 'Notifications for approval requests and important events')
                : (currentLanguage === 'zh' ? '通知已禁用' : 'Notifications are disabled')}
            </p>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <h2>🚀 {t.settings.autoStartStack}</h2>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="setting-label">{t.settings.autoStartStackDescription}</label>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={autoStartStack}
                  onChange={(e) => onAutoStartStackChange(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <p className="setting-description">
              {autoStartStack
                ? (currentLanguage === 'zh' ? '应用启动时会自动拉起 daemon 和 proxy' : 'Daemon and proxy will auto-start when the app opens')
                : (currentLanguage === 'zh' ? '需手动点击启动本地栈' : 'Start local stack manually when needed')}
            </p>
          </div>
        </section>

        {/* 数据保留设置 */}
        <section className="settings-card">
          <div className="settings-card-header">
            <h2>💾 {t.settings.dataRetention}</h2>
          </div>
          <div className="settings-card-body">
            <div className="setting-row">
              <label className="setting-label">{t.settings.dataRetentionDescription}</label>
              <select
                className="setting-select"
                value={dataRetentionDays}
                onChange={(e) => onDataRetentionChange(Number(e.target.value))}
              >
                <option value={7}>7 {t.settings.days}</option>
                <option value={14}>14 {t.settings.days}</option>
                <option value={30}>30 {t.settings.days}</option>
                <option value={60}>60 {t.settings.days}</option>
                <option value={90}>90 {t.settings.days}</option>
                <option value={180}>180 {t.settings.days}</option>
                <option value={365}>365 {t.settings.days}</option>
              </select>
            </div>
            <p className="setting-description">
              {currentLanguage === 'zh'
                ? `审计日志和事件数据将保留 ${dataRetentionDays} 天`
                : `Audit logs and event data will be retained for ${dataRetentionDays} days`}
            </p>
          </div>
        </section>

        {/* 关于 */}
        <section className="settings-card">
          <div className="settings-card-header">
            <h2>ℹ️ AgentGuard</h2>
          </div>
          <div className="settings-card-body">
            <div className="about-info">
              <div className="info-row">
                <span className="info-label">AgentGuard Desktop</span>
                <span className="info-value">v0.1.0</span>
              </div>
              <div className="info-row">
                <span className="info-label">Build</span>
                <span className="info-value">2025.01</span>
              </div>
              <div className="info-row">
                <span className="info-label">GitHub</span>
                <a 
                  href="https://github.com/agentguard/agentguard" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="info-link"
                >
                  github.com/agentguard/agentguard
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
