// 导航相关类型
export type Page = 'dashboard' | 'audit' | 'processes' | 'rules' | 'settings';

export interface NavItem {
  id: Page;
  label: string;
  labelZh: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', labelZh: '仪表盘', icon: '📊' },
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
