# AgentGuard v1.1.0 发布说明

**发布日期**: 2026-03-15  
**版本类型**: 功能增强版本

---

## 🎉 新功能

### 📋 规则模板系统

本次发布引入了**规则模板系统**，让用户能够快速创建常见的安全策略，无需从头编写规则。

#### 功能特性

- **模板选择器**: 通过工具栏的 "📋 From template" 按钮访问
- **预定义模板库**: 包含 5 个常用安全策略模板
  - **Block shell escape**: 阻止 Shell 逃逸尝试（bash, sh, zsh 等）
  - **Block network tools**: 阻止网络工具（curl, wget, nc 等）
  - **Block file deletion**: 阻止危险文件删除操作（rm -rf 等）
  - **Warn on env access**: 环境变量访问警告
  - **Allow safe reads**: 允许项目目录内的安全文件读取
- **一键应用**: 选择模板后自动填充规则编辑器
- **完全自定义**: 用户可修改模板生成的所有字段

#### 使用示例

```typescript
// 1. 点击规则列表工具栏的 "📋 From template" 按钮
// 2. 选择需要的模板（例如 "Block shell escape"）
// 3. 系统自动打开规则编辑器，预填充以下字段：
{
  action: "block",
  priority: 900,
  layer: "command",
  operation: "exec_command",
  minimum_risk: "low",
  agent_value: "*",
  target_value: "*",
  reason: "Created from template: Block shell escape"
}
// 4. 根据需要调整字段
// 5. 点击保存，规则立即生效
```

#### 技术实现

- **React 状态管理**: 使用 `useState` 管理模板选择器显示状态
- **模态框 UI**: 网格布局展示所有可用模板
- **类型安全**: TypeScript 严格类型定义确保数据结构正确
- **文档完善**: 关键函数和数据结构均包含详细注释

---

## 📝 文档更新

### README.md

- 新增 "Rule Templates" 章节
- 说明模板功能的使用方法和预定义模板列表
- 更新 Desktop Live Path 章节，提及模板系统

### docs/ROADMAP.md

- 更新 "已完成的核心能力" 表格
- 新增 "规则模板系统（v1.1 新增）" 详细章节
- 包含功能清单、技术实现代码示例、验收标准

### 代码注释

- `App.tsx`: 为 `ruleTemplates` 数组添加文档注释
- `App.tsx`: 为 `handleCreateFromTemplate` 函数添加文档注释
- 解释模板数据结构和应用流程

---

## 🔧 技术改进

### 前端 (apps/desktop/src/App.tsx)

- 新增 `ruleTemplates` 常量数组（包含 5 个预定义模板）
- 新增 `showTemplateModal` 和 `selectedTemplateId` 状态变量
- 新增 `handleCreateFromTemplate` 函数处理模板应用逻辑
- 新增模板选择器模态框 UI（网格布局、卡片样式）
- 工具栏新增 "📋 From template" 按钮
- 优化规则编辑器与模板选择器的状态流转

### 样式 (apps/desktop/src/styles.css)

- 模板卡片样式（悬停效果、边框、阴影）
- 模板网格布局（响应式设计）
- 模板详情展示（名称、描述、优先级标签）

---

## 🧪 测试验证

- ✅ 开发服务器正常启动（端口 1420）
- ✅ 模板选择器 UI 渲染正常
- ✅ 模板卡片信息显示完整
- ✅ "From template" 按钮点击响应正常
- ✅ 模板应用后规则编辑器正确填充
- ✅ 无编译错误或运行时警告

---

## 📦 安装与升级

### 开发环境

```bash
# 进入桌面应用目录
cd apps/desktop

# 启动开发服务器
pnpm dev

# 访问 http://127.0.0.1:1420/
```

### 生产环境

```bash
# 构建生产版本
pnpm build

# 预览生产构建
pnpm preview
```

---

## 🎯 下一版本计划 (v1.2)

- [ ] 支持用户自定义模板（保存常用规则为模板）
- [ ] 模板导入/导出功能（分享模板文件）
- [ ] 模板市场（社区贡献的模板库）
- [ ] 模板分类和标签（按场景、风险等级筛选）
- [ ] 模板预览功能（应用前查看完整规则详情）

---

## 🙏 致谢

感谢所有为 AgentGuard 贡献代码、反馈问题和分享使用场景的开发者！

---

**完整变更日志**: 查看 [GitHub Releases](https://github.com/agentguard/agentguard/releases)
