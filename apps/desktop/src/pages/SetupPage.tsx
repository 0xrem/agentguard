import { useState } from 'react';
import { useLanguage } from '../i18n';
import type { RuntimeEnvironment, RuntimeStartResult } from '../types';

type ToolTab = 'shell' | 'claude-code' | 'cursor' | 'python' | 'dotenv';

interface SetupPageProps {
  runtimeEnvironment: RuntimeEnvironment | null;
  onStartLocalStack: () => Promise<unknown>;
  startingStack: boolean;
  stackResult: RuntimeStartResult | null;
}

const TOOL_TABS: Array<{ id: ToolTab; icon: string; label: string }> = [
  { id: 'shell',       icon: '🐚', label: 'Terminal / Shell' },
  { id: 'claude-code', icon: '🤖', label: 'Claude Code' },
  { id: 'cursor',      icon: '✏️', label: 'Cursor' },
  { id: 'python',      icon: '🐍', label: 'Python' },
  { id: 'dotenv',      icon: '📄', label: '.env file' },
];

function CodeBlock({ code, language = 'bash' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="setup-code-block">
      <div className="setup-code-header">
        <span className="setup-code-lang">{language}</span>
        <button className="setup-copy-btn" onClick={handleCopy}>
          {copied ? '✅ Copied!' : '📋 Copy'}
        </button>
      </div>
      <pre className="setup-code-pre"><code>{code}</code></pre>
    </div>
  );
}

function ToolInstructions({ tool, proxyUrl }: { tool: ToolTab; proxyUrl: string }) {
  switch (tool) {
    case 'shell':
      return (
        <div className="setup-instructions">
          <p className="setup-instructions-desc">
            Add these lines to your shell profile (<code>~/.zshrc</code> or <code>~/.bashrc</code>),
            then restart your terminal. Any OpenAI-compatible tool will automatically route through AgentGuard.
          </p>
          <CodeBlock code={`export OPENAI_BASE_URL="${proxyUrl}"\nexport OPENAI_API_KEY="<your-openai-key>"  # still required`} language="bash" />
          <p className="setup-instructions-tip">
            💡 Or set it temporarily for a single session: run the <code>export</code> commands before launching your AI tool.
          </p>
        </div>
      );

    case 'claude-code':
      return (
        <div className="setup-instructions">
          <p className="setup-instructions-desc">
            Claude Code reads <code>OPENAI_BASE_URL</code> from your environment. Launch it with the proxy pre-configured:
          </p>
          <CodeBlock code={`OPENAI_BASE_URL="${proxyUrl}" claude`} language="bash" />
          <p className="setup-instructions-desc">
            Or add it permanently to your shell profile:
          </p>
          <CodeBlock code={`# ~/.zshrc\nexport OPENAI_BASE_URL="${proxyUrl}"`} language="bash" />
          <p className="setup-instructions-tip">
            💡 Once set, every Claude Code session — and every file read, write, and command it executes — is inspected by AgentGuard in real time.
          </p>
        </div>
      );

    case 'cursor':
      return (
        <div className="setup-instructions">
          <p className="setup-instructions-desc">
            In Cursor, go to <strong>Settings → Cursor Settings → Models</strong> and set the OpenAI Base URL:
          </p>
          <CodeBlock code={proxyUrl} language="url" />
          <p className="setup-instructions-desc">
            Or launch Cursor from the terminal with the env var pre-set:
          </p>
          <CodeBlock code={`OPENAI_BASE_URL="${proxyUrl}" cursor .`} language="bash" />
          <p className="setup-instructions-tip">
            💡 After this, all Cursor Composer and Chat API calls are inspected and can be blocked or queued for your approval.
          </p>
        </div>
      );

    case 'python':
      return (
        <div className="setup-instructions">
          <p className="setup-instructions-desc">
            Pass <code>base_url</code> to the OpenAI client, or set the environment variable — no other code changes needed.
          </p>
          <CodeBlock code={`from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${proxyUrl}",\n    # api_key is forwarded by AgentGuard automatically\n)`} language="python" />
          <p className="setup-instructions-desc">
            Or keep your existing code untouched and just set the env var before running:
          </p>
          <CodeBlock code={`OPENAI_BASE_URL="${proxyUrl}" python your_agent.py`} language="bash" />
        </div>
      );

    case 'dotenv':
      return (
        <div className="setup-instructions">
          <p className="setup-instructions-desc">
            Add one line to your project's <code>.env</code> file. Works with any framework that reads <code>.env</code> (dotenv, python-dotenv, Next.js, etc.):
          </p>
          <CodeBlock code={`OPENAI_BASE_URL="${proxyUrl}"`} language="dotenv" />
          <p className="setup-instructions-tip">
            💡 No code changes required — just the env var. Don't forget to add <code>.env</code> to <code>.gitignore</code> if it also contains your API key.
          </p>
        </div>
      );
  }
}

export function SetupPage({
  runtimeEnvironment,
  onStartLocalStack,
  startingStack,
  stackResult,
}: SetupPageProps) {
  const { t } = useLanguage();
  const [activeTool, setActiveTool] = useState<ToolTab>('shell');

  const isDaemonRunning = !!runtimeEnvironment?.daemon_source;
  const isProxyRunning = !!runtimeEnvironment?.proxy_source;
  const isStackReady = isDaemonRunning && isProxyRunning;
  const proxyUrl = runtimeEnvironment?.proxy_source
    ? 'http://127.0.0.1:8787'
    : 'http://127.0.0.1:8787'; // always the same port

  const step1Done = isStackReady;
  const step2Done = step1Done; // just picking a tool, always valid

  return (
    <div className="setup-page">
      <header className="page-header">
        <div className="page-title">
          <h1>🛡️ {t.setup.title}</h1>
          <p>{t.setup.subtitle}</p>
        </div>
      </header>

      {/* 步骤 1: 启动服务 */}
      <div className={`setup-step ${step1Done ? 'setup-step-done' : 'setup-step-active'}`}>
        <div className="setup-step-header">
          <div className={`setup-step-badge ${step1Done ? 'done' : 'active'}`}>
            {step1Done ? '✓' : '1'}
          </div>
          <div>
            <h2 className="setup-step-title">{t.setup.step1Title}</h2>
            <p className="setup-step-desc">{t.setup.step1Desc}</p>
          </div>
        </div>

        <div className="setup-status-row">
          <div className={`setup-status-pill ${isDaemonRunning ? 'online' : 'offline'}`}>
            <span className="setup-status-dot" />
            Daemon — {isDaemonRunning ? t.dashboard.daemonRunning : t.dashboard.daemonStopped}
          </div>
          <div className={`setup-status-pill ${isProxyRunning ? 'online' : 'offline'}`}>
            <span className="setup-status-dot" />
            Proxy — {isProxyRunning ? t.dashboard.proxyRunning : t.dashboard.proxyStopped}
          </div>
        </div>

        {!isStackReady && (
          <button
            className="btn btn-primary setup-start-btn"
            onClick={onStartLocalStack}
            disabled={startingStack}
          >
            {startingStack ? t.common.loading : t.setup.startBtn}
          </button>
        )}

        {stackResult && (
          <div className={`setup-result-banner ${isStackReady ? 'success' : 'error'}`}>
            {stackResult.message}
          </div>
        )}

        {isStackReady && (
          <div className="setup-proxy-url-row">
            <span className="setup-proxy-label">{t.setup.proxyListening}</span>
            <code className="setup-proxy-url">{proxyUrl}</code>
          </div>
        )}
      </div>

      {/* 步骤 2: 选择工具 */}
      <div className={`setup-step ${!step1Done ? 'setup-step-disabled' : step2Done ? 'setup-step-done' : 'setup-step-active'}`}>
        <div className="setup-step-header">
          <div className={`setup-step-badge ${!step1Done ? 'disabled' : 'active'}`}>2</div>
          <div>
            <h2 className="setup-step-title">{t.setup.step2Title}</h2>
            <p className="setup-step-desc">{t.setup.step2Desc}</p>
          </div>
        </div>

        <div className="setup-tool-tabs">
          {TOOL_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`setup-tool-tab ${activeTool === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTool(tab.id)}
              disabled={!step1Done}
            >
              <span className="setup-tool-icon">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 步骤 3: 复制配置 */}
      <div className={`setup-step ${!step1Done ? 'setup-step-disabled' : 'setup-step-active'}`}>
        <div className="setup-step-header">
          <div className={`setup-step-badge ${!step1Done ? 'disabled' : 'active'}`}>3</div>
          <div>
            <h2 className="setup-step-title">{t.setup.step3Title}</h2>
            <p className="setup-step-desc">{t.setup.step3Desc}</p>
          </div>
        </div>

        {step1Done ? (
          <ToolInstructions tool={activeTool} proxyUrl={proxyUrl} />
        ) : (
          <p className="setup-step-placeholder">{t.setup.startFirst}</p>
        )}
      </div>

      {/* 完成提示 */}
      {isStackReady && (
        <div className="setup-done-banner">
          <div className="setup-done-icon">🎉</div>
          <div>
            <strong>{t.setup.doneTitle}</strong>
            <p>{t.setup.doneDesc}</p>
          </div>
        </div>
      )}
    </div>
  );
}
