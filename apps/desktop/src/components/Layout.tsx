import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Sidebar } from './Sidebar';
import { NAV_ITEMS, useLanguage, type Page } from '../i18n';

const SIDEBAR_COLLAPSED_KEY = 'agentguard:sidebarCollapsed';

interface LayoutProps {
  children: ReactNode;
  currentPage: Page;
  onPageChange: (page: Page) => void;
  onRefresh?: () => void;
  onStartStack?: () => void;
  onRunDemo?: () => void;
  realtimeMode?: "live" | "fallback";
  realtimeSeq?: number;
  realtimeReplayMs?: number;
  realtimeGapDetected?: boolean;
}

export function Layout({
  children,
  currentPage,
  onPageChange,
  onRefresh,
  onStartStack,
  onRunDemo,
  realtimeMode = "fallback",
  realtimeSeq = 0,
  realtimeReplayMs = 0,
  realtimeGapDetected = false,
}: LayoutProps) {
  const { language } = useLanguage();
  const [now, setNow] = useState(() => new Date());
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // Ignore localStorage persistence issues.
    }
  }, [sidebarCollapsed]);

  const currentNavLabel = useMemo(() => {
    const item = NAV_ITEMS.find((entry) => entry.id === currentPage);
    if (!item) return currentPage;
    return language === 'en' ? item.label : item.labelZh;
  }, [currentPage, language]);

  const commands = useMemo(() => {
    const navCommands = NAV_ITEMS.map((item) => ({
      id: `nav-${item.id}`,
      label: language === 'en' ? item.label : item.labelZh,
      group: language === 'en' ? 'Navigate' : '导航',
      run: () => onPageChange(item.id),
    }));

    return [
      ...navCommands,
      {
        id: 'refresh',
        label: language === 'en' ? 'Refresh runtime data' : '刷新运行时数据',
        group: language === 'en' ? 'Actions' : '操作',
        run: () => onRefresh?.(),
      },
      {
        id: 'start-stack',
        label: language === 'en' ? 'Start local stack' : '启动本地栈',
        group: language === 'en' ? 'Actions' : '操作',
        run: () => onStartStack?.(),
      },
      {
        id: 'run-demo',
        label: language === 'en' ? 'Run live demo check' : '运行实时演示检查',
        group: language === 'en' ? 'Actions' : '操作',
        run: () => onRunDemo?.(),
      },
      {
        id: 'toggle-sidebar',
        label: sidebarCollapsed
          ? (language === 'en' ? 'Expand sidebar' : '展开侧栏')
          : (language === 'en' ? 'Collapse sidebar' : '折叠侧栏'),
        group: language === 'en' ? 'Layout' : '布局',
        run: () => setSidebarCollapsed((prev) => !prev),
      },
    ];
  }, [language, onPageChange, onRefresh, onRunDemo, onStartStack, sidebarCollapsed]);

  const visibleCommands = useMemo(() => {
    const keyword = paletteQuery.trim().toLowerCase();
    if (!keyword) return commands;
    return commands.filter((item) => item.label.toLowerCase().includes(keyword));
  }, [commands, paletteQuery]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const isCmdK = (event.metaKey || event.ctrlKey) && key === 'k';
      if (isCmdK) {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
        setPaletteQuery('');
        return;
      }

      if (!paletteOpen && (event.metaKey || event.ctrlKey) && /^[1-6]$/.test(event.key)) {
        event.preventDefault();
        const index = Number(event.key) - 1;
        const item = NAV_ITEMS[index];
        if (item) {
          onPageChange(item.id);
        }
        return;
      }

      if (paletteOpen && key === 'escape') {
        event.preventDefault();
        setPaletteOpen(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onPageChange, paletteOpen]);

  function runCommand(commandId: string) {
    const command = commands.find((item) => item.id === commandId);
    if (!command) return;
    command.run();
    setPaletteOpen(false);
    setPaletteQuery('');
  }

  return (
    <div className="desktop-shell">
      <div className="desktop-window">
        <header className="app-titlebar">
          <div className="titlebar-controls" aria-hidden="true">
            <span className="dot close"></span>
            <span className="dot min"></span>
            <span className="dot max"></span>
          </div>
          <div className="titlebar-title">AgentGuard Desktop Control Room</div>
          <div className="titlebar-meta-wrap">
            <button
              className="titlebar-command-btn"
              type="button"
              onClick={() => {
                setPaletteOpen(true);
                setPaletteQuery('');
              }}
            >
              Command Palette (Ctrl/Cmd+K)
            </button>
            <div className="titlebar-meta">{now.toLocaleTimeString()}</div>
          </div>
        </header>

        <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <Sidebar
            currentPage={currentPage}
            onPageChange={onPageChange}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
          />
          <main className="main-content">
            {children}
          </main>
        </div>

        <footer className="app-statusbar">
          <span>Active: {currentNavLabel}</span>
          <span className={`rt-conn ${realtimeMode === "live" ? "ok" : "warn"}`}>
            RT: {realtimeMode === "live" ? "LIVE" : "FALLBACK"}
          </span>
          <span className="rt-seq">Seq: {realtimeSeq}</span>
          <span className="rt-replay">Replay: {Math.max(0, Math.round(realtimeReplayMs))}ms</span>
          <span className={`rt-gap ${realtimeGapDetected ? "warn" : "ok"}`}>
            Gap: {realtimeGapDetected ? "RECOVERED" : "NO"}
          </span>
          <span>Mode: Desktop Native UX</span>
        </footer>

        {paletteOpen ? (
          <div className="command-palette-overlay" onClick={() => setPaletteOpen(false)}>
            <section className="command-palette" onClick={(event) => event.stopPropagation()}>
              <div className="command-palette-header">
                <strong>{language === 'en' ? 'Command Palette' : '命令面板'}</strong>
                <span>{language === 'en' ? 'Enter to execute first result' : '回车执行第一项结果'}</span>
              </div>
              <input
                className="command-palette-input"
                placeholder={language === 'en' ? 'Search commands...' : '搜索命令...'}
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && visibleCommands.length > 0) {
                    event.preventDefault();
                    runCommand(visibleCommands[0].id);
                  }
                }}
                autoFocus
              />
              <div className="command-palette-results">
                {visibleCommands.length === 0 ? (
                  <div className="command-empty">{language === 'en' ? 'No commands found' : '未找到命令'}</div>
                ) : (
                  visibleCommands.map((command) => (
                    <button
                      key={command.id}
                      className="command-item"
                      type="button"
                      onClick={() => runCommand(command.id)}
                    >
                      <span>{command.label}</span>
                      <em>{command.group}</em>
                    </button>
                  ))
                )}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
