// 导航相关类型
export type Page = 'dashboard' | 'audit' | 'processes' | 'rules' | 'settings' | 'setup';

export interface NavItem {
  id: Page;
  label: string;
  labelZh: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', labelZh: '仪表盘', icon: '📊' },
  { id: 'setup', label: 'Setup', labelZh: '快速接入', icon: '🛡️' },
  { id: 'audit', label: 'Audit Logs', labelZh: '审计日志', icon: '📜' },
  { id: 'processes', label: 'Processes', labelZh: '进程监控', icon: '⚙️' },
  { id: 'rules', label: 'Rules', labelZh: '规则管理', icon: '📋' },
  { id: 'settings', label: 'Settings', labelZh: '设置', icon: '⚙️' },
];

// i18n 翻译类型
export interface Translation {
  nav: {
    dashboard: string;
    auditLogs: string;
    processes: string;
    rules: string;
    settings: string;
  };
  dashboard: {
    title: string;
    subtitle: string;
    totalEvents: string;
    blockedEvents: string;
    allowedEvents: string;
    pendingApprovals: string;
    activeRules: string;
    recentActivity: string;
    noRecentActivity: string;
    quickActions: string;
    startStack: string;
    runDemo: string;
    runtimeStatus: string;
    daemonRunning: string;
    daemonStopped: string;
    proxyRunning: string;
    proxyStopped: string;
    protectionAlerts: string;
    noProtectionAlerts: string;
    proxyDownWithAgents: string;
    unprotectedAgentSessions: string;
    openSetup: string;
    fixNow: string;
    dismissFor10m: string;
    dismissAllWarningsFor10m: string;
    lastFixStatus: string;
    fixFailed: string;
  };
  audit: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    filters: string;
    allLayers: string;
    allActions: string;
    allRisks: string;
    time: string;
    agent: string;
    operation: string;
    target: string;
    action: string;
    risk: string;
    details: string;
    noLogs: string;
    exportLogs: string;
    clearFilters: string;
  };
  processes: {
    title: string;
    subtitle: string;
    processName: string;
    pid: string;
    status: string;
    uptime: string;
    events: string;
    cpuUsage: string;
    memoryUsage: string;
    networkActivity: string;
    noProcesses: string;
    refresh: string;
    viewDetails: string;
    stopProcess: string;
  };
  rules: {
    title: string;
    subtitle: string;
    addRule: string;
    fromTemplate: string;
    exportRules: string;
    importRules: string;
    name: string;
    layer: string;
    operation: string;
    action: string;
    priority: string;
    risk: string;
    enabled: string;
    actions: string;
    edit: string;
    delete: string;
    enable: string;
    disable: string;
    noRules: string;
    createFirst: string;
  };
  setup: {
    title: string;
    subtitle: string;
    step1Title: string;
    step1Desc: string;
    step2Title: string;
    step2Desc: string;
    step3Title: string;
    step3Desc: string;
    startBtn: string;
    startFirst: string;
    proxyListening: string;
    doneTitle: string;
    doneDesc: string;
  };
  settings: {
    title: string;
    subtitle: string;
    language: string;
    languageDescription: string;
    theme: string;
    themeDescription: string;
    notifications: string;
    notificationsDescription: string;
    autoApprove: string;
    autoApproveDescription: string;
    dataRetention: string;
    dataRetentionDescription: string;
    days: string;
    save: string;
    saved: string;
  };
  common: {
    loading: string;
    error: string;
    retry: string;
    close: string;
    cancel: string;
    confirm: string;
    save: string;
    delete: string;
    create: string;
    edit: string;
    search: string;
    filter: string;
    clear: string;
    apply: string;
    reset: string;
    refresh: string;
    back: string;
    next: string;
    previous: string;
    yes: string;
    no: string;
    ok: string;
  };
  approval: {
    title: string;
    requestFrom: string;
    operation: string;
    target: string;
    riskLevel: string;
    reason: string;
    allow: string;
    deny: string;
    remember: string;
    note: string;
    notePlaceholder: string;
  };
}

export const translations: Record<'en' | 'zh', Translation> = {
  en: {
    nav: {
      dashboard: 'Dashboard',
      auditLogs: 'Audit Logs',
      processes: 'Processes',
      rules: 'Rules',
      settings: 'Settings',
    },
    dashboard: {
      title: 'AgentGuard',
      subtitle: 'AI Agent Runtime Firewall',
      totalEvents: 'Total Events',
      blockedEvents: 'Blocked',
      allowedEvents: 'Allowed',
      pendingApprovals: 'Pending Approvals',
      activeRules: 'Active Rules',
      recentActivity: 'Recent Activity',
      noRecentActivity: 'No recent activity',
      quickActions: 'Quick Actions',
      startStack: 'Start Local Stack',
      runDemo: 'Run Demo',
      runtimeStatus: 'Runtime Status',
      daemonRunning: 'Daemon Running',
      daemonStopped: 'Daemon Stopped',
      proxyRunning: 'Proxy Running',
      proxyStopped: 'Proxy Stopped',
      protectionAlerts: 'Protection Alerts',
      noProtectionAlerts: 'No obvious unprotected agent sessions detected.',
      proxyDownWithAgents: 'Proxy is offline while agent processes are active.',
      unprotectedAgentSessions: 'Some agent processes have zero protected events.',
      openSetup: 'Open Setup',
      fixNow: 'Fix Now',
      dismissFor10m: 'Dismiss 10m',
      dismissAllWarningsFor10m: 'Dismiss all warnings for 10m',
      lastFixStatus: 'Last Fix Attempt',
      fixFailed: 'Quick fix failed. Check runtime status and try Setup.',
    },
    audit: {
      title: 'Audit Logs',
      subtitle: 'View and analyze all agent events',
      searchPlaceholder: 'Search logs...',
      filters: 'Filters',
      allLayers: 'All Layers',
      allActions: 'All Actions',
      allRisks: 'All Risks',
      time: 'Time',
      agent: 'Agent',
      operation: 'Operation',
      target: 'Target',
      action: 'Action',
      risk: 'Risk',
      details: 'Details',
      noLogs: 'No audit logs found',
      exportLogs: 'Export Logs',
      clearFilters: 'Clear Filters',
    },
    processes: {
      title: 'Process Monitor',
      subtitle: 'Real-time process monitoring and details',
      processName: 'Process Name',
      pid: 'PID',
      status: 'Status',
      uptime: 'Uptime',
      events: 'Events',
      cpuUsage: 'CPU Usage',
      memoryUsage: 'Memory Usage',
      networkActivity: 'Network Activity',
      noProcesses: 'No active processes',
      refresh: 'Refresh',
      viewDetails: 'View Details',
      stopProcess: 'Stop Process',
    },
    rules: {
      title: 'Policy Rules',
      subtitle: 'Manage security policies and rules',
      addRule: 'Add Rule',
      fromTemplate: 'From Template',
      exportRules: 'Export Rules',
      importRules: 'Import Rules',
      name: 'Name',
      layer: 'Layer',
      operation: 'Operation',
      action: 'Action',
      priority: 'Priority',
      risk: 'Risk',
      enabled: 'Enabled',
      actions: 'Actions',
      edit: 'Edit',
      delete: 'Delete',
      enable: 'Enable',
      disable: 'Disable',
      noRules: 'No rules configured',
      createFirst: 'Create your first rule to get started',
    },
    setup: {
      title: 'Proxy Setup',
      subtitle: 'Route any AI tool through AgentGuard in 3 steps — no code changes needed.',
      step1Title: 'Start AgentGuard',
      step1Desc: 'Launch the local daemon and proxy. Takes about 2 seconds.',
      step2Title: 'Choose your tool',
      step2Desc: 'Pick the AI tool or environment you want to protect.',
      step3Title: 'Copy the config',
      step3Desc: 'Paste the snippet into your tool or shell. That\'s it.',
      startBtn: '🚀 Start AgentGuard',
      startFirst: 'Start AgentGuard in Step 1 first.',
      proxyListening: 'Proxy listening at',
      doneTitle: 'AgentGuard is active!',
      doneDesc: 'All AI API calls now flow through AgentGuard. Check the Audit Logs page to see real-time events.',
    },
    settings: {
      title: 'Settings',
      subtitle: 'Configure application preferences',
      language: 'Language',
      languageDescription: 'Choose your preferred language',
      theme: 'Theme',
      themeDescription: 'Customize the appearance',
      notifications: 'Notifications',
      notificationsDescription: 'Enable desktop notifications',
      autoApprove: 'Auto Approve',
      autoApproveDescription: 'Automatically approve low-risk events',
      dataRetention: 'Data Retention',
      dataRetentionDescription: 'How long to keep audit logs',
      days: 'days',
      save: 'Save Changes',
      saved: 'Saved!',
    },
    common: {
      loading: 'Loading...',
      error: 'Error',
      retry: 'Retry',
      close: 'Close',
      cancel: 'Cancel',
      confirm: 'Confirm',
      save: 'Save',
      delete: 'Delete',
      create: 'Create',
      edit: 'Edit',
      search: 'Search',
      filter: 'Filter',
      clear: 'Clear',
      apply: 'Apply',
      reset: 'Reset',
      refresh: 'Refresh',
      back: 'Back',
      next: 'Next',
      previous: 'Previous',
      yes: 'Yes',
      no: 'No',
      ok: 'OK',
    },
    approval: {
      title: 'Approval Required',
      requestFrom: 'Request from',
      operation: 'Operation',
      target: 'Target',
      riskLevel: 'Risk Level',
      reason: 'Reason',
      allow: 'Allow',
      deny: 'Deny',
      remember: 'Remember this decision',
      note: 'Note',
      notePlaceholder: 'Add a note (optional)',
    },
  },
  zh: {
    nav: {
      dashboard: '仪表盘',
      auditLogs: '审计日志',
      processes: '进程监控',
      rules: '规则管理',
      settings: '设置',
    },
    dashboard: {
      title: 'AgentGuard',
      subtitle: 'AI Agent 运行时防火墙',
      totalEvents: '总事件数',
      blockedEvents: '已阻止',
      allowedEvents: '已允许',
      pendingApprovals: '待审批',
      activeRules: '活跃规则',
      recentActivity: '最近活动',
      noRecentActivity: '暂无最近活动',
      quickActions: '快速操作',
      startStack: '启动本地栈',
      runDemo: '运行演示',
      runtimeStatus: '运行状态',
      daemonRunning: '守护进程运行中',
      daemonStopped: '守护进程已停止',
      proxyRunning: '代理服务运行中',
      proxyStopped: '代理服务已停止',
      protectionAlerts: '防护告警',
      noProtectionAlerts: '暂未检测到明显未受保护的 Agent 会话。',
      proxyDownWithAgents: '检测到 Agent 进程活跃，但 Proxy 未运行。',
      unprotectedAgentSessions: '部分 Agent 进程尚未产生受保护事件。',
      openSetup: '前往 Setup',
      fixNow: '立即修复',
      dismissFor10m: '10 分钟忽略',
      dismissAllWarningsFor10m: '10 分钟忽略全部 warning',
      lastFixStatus: '最近修复结果',
      fixFailed: '一键修复失败，请检查运行状态或前往 Setup。',
    },
    audit: {
      title: '审计日志',
      subtitle: '查看和分析所有 Agent 事件',
      searchPlaceholder: '搜索日志...',
      filters: '筛选条件',
      allLayers: '所有层级',
      allActions: '所有操作',
      allRisks: '所有风险等级',
      time: '时间',
      agent: 'Agent',
      operation: '操作',
      target: '目标',
      action: '操作',
      risk: '风险',
      details: '详情',
      noLogs: '暂无审计日志',
      exportLogs: '导出日志',
      clearFilters: '清除筛选',
    },
    processes: {
      title: '进程监控',
      subtitle: '实时监控进程详情',
      processName: '进程名称',
      pid: '进程 ID',
      status: '状态',
      uptime: '运行时间',
      events: '事件数',
      cpuUsage: 'CPU 使用率',
      memoryUsage: '内存使用率',
      networkActivity: '网络活动',
      noProcesses: '暂无活跃进程',
      refresh: '刷新',
      viewDetails: '查看详情',
      stopProcess: '停止进程',
    },
    rules: {
      title: '策略规则',
      subtitle: '管理安全策略和规则',
      addRule: '添加规则',
      fromTemplate: '使用模板',
      exportRules: '导出规则',
      importRules: '导入规则',
      name: '名称',
      layer: '层级',
      operation: '操作',
      action: '操作',
      priority: '优先级',
      risk: '风险',
      enabled: '已启用',
      actions: '操作',
      edit: '编辑',
      delete: '删除',
      enable: '启用',
      disable: '禁用',
      noRules: '暂无规则',
      createFirst: '创建第一条规则开始使用',
    },
    setup: {
      title: 'Proxy 接入向导',
      subtitle: '3 步将任意 AI 工具接入 AgentGuard，无需修改代码。',
      step1Title: '启动 AgentGuard',
      step1Desc: '启动本地守护进程和代理服务，约 2 秒钟完成。',
      step2Title: '选择你的 AI 工具',
      step2Desc: '选择你想保护的 AI 工具或运行环境。',
      step3Title: '复制配置',
      step3Desc: '将代码片段粘贴到你的工具或 Shell 配置中，完成。',
      startBtn: '🚀 启动 AgentGuard',
      startFirst: '请先完成第 1 步，启动 AgentGuard。',
      proxyListening: '代理监听地址',
      doneTitle: 'AgentGuard 已就绪！',
      doneDesc: '所有 AI API 请求现在都经过 AgentGuard 检查。前往「审计日志」页面查看实时事件。',
    },
    settings: {
      title: '设置',
      subtitle: '配置应用偏好设置',
      language: '语言',
      languageDescription: '选择首选语言',
      theme: '主题',
      themeDescription: '自定义外观',
      notifications: '通知',
      notificationsDescription: '启用桌面通知',
      autoApprove: '自动审批',
      autoApproveDescription: '自动批准低风险事件',
      dataRetention: '数据保留',
      dataRetentionDescription: '审计日志保留时长',
      days: '天',
      save: '保存更改',
      saved: '已保存！',
    },
    common: {
      loading: '加载中...',
      error: '错误',
      retry: '重试',
      close: '关闭',
      cancel: '取消',
      confirm: '确认',
      save: '保存',
      delete: '删除',
      create: '创建',
      edit: '编辑',
      search: '搜索',
      filter: '筛选',
      clear: '清除',
      apply: '应用',
      reset: '重置',
      refresh: '刷新',
      back: '返回',
      next: '下一步',
      previous: '上一步',
      yes: '是',
      no: '否',
      ok: '确定',
    },
    approval: {
      title: '需要审批',
      requestFrom: '请求来自',
      operation: '操作',
      target: '目标',
      riskLevel: '风险等级',
      reason: '原因',
      allow: '允许',
      deny: '拒绝',
      remember: '记住此决定',
      note: '备注',
      notePlaceholder: '添加备注（可选）',
    },
  },
};

// 语言切换钩子
import { useState, useEffect } from 'react';

export type Language = 'en' | 'zh';

export function useLanguage() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('agentguard_language');
    if (saved === 'en' || saved === 'zh') {
      return saved;
    }
    // 检测系统语言
    return navigator.language.startsWith('zh') ? 'zh' : 'en';
  });

  useEffect(() => {
    localStorage.setItem('agentguard_language', language);
    document.documentElement.lang = language;
  }, [language]);

  const t = translations[language];

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'zh' : 'en');
  };

  return { language, setLanguage, t, toggleLanguage };
}
