# AgentGuard 开发路线图

本文档记录 AgentGuard 的产品规划、技术路线和开发优先级，确保开发者和 AI 协作者理解项目方向，避免偏离主线。

**最后更新**: 2026-03-16  
**当前版本**: 1.0.0 MVP

### 2026-03 决策补充（协作者必读）

- 产品定位从“SDK 优先”调整为“防火墙体验优先”：默认目标是接近杀毒软件的开箱即用感。
- 短期主线是 **Proxy 零配置接入 + 真实可见性**，而不是继续扩展 SDK 表层功能。
- 任何新功能若不能提升“无需改业务代码即可受保护”的比例，优先级降低。

#### 近期执行顺序（按优先级）

1. 一键 Proxy Setup 向导（已完成，持续优化）
2. 进程页真实可见性（已完成首版，持续提高精度）
3. 未受保护会话检测与告警（已完成首版，持续提高可信度）
4. 应用内自动拉起本地栈（已完成，可关闭）
5. Demo 稳定性与覆盖率证明（当前最高优先级）

#### 范围说明（避免误解）

- 当前“自动阻断/审批/告警”仅覆盖已接入 AgentGuard 的流量与事件。
- 当前版本还不是系统级全量监控（非 Endpoint Security 级别），但每个迭代都应向“更少配置、更高覆盖”靠拢。

---

## 一、产品愿景

**AgentGuard = AI Agent 运行时防火墙**

为本地运行的 AI Agent 提供独立的安全层，实时监控、风险评估、用户审批、审计追踪。

### 目标用户

- 开发者（使用 Cursor、Claude Code、Copilot CLI 等编码 Agent）
- 运行本地 LLM Agent 的用户（带文件系统/Shell 访问权限）
- 企业安全团队（需要 Agent 行为审计和策略管控）

### 长期目标

如果用户在本地运行 AI Agent，AgentGuard 应该像防火墙、密码管理器或终端保护工具一样成为标配。

---

## 二、当前状态（v1.0 MVP）

### ✅ 已完成的核心能力

| 模块 | 状态 | 说明 |
|------|------|------|
| **Rust Daemon** | ✅ 完成 | 本地守护进程，事件处理、审批管理 |
| **Policy Engine** | ✅ 完成 | 规则引擎、风险评估、决策逻辑 |
| **Desktop App (Tauri)** | ✅ 完成 | 审批弹窗、审计日志、规则管理、**规则模板系统** |
| **Python SDK** | ✅ 完成 | 文件/命令/HTTP 包装器、OpenAI Agents 集成 |
| **Proxy Service** | ✅ 完成 | OpenAI API 代理、透明拦截 |
| **审批流程** | ✅ 完成 | Allow/Deny 完整闭环 |
| **审计日志** | ✅ 完成 | 本地 SQLite 存储、查询接口 |
| **规则模板** | ✅ 完成 | 预定义安全策略模板，快速创建规则 |
| **Setup 向导** | ✅ 完成 | 一键启动本地栈、复制接入配置 |
| **进程监控** | ✅ 完成 | 真实系统进程、事件关联、风险分层、网络来源标记 |
| **Protection Alerts** | ✅ 完成 | 检测活跃 Agent 未受保护会话并提供修复动作 |

### 📦 项目结构

```
agentguard/
├── crates/
│   ├── agentguard-daemon/      # Rust 守护进程
│   ├── agentguard-policy/      # 策略引擎
│   ├── agentguard-proxy/       # API 代理服务
│   └── agentguard-store/       # 数据存储
├── apps/desktop/               # Tauri 桌面应用
├── sdks/
│   ├── python/                 # Python SDK
│   └── node/                   # Node.js SDK（核心能力已完成）
└── docs/                       # 文档
```

---

## 三、开发原则

### 核心优先级

```
1. Runtime Enforcement > Analytics      # 先做好拦截审批，再做数据分析
2. Semantic Coverage > OS-level         # 先 SDK 包装主流框架，再系统级监控
3. Local-first > Cloud                  # 核心逻辑本地运行，云仅用于同步
4. Clear Decisions > Rich UI            # 审批弹窗清晰直接，避免过度设计
```

### 避免的陷阱

❌ 过早追求系统级监控（需要 macOS entitlement，审批周期长）  
❌ 过度设计云功能（本地优先是差异化优势）  
❌ 支持太多 Agent 框架（先深耕 OpenAI 生态）  
❌ 复杂的风险评估算法（规则引擎已足够 MVP）

---

## 四、开发路线图

### Phase 1.1: 完善核心体验（1-2 周）

#### 1.1 规则管理系统

**目标**: 让用户可以可视化配置自定义策略

**功能清单**:
- [x] 规则列表视图（显示所有规则、优先级、状态）
- [x] 规则编辑器（创建/编辑/删除规则）
- [x] 规则导入/导出（JSON 格式）
- [x] 预设规则模板（首版已完成，持续扩充）
- [x] 规则优先级可视化（数字调整）
- [x] 规则冲突检测（高优先级覆盖低优先级提示）

**技术实现**:
```typescript
// 规则数据结构
interface Rule {
  id: string;
  name: string;
  layer: 'prompt' | 'tool' | 'command';
  operation: OperationType;
  pattern: MatchPattern;
  action: 'allow' | 'deny' | 'ask';
  risk: RiskLevel;
  priority: number;
  enabled: boolean;
  description?: string;
}

// API 端点
GET  /api/rules          # 获取所有规则
POST /api/rules          # 创建规则
PUT  /api/rules/:id      # 更新规则
DELETE /api/rules/:id    # 删除规则
POST /api/rules/import   # 导入规则
GET  /api/rules/export   # 导出规则
```

**验收标准**:
- 用户可以在桌面应用中创建新规则
- 规则立即生效（无需重启 daemon）
- 导出的规则文件可在其他机器导入
- 预设模板一键应用

### 📋 规则模板系统（v1.1 新增）

**目标**: 降低用户创建安全策略的门槛，提供开箱即用的最佳实践

**功能清单**:
- ✅ 模板选择模态框（网格布局展示所有可用模板）
- ✅ 预定义模板库（5 个常用安全策略模板）
  - Block shell escape（阻止 Shell 逃逸）
  - Block network tools（阻止网络工具）
  - Block file deletion（阻止文件删除）
  - Warn on env access（环境变量访问警告）
  - Allow safe reads（允许安全文件读取）
- ✅ 模板详情展示（名称、描述、优先级、层级、操作类型）
- ✅ 一键应用模板（自动填充规则编辑器）
- ✅ 模板自定义（用户可修改模板生成的规则）

**技术实现**:
```typescript
// 模板数据结构
interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  template: Omit<RuleDraft, "id" | "reason">;
}

// 模板应用流程
function handleCreateFromTemplate(templateId: string) {
  const template = ruleTemplates.find(t => t.id === templateId);
  setRuleDraft({
    ...template.template,
    id: "new",
    reason: `Created from template: ${template.name}`,
  });
  setShowTemplateModal(false);
  setShowAddRuleModal(true);
}
```

**验收标准**:
- ✅ 用户点击"📋 From template"按钮可打开模板选择器
- ✅ 模板卡片显示完整信息（名称、描述、优先级、层级）
- ✅ 选择模板后自动打开规则编辑器并填充字段
- ✅ 用户可修改模板生成的规则后再保存
- ✅ 模板功能有完整的文档说明

---

#### 1.2 审计日志增强

**目标**: 提供基础的安全审计和事件追溯能力

**功能清单**:
- [x] 时间线视图（按时间顺序显示所有事件）
- [x] 事件详情面板（完整事件数据、决策原因）
- [x] 搜索和过滤（按 agent、操作、风险等级、时间范围）
- [x] 导出审计日志（CSV/JSON 格式）
- [x] 统计面板（今日拦截数、高频操作、风险分布）
- [ ] 事件标记（标记为误报、已处理、需要关注）

**技术实现**:
```rust
// 审计记录查询接口
pub struct AuditQuery {
    pub agent_name: Option<String>,
    pub operation: Option<Operation>,
    pub action: Option<EnforcementAction>,
    pub risk_level: Option<RiskLevel>,
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

impl AuditStore {
    pub fn query(&self, query: AuditQuery) -> Result<Vec<AuditRecord>>;
    pub fn export_csv(&self, query: AuditQuery) -> Result<String>;
    pub fn statistics(&self, range: TimeRange) -> Result<AuditStats>;
}
```

**验收标准**:
- 用户可以查看过去 7 天的所有事件
- 支持按 agent 名称过滤
- 导出 CSV 可在 Excel 中打开
- 统计面板显示今日拦截数、批准数、拒绝数

---

#### 1.3 Node.js/TypeScript SDK

**目标**: 覆盖 Node.js 生态的 Agent 开发者

**当前状态（2026-03）**: 核心能力已完成（client + 文件/命令/HTTP 包装器 + 类型与错误模型），后续补齐浏览器包装器与更多生态集成。

**功能清单**:
- [x] 基础客户端（与 Python SDK 对等的 API）
- [x] 文件操作包装器（`guardedReadFile`, `guardedWriteFile`）
- [x] 命令执行包装器（`guardedExecCommand`）
- [x] HTTP 请求包装器（`guardedFetch`）
- [ ] 浏览器操作包装器（`guardedBrowserOpen`）
- [ ] OpenAI Agents SDK 集成
- [x] 自动 Agent 身份识别（从进程上下文推断）

**技术实现**:
```typescript
// SDK 入口
import { AgentGuardClient, guardedExecCommand } from '@agentguard/sdk';

const client = new AgentGuardClient({
  baseUrl: 'http://127.0.0.1:8790',
  agent: 'my-agent',
});

// 包装的命令执行
const result = await guardedExecCommand(client, ['ls', '-la'], {
  waitForApprovalMs: 30000,
});

// 异常处理
import { PolicyDeniedError, PendingApprovalError } from '@agentguard/sdk';

try {
  await guardedExecCommand(client, ['rm', '-rf', '/tmp/test']);
} catch (error) {
  if (error instanceof PolicyDeniedError) {
    console.error('请求被拒绝:', error.record.decision.reason);
  }
}
```

**目录结构**:
```
sdks/node/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # 导出所有公共 API
│   ├── client.ts          # AgentGuardClient 类
│   ├── wrappers.ts        # 包装器函数
│   ├── errors.ts          # 异常类定义
│   ├── types.ts           # TypeScript 类型定义
│   └── openai-agent.ts    # OpenAI 集成
└── test/
    └── index.test.ts      # 单元测试
```

**验收标准**:
- API 设计与 Python SDK 保持一致
- 支持 TypeScript 和 JavaScript
- 提供完整的类型定义
- 包含单元测试和集成测试
- 发布到 npm（`@agentguard/sdk`）

---

### Phase 1.2: 扩大覆盖范围（2-4 周）

#### 1.4 支持更多 Agent 框架

**目标**: 覆盖主流 Agent 开发框架

**优先级排序**:
1. **Claude Code** (高优先级)
   - 拦截 `bash`、`read_file`、`write_file`、`glob` 操作
   - 通过包装 Claude Code 的 tool 执行层实现

2. **Cursor IDE** (高优先级)
   - VS Code 扩展拦截 Agent 操作
   - 与桌面应用通信进行审批

3. **LangChain** (中优先级)
   - 包装 `Tool` 基类
   - 自动拦截所有 Tool 调用

4. **LlamaIndex** (中优先级)
   - 包装 `FunctionTool`
   - 拦截工具执行

**技术实现示例（LangChain）**:
```python
from langchain.tools import Tool
from agentguard_sdk import guarded_exec_command, guarded_read_file

class AgentGuardTool(Tool):
    def __init__(self, tool: Tool, client: AgentGuardClient):
        self.tool = tool
        self.client = client
    
    def run(self, input: str) -> str:
        if self.tool.name == "shell":
            return guarded_exec_command(self.client, input).value.stdout
        elif self.tool.name == "read_file":
            return guarded_read_file(self.client, input).value
        else:
            return self.tool.run(input)
```

**验收标准**:
- 每个框架有独立的集成模块
- 提供示例代码和文档
- 不修改原框架代码，通过包装器实现

---

#### 1.5 Prompt Guard 层

**目标**: 检测和拦截提示词注入、RAG 投毒等风险

**功能清单**:
- [ ] 提示词注入检测（系统提示词篡改检测）
- [ ] RAG 内容毒性扫描（恶意链接、危险指令）
- [ ] 模型输出风险评估（危险建议、敏感信息）
- [ ] 敏感信息脱敏（API Key、凭证、个人信息）

**技术实现**:
```rust
// Prompt Guard 事件类型
pub enum PromptEvent {
    UserPrompt { content: String, source: String },
    RetrievedContent { documents: Vec<Document> },
    ModelOutput { content: String, model: String },
    ToolArguments { tool: String, args: Value },
}

// 检测规则
pub struct PromptRule {
    pub pattern: Regex,
    pub risk: RiskLevel,
    pub action: EnforcementAction,
    pub description: String,
}

// 示例规则
let rules = vec![
    PromptRule {
        pattern: Regex::new(r"(?i)ignore.*instructions").unwrap(),
        risk: RiskLevel::High,
        action: EnforcementAction::Block,
        description: "提示词注入尝试".into(),
    },
    PromptRule {
        pattern: Regex::new(r"sk-[a-zA-Z0-9]{32,}").unwrap(),
        risk: RiskLevel::Critical,
        action: EnforcementAction::Mask,
        description: "API Key 泄露风险".into(),
    },
];
```

**验收标准**:
- 检测常见提示词注入模式
- 自动脱敏输出中的敏感信息
- 不显著增加延迟（< 50ms）

---

#### 1.6 隐私沙盒

**目标**: 自动保护敏感资源和数据

**功能清单**:
- [ ] 敏感路径自动保护（`~/.ssh`、`.env`、`~/.aws`、`~/.git-credentials`）
- [ ] 环境变量隔离（阻止读取敏感 env vars）
- [ ] 网络访问白名单（仅允许特定域名）
- [ ] 剪贴板保护（阻止敏感数据复制）

**技术实现**:
```rust
// 敏感路径配置
pub struct PrivacySandbox {
    protected_paths: Vec<PathBuf>,
    protected_env_vars: Vec<String>,
    allowed_domains: Vec<String>,
}

impl PrivacySandbox {
    pub fn is_protected_path(&self, path: &Path) -> bool {
        self.protected_paths.iter().any(|p| path.starts_with(p))
    }
    
    pub fn is_protected_env(&self, key: &str) -> bool {
        self.protected_env_vars.iter().any(|v| key == v || key.starts_with(v))
    }
}

// 默认保护列表
fn default_protected_paths() -> Vec<PathBuf> {
    vec![
        dirs::home_dir().unwrap().join(".ssh"),
        dirs::home_dir().unwrap().join(".aws"),
        dirs::home_dir().unwrap().join(".git-credentials"),
        PathBuf::from("/etc/passwd"),
        PathBuf::from("/etc/shadow"),
    ]
}

fn default_protected_env_vars() -> Vec<String> {
    vec![
        "AWS_SECRET_ACCESS_KEY".into(),
        "OPENAI_API_KEY".into(),
        "GITHUB_TOKEN".into(),
        "DATABASE_URL".into(),
    ]
}
```

**验收标准**:
- 默认保护常见敏感路径
- 用户可自定义保护列表
- 尝试访问时触发审批弹窗

---

### Phase 2: 平台级能力（1-2 个月）

#### 2.1 系统级监控（需要 macOS entitlement）

**目标**: 不依赖 SDK 包装，直接监控系统级事件

**功能清单**:
- [ ] macOS Endpoint Security API 集成
- [ ] 文件系统监控（FSEvents）
- [ ] 进程行为观察（进程创建、信号、退出）
- [ ] 网络活动拦截（Network Extension）

**技术实现**:
```rust
// macOS Endpoint Security 客户端
use endpoint_security::{Client, Event, EventType};

pub struct SystemMonitor {
    client: Client,
}

impl SystemMonitor {
    pub fn new() -> Result<Self> {
        let client = Client::new()?;
        Ok(Self { client })
    }
    
    pub fn subscribe_events(&mut self) -> Result<mpsc::Receiver<Event>> {
        // 订阅文件访问、进程执行、网络事件
        self.client.subscribe(EventType::FileOpen)?;
        self.client.subscribe(EventType::Exec)?;
        self.client.subscribe(EventType::Network)?;
        
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            while let Ok(event) = client.next_event() {
                tx.send(event).unwrap();
            }
        });
        
        Ok(rx)
    }
}
```

**注意事项**:
- 需要 Apple 特殊 entitlement（`com.apple.endpoint-security.client`）
- 申请周期可能长达数周
- MVP 阶段不依赖此功能

---

#### 2.2 智能风险评估

**目标**: 基于上下文的动态风险评分

**功能清单**:
- [ ] 上下文感知（工作目录、时间、历史行为）
- [ ] 异常检测（偏离正常模式）
- [ ] 风险评分模型（多因素加权）
- [ ] 自适应学习（用户行为学习）

**风险评分模型**:
```rust
pub struct RiskCalculator {
    base_weights: Weights,
    context_factors: ContextFactors,
}

pub struct RiskScore {
    pub level: RiskLevel,
    pub score: f32,  // 0.0 - 100.0
    pub factors: Vec<RiskFactor>,
}

pub enum RiskFactor {
    SensitivePath,
    DestructiveCommand,
    UnusualTime,
    NewAgent,
    NetworkExfil,
    PrivilegeEscalation,
}

impl RiskCalculator {
    pub fn calculate(&self, event: &Event, context: &Context) -> RiskScore {
        let mut score = 0.0;
        let mut factors = vec![];
        
        // 基础风险
        if self.is_sensitive_path(&event.target) {
            score += 30.0;
            factors.push(RiskFactor::SensitivePath);
        }
        
        // 上下文风险
        if context.is_unusual_time() {
            score += 15.0;
            factors.push(RiskFactor::UnusualTime);
        }
        
        // 历史行为
        if !context.has_seen_this_operation(&event.agent) {
            score += 20.0;
            factors.push(RiskFactor::NewAgent);
        }
        
        RiskScore {
            level: self.score_to_level(score),
            score,
            factors,
        }
    }
}
```

---

#### 2.3 企业功能

**目标**: 支持团队和企业部署

**功能清单**:
- [ ] 集中式策略管理（云端策略同步）
- [ ] 远程审计日志聚合（日志上传到中央服务器）
- [ ] 团队规则同步（共享规则库）
- [ ] SSO/LDAP 集成（企业身份认证）
- [ ] 多设备管理（统一控制台）

**技术实现**:
```rust
// 企业版配置
pub struct EnterpriseConfig {
    pub policy_server_url: String,
    pub api_key: String,
    pub organization_id: String,
    pub sync_interval: Duration,
}

pub struct PolicySync {
    config: EnterpriseConfig,
    local_engine: PolicyEngine,
}

impl PolicySync {
    pub async fn sync_from_server(&self) -> Result<()> {
        let remote_rules = reqwest::get(&format!(
            "{}/api/v1/policies/{}",
            self.config.policy_server_url,
            self.config.organization_id
        ))
        .send()
        .await?
        .json::<Vec<Rule>>()
        .await?;
        
        // 合并远程规则到本地
        self.local_engine.merge_rules(remote_rules)?;
        Ok(())
    }
}
```

---

### Phase 3: 生态建设（3-6 个月）

#### 3.1 开发者体验

**CLI 工具 (`agentguardctl`)**:
```bash
# 查看状态
agentguardctl status

# 管理规则
agentguardctl rules list
agentguardctl rules add --name "allow-git" --action allow --operation exec --pattern "git.*"
agentguardctl rules import ./rules.yaml

# 查询审计日志
agentguardctl audit query --agent "Claude Code" --since 1h
agentguardctl audit export --format csv --output ./audit.csv

# 测试策略
agentguardctl test --event '{"operation":"exec_command","target":"rm -rf ~"}'
```

**VS Code 扩展**:
- 状态栏显示（AgentGuard 运行状态）
- 快速审批（允许/拒绝当前请求）
- 审计日志查看器
- 规则快速编辑

**文档站点**:
- 安装指南
- API 参考文档
- 最佳实践
- 示例代码库

---

#### 3.2 分发和商业化

**分发渠道**:
- [ ] Homebrew Cask (`brew install --cask agentguard`)
- [ ] Mac App Store（沙盒版本）
- [ ] 官网下载（dmg 直接安装）
- [ ] Linux 包（deb、rpm）

**商业模式**:
- **个人版**: 免费（本地功能完整）
- **专业版**: $9/月（云同步、多设备、高级规则）
- **企业版**: 定制报价（集中管理、API、SLA）

---

## 五、技术架构决策

### 为什么选择 Rust？

- 低延迟拦截和决策（性能关键）
- 内存安全（安全敏感场景）
- 跨平台抽象（进程、文件、网络）
- 统一语言（daemon、proxy、核心逻辑）

### 为什么选择 Tauri？

- 原生桌面体验
- 小体积（相比 Electron）
- 能力模型（限制桌面端权限）
- 前端快速迭代（TypeScript）

### 为什么 SDK 优先？

- 快速覆盖主流 Agent 框架
- 不依赖操作系统 entitlement
- 语义级事件（比系统级更清晰）
- 开发者友好（易于集成）

---

## 六、测试策略

### 单元测试

```rust
// 策略引擎测试
#[cfg(test)]
mod tests {
    #[test]
    fn test_deny_home_wipe() {
        let engine = PolicyEngine::with_default_rules();
        let event = Event::exec_command("rm", "-rf ~");
        let decision = engine.evaluate(&event);
        assert_eq!(decision.action, EnforcementAction::Block);
        assert_eq!(decision.risk, RiskLevel::Critical);
    }
}
```

### 集成测试

```python
# SDK 集成测试
def test_guarded_exec_command_approval():
    client = AgentGuardClient(base_url='http://127.0.0.1:8790')
    result = guarded_exec_command(client, ['echo', 'hello'])
    assert result.value.returncode == 0
    assert 'hello' in result.value.stdout
```

### E2E 测试

```typescript
// 桌面应用 E2E 测试
test('审批流程完整闭环', async () => {
  // 1. 触发审批请求
  await runDemoAgent();
  
  // 2. 等待弹窗出现
  const modal = await page.waitForSelector('.approval-modal');
  
  // 3. 点击批准
  await page.click('.button-approve');
  
  // 4. 验证命令执行成功
  const output = await getTerminalOutput();
  expect(output).toContain('agentguard-live-demo');
});
```

---

## 七、性能指标

### 目标延迟

| 操作 | 目标延迟 | 说明 |
|------|----------|------|
| 规则匹配 | < 10ms | 单次事件评估 |
| 审批弹窗显示 | < 500ms | 从事件触发到弹窗可见 |
| 用户批准后执行 | < 100ms | 从批准到命令实际执行 |
| 审计日志写入 | < 10ms | 异步写入，不阻塞主流程 |

### 资源占用

| 指标 | 目标值 | 说明 |
|------|--------|------|
| Daemon 内存 | < 100MB | 空闲状态 |
| Desktop 内存 | < 200MB | 打开状态 |
| CPU 占用 | < 1% | 无事件时 |
| 磁盘占用 | < 500MB | 包含所有二进制文件 |

---

## 八、安全考虑

### 威胁模型

**防护的攻击类型**:
- 提示词注入和角色覆盖
- RAG 投毒和恶意文档
- 危险 Shell 命令
- 凭证和密钥泄露
- 工具滥用和越权
- 文件/网络/数据库的意外操作

**不防护的场景**:
- 模型输出事实错误
- 企业 IAM 和权限管理
- 完全替代杀毒软件

### 安全实践

- 所有 IPC 通信使用 Unix Socket（本地）
- 审计日志不可篡改（追加写入）
- 敏感数据加密存储（密钥环）
- 最小权限原则（Tauri capabilities）
- 定期安全审计和渗透测试

---

## 九、贡献指南

### 开发环境设置

```bash
# 克隆仓库
git clone https://github.com/agentguard/agentguard.git
cd agentguard

# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装 Node.js 和 pnpm
brew install node
npm install -g pnpm

# 安装依赖
pnpm install

# 构建项目
pnpm build

# 运行测试
pnpm test

# 启动本地开发环境
./scripts/bootstrap-local.sh
```

### 提交规范

```
feat: 添加新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式调整
refactor: 重构代码
test: 添加测试
chore: 构建/工具链更新
```

### PR 流程

1. Fork 仓库
2. 创建功能分支（`feature/xxx`）
3. 提交代码（遵循提交规范）
4. 运行测试（`pnpm test`）
5. 创建 Pull Request
6. 等待 Code Review
7. 合并到主分支

---

## 十、常见问题

### Q: 为什么不直接做系统级监控？

A: macOS 的 Endpoint Security API 需要特殊 entitlement，申请周期长。SDK 方案可以快速覆盖主流框架，且不依赖操作系统特权。

### Q: 如何保证 daemon 本身不被攻击？

A: 
- daemon 以当前用户权限运行（非 root）
- 所有 IPC 通信经过认证
- 审计日志追加写入（不可篡改）
- 最小权限原则

### Q: 支持 Windows 和 Linux 吗？

A: 当前优先支持 macOS（开发者主力平台）。Linux 和 Windows 支持在 Phase 2 规划中。

### Q: 云同步会上传敏感数据吗？

A: 不会。云同步仅同步规则配置，审计日志默认本地存储。企业版的日志上传是可选功能。

---

## 附录 A: 术语表

| 术语 | 定义 |
|------|------|
| **Agent** | 执行任务的 AI 程序（如 Claude Code、Cursor） |
| **Layer** | 防护层（Prompt/Tool/Command） |
| **Operation** | 具体操作类型（exec_command、read_file 等） |
| **EnforcementAction** | 执行动作（Allow/Deny/Ask/Block） |
| **RiskLevel** | 风险等级（Low/Medium/High/Critical） |
| **AuditRecord** | 审计记录（事件 + 决策 + 上下文） |

---

## 附录 B: 参考资源

- [Rust 编程指南](https://doc.rust-lang.org/book/)
- [Tauri 文档](https://tauri.app/)
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-python)
- [macOS Endpoint Security](https://developer.apple.com/documentation/endpointsecurity)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

**维护者**: AgentGuard Team  
**许可证**: MIT
