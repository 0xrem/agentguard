import { useState } from 'react';
import { useLanguage } from '../i18n';
import { loadProcesses, queryAuditLogs } from '../api';
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
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<{
    checkedAt: number;
    passed: boolean;
    summary: string;
    items: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; detail: string }>;
  } | null>(null);

  const isDaemonRunning = !!runtimeEnvironment?.daemon_source;
  const isProxyRunning = !!runtimeEnvironment?.proxy_source;
  const isStackReady = isDaemonRunning && isProxyRunning;
  const proxyUrl = runtimeEnvironment?.proxy_source
    ? 'http://127.0.0.1:8787'
    : 'http://127.0.0.1:8787'; // always the same port

  const step1Done = isStackReady;
  const step2Done = step1Done; // just picking a tool, always valid

  async function handleVerifyIntegration() {
    setVerifying(true);
    try {
      const now = Date.now();
      const items: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; detail: string }> = [];

      if (!isStackReady) {
        items.push({
          name: 'Runtime Stack',
          status: 'fail',
          detail: 'Daemon/Proxy 未就绪，无法完成接入验收。请先启动本地栈。',
        });
      } else {
        items.push({
          name: 'Runtime Stack',
          status: 'pass',
          detail: 'Daemon + Proxy 均在线。',
        });
      }

      const processes = await loadProcesses(120);
      const agentLike = processes.filter((p) => p.isAgentLike);
      const protectedAgents = agentLike.filter((p) => p.coverageStatus === 'protected');
      const highRiskUnprotected = agentLike.filter(
        (p) => p.risk === 'high' && p.coverageStatus !== 'protected',
      );

      if (agentLike.length === 0) {
        items.push({
          name: 'Agent Process Discovery',
          status: 'warn',
          detail: '暂未识别到 Agent 进程，请先启动你的 Agent 工具再验收。',
        });
      } else if (protectedAgents.length === 0) {
        items.push({
          name: 'Agent Coverage',
          status: 'fail',
          detail: `已识别 ${agentLike.length} 个 Agent，但尚无受保护会话。`,
        });
      } else {
        items.push({
          name: 'Agent Coverage',
          status: highRiskUnprotected.length > 0 ? 'warn' : 'pass',
          detail:
            highRiskUnprotected.length > 0
              ? `已保护 ${protectedAgents.length}/${agentLike.length}，但有 ${highRiskUnprotected.length} 个高风险 Agent 未保护。`
              : `已保护 ${protectedAgents.length}/${agentLike.length} 个 Agent 会话。`,
        });
      }

      const records = await queryAuditLogs({
        start_time: now - 10 * 60 * 1000,
        end_time: now,
        limit: 60,
        offset: 0,
      });
      const realRecords = records.filter((record) => record.event.metadata?.source !== 'browser_preview');
      items.push({
        name: 'Recent Audit Activity (10m)',
        status: realRecords.length > 0 ? 'pass' : 'warn',
        detail:
          realRecords.length > 0
            ? `检测到 ${realRecords.length} 条真实审计事件（非预览数据）。`
            : '近 10 分钟暂无真实审计事件，请触发一次 Agent 操作后重试。',
      });

      const expectedFamily =
        activeTool === 'claude-code'
          ? 'claude'
          : activeTool === 'cursor'
            ? 'cursor'
            : activeTool === 'python'
              ? 'generic'
              : null;

      if (expectedFamily) {
        const familyActive = agentLike.some((p) => p.agentFamily === expectedFamily || (expectedFamily === 'generic' && p.agentFamily !== 'unknown'));
        items.push({
          name: 'Selected Tool Validation',
          status: familyActive ? 'pass' : 'warn',
          detail: familyActive
            ? `已识别到与当前工具（${activeTool}）相关的 Agent 进程。`
            : `尚未识别到与当前工具（${activeTool}）相关的活跃进程。`,
        });
      }

      const hasFail = items.some((item) => item.status === 'fail');
      const hasWarn = items.some((item) => item.status === 'warn');
      setVerification({
        checkedAt: now,
        passed: !hasFail,
        summary: hasFail
          ? '验收未通过：请先修复失败项。'
          : hasWarn
            ? '验收部分通过：建议处理告警项后再上线。'
            : '验收通过：接入已生效，可进入持续监控。',
        items,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      setVerification({
        checkedAt: Date.now(),
        passed: false,
        summary: '验收执行失败',
        items: [
          {
            name: 'Verification Runner',
            status: 'fail',
            detail: `无法完成自动验收：${message}`,
          },
        ],
      });
    } finally {
      setVerifying(false);
    }
  }

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

      {/* 步骤 4: 一键验收 */}
      <div className={`setup-step ${!step1Done ? 'setup-step-disabled' : 'setup-step-active'}`}>
        <div className="setup-step-header">
          <div className={`setup-step-badge ${verification?.passed ? 'done' : !step1Done ? 'disabled' : 'active'}`}>
            {verification?.passed ? '✓' : '4'}
          </div>
          <div>
            <h2 className="setup-step-title">一键验收接入是否生效</h2>
            <p className="setup-step-desc">自动检测覆盖状态、审计活跃度和当前工具命中情况，给出通过/告警/失败结论。</p>
          </div>
        </div>

        {step1Done ? (
          <>
            <button className="btn btn-primary" onClick={handleVerifyIntegration} disabled={verifying}>
              {verifying ? '正在验收...' : '开始验收'}
            </button>

            {verification && (
              <div className={`setup-verification ${verification.passed ? 'pass' : 'warn'}`}>
                <div className="setup-verification-header">
                  <strong>{verification.summary}</strong>
                  <span>{new Date(verification.checkedAt).toLocaleTimeString()}</span>
                </div>
                <div className="setup-verification-list">
                  {verification.items.map((item, index) => (
                    <div key={`${item.name}-${index}`} className={`setup-verification-item ${item.status}`}>
                      <div className="setup-verification-item-title">
                        <span>{item.status === 'pass' ? '✅' : item.status === 'warn' ? '⚠️' : '⛔'}</span>
                        <span>{item.name}</span>
                      </div>
                      <div className="setup-verification-item-detail">{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="setup-step-placeholder">请先完成步骤 1（启动本地栈）后再验收。</p>
        )}
      </div>
    </div>
  );
}
