import type {
  HubWorkspaceContent,
  HubWorkspaceView,
  SettingsSection,
  WorkspaceView,
} from '../types'
import type { WorkbenchLanguage } from './types'

const DEFAULT_WORKBENCH_LANGUAGE: WorkbenchLanguage = 'zh-CN'

const workspaceLabels: Record<WorkbenchLanguage, Record<WorkspaceView, string>> = {
  'zh-CN': {
    assistant: '助手',
    capabilities: '能力',
    files: '文件',
    sustech: 'SUSTech',
    developer: '开发',
    settings: '设置',
  },
  'en-US': {
    assistant: 'Assistant',
    capabilities: 'Capabilities',
    files: 'Files',
    sustech: 'SUSTech',
    developer: 'Developer',
    settings: 'Settings',
  },
}

const settingsSectionLabels: Record<WorkbenchLanguage, Record<SettingsSection, string>> = {
  'zh-CN': {
    'sustech-info': 'SUSTech 信息',
    'model-service': '模型服务',
    'default-model': '默认模型',
    general: '常规设置',
    display: '显示设置',
    api: 'API 服务器',
    search: '搜索设置',
    mcp: 'MCP 设置',
    docs: '文档处理',
    'external-source': '外部源',
  },
  'en-US': {
    'sustech-info': 'SUSTech Info',
    'model-service': 'Model Services',
    'default-model': 'Default Models',
    general: 'General',
    display: 'Display',
    api: 'API Server',
    search: 'Search Settings',
    mcp: 'MCP Settings',
    docs: 'Document Processing',
    'external-source': 'External Sources',
  },
}

const settingsShellCopy: Record<WorkbenchLanguage, {
  workspaceAriaLabel: string
  navAriaLabel: string
  eyebrow: string
  title: string
  mainAriaLabel: string
}> = {
  'zh-CN': {
    workspaceAriaLabel: '设置工作区',
    navAriaLabel: '设置导航列',
    eyebrow: '设置',
    title: '全局设置目录',
    mainAriaLabel: '设置主内容区',
  },
  'en-US': {
    workspaceAriaLabel: 'Settings workspace',
    navAriaLabel: 'Settings navigation',
    eyebrow: 'Settings',
    title: 'Global settings',
    mainAriaLabel: 'Settings main content',
  },
}

const generalSettingsCopy: Record<WorkbenchLanguage, {
  title: string
  languageLabel: string
  notificationsLabel: string
  debugModeLabel: string
  debugModeDescription: string
}> = {
  'zh-CN': {
    title: '常规设置',
    languageLabel: '界面语言',
    notificationsLabel: '助手消息通知',
    debugModeLabel: '启用调试模式',
    debugModeDescription: '开启后会显示更多问题排查信息。',
  },
  'en-US': {
    title: 'General Settings',
    languageLabel: 'Interface Language',
    notificationsLabel: 'Assistant Notifications',
    debugModeLabel: 'Enable Debug Mode',
    debugModeDescription: 'Show more diagnostics and troubleshooting details.',
  },
}

const displaySettingsCopy: Record<WorkbenchLanguage, {
  title: string
  themeLabel: string
}> = {
  'zh-CN': {
    title: '显示设置',
    themeLabel: '主题',
  },
  'en-US': {
    title: 'Display Settings',
    themeLabel: 'Theme',
  },
}

const sustechInfoCopy: Record<WorkbenchLanguage, {
  basicInfoTitle: string
  studentIdLabel: string
  studentIdPlaceholder: string
  emailLabel: string
  emailPlaceholder: string
  casPasswordLabel: string
  casPasswordPlaceholder: string
  blackboardInfoTitle: string
  autoDownloadLabel: string
  downloadLimitLabel: string
  downloadLimitDescription: string
  tisInfoTitle: string
  comingSoon: string
}> = {
  'zh-CN': {
    basicInfoTitle: '基本信息',
    studentIdLabel: '学号',
    studentIdPlaceholder: '输入学号',
    emailLabel: '邮箱',
    emailPlaceholder: '输入邮箱',
    casPasswordLabel: 'CAS 密码',
    casPasswordPlaceholder: '输入 CAS 密码',
    blackboardInfoTitle: 'Blackboard 信息',
    autoDownloadLabel: '自动下载 Blackboard 文件',
    downloadLimitLabel: '下载文件大小限制（MB）',
    downloadLimitDescription: '0为不限制',
    tisInfoTitle: 'TIS 信息',
    comingSoon: '敬请期待',
  },
  'en-US': {
    basicInfoTitle: 'Basic Information',
    studentIdLabel: 'Student ID',
    studentIdPlaceholder: 'Enter student ID',
    emailLabel: 'Email',
    emailPlaceholder: 'Enter email address',
    casPasswordLabel: 'CAS Password',
    casPasswordPlaceholder: 'Enter CAS password',
    blackboardInfoTitle: 'Blackboard Information',
    autoDownloadLabel: 'Download Blackboard files automatically',
    downloadLimitLabel: 'Download Size Limit (MB)',
    downloadLimitDescription: '0 means unlimited',
    tisInfoTitle: 'TIS Information',
    comingSoon: 'Coming soon',
  },
}

const defaultModelRoutesCopy: Record<WorkbenchLanguage, {
  title: string
  subtitle: string
  primaryLabel: string
  primaryDescription: string
  fastLabel: string
  fastDescription: string
  placeholder: string
}> = {
  'zh-CN': {
    title: '默认模型',
    subtitle: '为不同场景选择默认使用的模型。',
    primaryLabel: '主助手模型',
    primaryDescription: '请选择默认用于聊天的模型。',
    fastLabel: '快速执行模型',
    fastDescription: '请选择默认用于快速操作的模型。',
    placeholder: '请选择默认模型',
  },
  'en-US': {
    title: 'Default Models',
    subtitle: 'Choose the default model for different scenarios.',
    primaryLabel: 'Primary Assistant Model',
    primaryDescription: 'Select the default model used for chat.',
    fastLabel: 'Quick Action Model',
    fastDescription: 'Select the default model used for quick actions.',
    placeholder: 'Select a default model',
  },
}

const dataSettingsCopy: Record<WorkbenchLanguage, {
  title: string
  dataPathLabel: string
  dataPathPlaceholder: string
  backupCycleLabel: string
  backupEnabledLabel: string
  launchSyncLabel: string
}> = {
  'zh-CN': {
    title: '数据设置',
    dataPathLabel: '数据目录',
    dataPathPlaceholder: '选择或输入本地数据目录',
    backupCycleLabel: '备份周期',
    backupEnabledLabel: '启用自动备份',
    launchSyncLabel: '启动时同步数据',
  },
  'en-US': {
    title: 'Data Settings',
    dataPathLabel: 'Data directory',
    dataPathPlaceholder: 'Choose or enter local data directory',
    backupCycleLabel: 'Backup cycle',
    backupEnabledLabel: 'Enable automatic backup',
    launchSyncLabel: 'Sync data on launch',
  },
}

const memorySettingsCopy: Record<WorkbenchLanguage, {
  title: string
  strategyLabel: string
  cleanupLabel: string
}> = {
  'zh-CN': {
    title: '记忆设置',
    strategyLabel: '记忆策略',
    cleanupLabel: '自动清理过期记忆',
  },
  'en-US': {
    title: 'Memory Settings',
    strategyLabel: 'Memory strategy',
    cleanupLabel: 'Clean up stale memory automatically',
  },
}

const apiSettingsCopy: Record<WorkbenchLanguage, {
  title: string
  summaryTitle: string
  currentStatusLabel: string
  retryActionLabel: string
  retryingText: string
  retryIdleText: string
  apiBaseUrlLabel: string
  reconnectPolicyLabel: string
  healthPollingLabel: string
  bootstrapRetryLabels: {
    retrying: string
    idle: string
  }
  bootstrapStatusLabels: {
    loading: string
    empty: string
    incomplete: string
    starting: string
    ready: string
    failed: string
    degraded: string
    error: string
  }
}> = {
  'zh-CN': {
    title: 'API 服务器',
    summaryTitle: '根层启动摘要',
    currentStatusLabel: '当前状态',
    retryActionLabel: '重连状态',
    retryingText: '正在重新连接…',
    retryIdleText: '重新连接服务',
    apiBaseUrlLabel: '运行时覆盖地址',
    reconnectPolicyLabel: '重连策略',
    healthPollingLabel: '启用健康检查轮询',
    bootstrapRetryLabels: {
      retrying: '重试中',
      idle: '空闲',
    },
    bootstrapStatusLabels: {
      loading: '加载中',
      empty: '未配置',
      incomplete: '配置不完整',
      starting: '启动中',
      ready: '就绪',
      failed: '启动失败',
      degraded: '降级运行',
      error: '错误',
    },
  },
  'en-US': {
    title: 'API Server',
    summaryTitle: 'Root startup summary',
    currentStatusLabel: 'Current status',
    retryActionLabel: 'Reconnect state',
    retryingText: 'Reconnecting…',
    retryIdleText: 'Reconnect service',
    apiBaseUrlLabel: 'Runtime override URL',
    reconnectPolicyLabel: 'Reconnect policy',
    healthPollingLabel: 'Enable health polling',
    bootstrapRetryLabels: {
      retrying: 'Retrying',
      idle: 'Idle',
    },
    bootstrapStatusLabels: {
      loading: 'Loading',
      empty: 'Not configured',
      incomplete: 'Incomplete',
      starting: 'Starting',
      ready: 'Ready',
      failed: 'Failed',
      degraded: 'Degraded',
      error: 'Error',
    },
  },
}

const searchSettingsCopy: Record<WorkbenchLanguage, {
  providerTitle: string
  defaultEngineLabel: string
  resultCountLabel: string
  configTitle: string
  compressionLabel: string
}> = {
  'zh-CN': {
    providerTitle: '搜索设置',
    defaultEngineLabel: '默认搜索引擎',
    resultCountLabel: '默认结果数量',
    configTitle: '结果处理',
    compressionLabel: '压缩策略',
  },
  'en-US': {
    providerTitle: 'Search Settings',
    defaultEngineLabel: 'Default search engine',
    resultCountLabel: 'Default result count',
    configTitle: 'Result processing',
    compressionLabel: 'Compression strategy',
  },
}

const mcpSettingsCopy: Record<WorkbenchLanguage, {
  title: string
  permissionStrategyLabel: string
  autoDiscoveryLabel: string
}> = {
  'zh-CN': {
    title: 'MCP 设置',
    permissionStrategyLabel: '工具权限策略',
    autoDiscoveryLabel: '自动发现 MCP 服务',
  },
  'en-US': {
    title: 'MCP Settings',
    permissionStrategyLabel: 'Tool permission strategy',
    autoDiscoveryLabel: 'Auto-discover MCP servers',
  },
}

const docsSettingsCopy: Record<WorkbenchLanguage, {
  title: string
  formatLabel: string
}> = {
  'zh-CN': {
    title: '文档处理',
    formatLabel: '默认导出格式',
  },
  'en-US': {
    title: 'Document Processing',
    formatLabel: 'Default Export Format',
  },
}

const externalSourcesCopy: Record<WorkbenchLanguage, {
  title: string
  linkLabel: string
  linkPlaceholder: string
  parseLinkAriaLabel: string
  dialogAriaLabel: string
  dialogTitle: string
  closeDialogAriaLabel: string
  parseFailureText: string
  keepWakeupButton: string
  keepTisButton: string
  smartResolveButton: string
  cancelButton: string
}> = {
  'zh-CN': {
    title: 'WakeUP 课程群同步',
    linkLabel: 'WakeUP 分享链接',
    linkPlaceholder: '输入 WakeUP 分享链接',
    parseLinkAriaLabel: '解析链接',
    dialogAriaLabel: 'WakeUP 链接解析',
    dialogTitle: '解析链接',
    closeDialogAriaLabel: '关闭解析弹窗',
    parseFailureText: '解析未成功',
    keepWakeupButton: '保留 WakeUP版本',
    keepTisButton: '保留 TIS 版本',
    smartResolveButton: '尝试智能解析',
    cancelButton: '取消',
  },
  'en-US': {
    title: 'WakeUP Course Sync',
    linkLabel: 'WakeUP Share Link',
    linkPlaceholder: 'Enter WakeUP share link',
    parseLinkAriaLabel: 'Parse link',
    dialogAriaLabel: 'WakeUP link parsing',
    dialogTitle: 'Parse Link',
    closeDialogAriaLabel: 'Close parsing dialog',
    parseFailureText: 'Parsing failed',
    keepWakeupButton: 'Keep WakeUP version',
    keepTisButton: 'Keep TIS version',
    smartResolveButton: 'Try smart merge',
    cancelButton: 'Cancel',
  },
}

const providerListCopy: Record<WorkbenchLanguage, {
  title: string
  addButton: string
  searchPlaceholder: string
  emptyHint: string
}> = {
  'zh-CN': {
    title: '模型服务',
    addButton: '添加',
    searchPlaceholder: '搜索服务、地址或模型...',
    emptyHint: '可在左侧添加服务商信息',
  },
  'en-US': {
    title: 'Model Services',
    addButton: 'Add',
    searchPlaceholder: 'Search providers, endpoints, or models...',
    emptyHint: 'Add a provider from the left panel to get started',
  },
}

const providerDetailsCopy: Record<WorkbenchLanguage, {
  serviceInfoTitle: string
  displayNameLabel: string
  displayNamePlaceholder: string
  providerTypeLabel: string
  serviceAddressLabel: string
}> = {
  'zh-CN': {
    serviceInfoTitle: '服务信息',
    displayNameLabel: '显示名称',
    displayNamePlaceholder: '输入服务商名称',
    providerTypeLabel: '服务类型',
    serviceAddressLabel: '服务地址',
  },
  'en-US': {
    serviceInfoTitle: 'Service Information',
    displayNameLabel: 'Display Name',
    displayNamePlaceholder: 'Enter provider name',
    providerTypeLabel: 'Provider Type',
    serviceAddressLabel: 'Service URL',
  },
}

const providerSecretCopy: Record<WorkbenchLanguage, {
  configuredPlaceholder: string
  emptyPlaceholder: string
  hideApiKey: string
  showApiKey: string
  copyApiKey: string
  successPrefixes: string[]
}> = {
  'zh-CN': {
    configuredPlaceholder: '已配置，输入新密钥以替换',
    emptyPlaceholder: '输入访问密钥',
    hideApiKey: '隐藏 API 密钥',
    showApiKey: '查看 API 密钥原文',
    copyApiKey: '复制 API 密钥原文',
    successPrefixes: ['已复制', '已自动保存', '已清除'],
  },
  'en-US': {
    configuredPlaceholder: 'Configured. Enter a new key to replace it',
    emptyPlaceholder: 'Enter API key',
    hideApiKey: 'Hide API key',
    showApiKey: 'Show API key',
    copyApiKey: 'Copy API key',
    successPrefixes: ['Copied', 'Saved', 'Cleared'],
  },
}

const providerContextMenuCopy: Record<WorkbenchLanguage, {
  menuAriaLabel: (providerName: string) => string
  copyProvider: string
  deleteProvider: string
}> = {
  'zh-CN': {
    menuAriaLabel: (providerName) => `${providerName} 服务商菜单`,
    copyProvider: '复制服务商',
    deleteProvider: '删除服务商',
  },
  'en-US': {
    menuAriaLabel: (providerName) => `${providerName} provider menu`,
    copyProvider: 'Duplicate Provider',
    deleteProvider: 'Delete Provider',
  },
}

const providerModelListCopy: Record<WorkbenchLanguage, {
  title: string
  countSuffix: string
  unnamedModel: string
  missingModelId: string
  capabilityAriaLabel: string
  emptyCapabilities: string
  editModelTitle: (modelName: string) => string
  deleteModelTitle: (modelName: string) => string
  editModelAriaLabel: (modelName: string) => string
  deleteModelAriaLabel: (modelName: string) => string
  emptyEditable: string
  emptyReadonly: string
  addModelButton: string
}> = {
  'zh-CN': {
    title: '模型列表管理',
    countSuffix: '个模型',
    unnamedModel: '未命名模型',
    missingModelId: '未填写模型 ID',
    capabilityAriaLabel: '支持特性',
    emptyCapabilities: '未标记特性',
    editModelTitle: (modelName) => `编辑 ${modelName}`,
    deleteModelTitle: (modelName) => `删除 ${modelName}`,
    editModelAriaLabel: (modelName) => `编辑模型 ${modelName}`,
    deleteModelAriaLabel: (modelName) => `删除模型 ${modelName}`,
    emptyEditable: '当前服务还没有可用模型。点击下方按钮添加第一个模型。',
    emptyReadonly: '当前模型列表暂不可编辑。',
    addModelButton: '添加模型',
  },
  'en-US': {
    title: 'Model List',
    countSuffix: ' models',
    unnamedModel: 'Unnamed model',
    missingModelId: 'Model ID not set',
    capabilityAriaLabel: 'Supported capabilities',
    emptyCapabilities: 'No capabilities tagged',
    editModelTitle: (modelName) => `Edit ${modelName}`,
    deleteModelTitle: (modelName) => `Delete ${modelName}`,
    editModelAriaLabel: (modelName) => `Edit model ${modelName}`,
    deleteModelAriaLabel: (modelName) => `Delete model ${modelName}`,
    emptyEditable: 'No models are available for this provider yet. Use the button below to add the first one.',
    emptyReadonly: 'The current model list is read-only.',
    addModelButton: 'Add Model',
  },
}

const providerModelEditorCopy: Record<WorkbenchLanguage, {
  addTitle: string
  editTitle: string
  closeAriaLabel: string
  modelIdLabel: string
  modelIdPlaceholder: string
  modelNameLabel: string
  modelNamePlaceholder: string
  modelTypeLabel: string
  thinkingCapabilityLabel: string
  thinkingSeriesLabel: string
  defaultValueLabel: string
  defaultValueAriaLabel: string
  defaultModeLabel: string
  defaultModeAriaLabel: string
  budgetLabel: string
  budgetInputLabel: string
  budgetInputAriaLabel: string
  showAdvanced: string
  hideAdvanced: string
  currencyLabel: string
  inputPriceLabel: string
  outputPriceLabel: string
  cancelButton: string
  saveButton: string
  budgetModes: {
    off: string
    dynamic: string
    budget: string
  }
}> = {
  'zh-CN': {
    addTitle: '添加模型',
    editTitle: '编辑模型',
    closeAriaLabel: '关闭模型编辑弹层',
    modelIdLabel: '模型 ID',
    modelIdPlaceholder: '例如 google/gemini-2.5-pro',
    modelNameLabel: '模型名称',
    modelNamePlaceholder: '例如 Gemini 2.5 Pro',
    modelTypeLabel: '模型类型',
    thinkingCapabilityLabel: '思考能力',
    thinkingSeriesLabel: '推理系列',
    defaultValueLabel: '默认值',
    defaultValueAriaLabel: '默认值',
    defaultModeLabel: '默认模式',
    defaultModeAriaLabel: '预算默认模式',
    budgetLabel: '预算',
    budgetInputLabel: '思考预算',
    budgetInputAriaLabel: '默认预算',
    showAdvanced: '更多设置',
    hideAdvanced: '收起更多设置',
    currencyLabel: '币种',
    inputPriceLabel: '输入价格',
    outputPriceLabel: '输出价格',
    cancelButton: '取消',
    saveButton: '保存',
    budgetModes: {
      off: '关闭',
      dynamic: '动态',
      budget: '预算',
    },
  },
  'en-US': {
    addTitle: 'Add Model',
    editTitle: 'Edit Model',
    closeAriaLabel: 'Close model editor dialog',
    modelIdLabel: 'Model ID',
    modelIdPlaceholder: 'For example: google/gemini-2.5-pro',
    modelNameLabel: 'Model Name',
    modelNamePlaceholder: 'For example: Gemini 2.5 Pro',
    modelTypeLabel: 'Model Capabilities',
    thinkingCapabilityLabel: 'Thinking Capability',
    thinkingSeriesLabel: 'Reasoning Series',
    defaultValueLabel: 'Default Value',
    defaultValueAriaLabel: 'Default value',
    defaultModeLabel: 'Default Mode',
    defaultModeAriaLabel: 'Budget default mode',
    budgetLabel: 'Budget',
    budgetInputLabel: 'Thinking Budget',
    budgetInputAriaLabel: 'Default budget',
    showAdvanced: 'More Settings',
    hideAdvanced: 'Hide Advanced Settings',
    currencyLabel: 'Currency',
    inputPriceLabel: 'Input Price',
    outputPriceLabel: 'Output Price',
    cancelButton: 'Cancel',
    saveButton: 'Save',
    budgetModes: {
      off: 'Off',
      dynamic: 'Dynamic',
      budget: 'Budget',
    },
  },
}

const providerSecretsFeedbackCopy: Record<WorkbenchLanguage, {
  clearFailed: string
  cleared: string
  saveFailed: string
  saved: string
  nothingToCopy: string
  copied: string
  copyFailed: string
  syncFailedAfterDuplicate: string
  clearFailedAfterDelete: string
}> = {
  'zh-CN': {
    clearFailed: '清除失败，请稍后重试',
    cleared: '已清除 API 密钥',
    saveFailed: '保存失败，请稍后重试',
    saved: '已自动保存 API 密钥',
    nothingToCopy: '当前没有可复制的 API 密钥',
    copied: '已复制 API 密钥',
    copyFailed: '复制失败，请手动复制',
    syncFailedAfterDuplicate: '复制服务商后未能同步 API 密钥',
    clearFailedAfterDelete: '删除服务商后未能清除 API 密钥',
  },
  'en-US': {
    clearFailed: 'Failed to clear the API key. Please try again later.',
    cleared: 'Cleared API key',
    saveFailed: 'Failed to save the API key. Please try again later.',
    saved: 'Saved API key automatically',
    nothingToCopy: 'There is no API key to copy right now',
    copied: 'Copied API key',
    copyFailed: 'Failed to copy the API key. Please copy it manually.',
    syncFailedAfterDuplicate: 'Failed to sync the API key after duplicating the provider',
    clearFailedAfterDelete: 'Failed to clear the API key after deleting the provider',
  },
}

const configCenterPublicFieldCopy: Record<WorkbenchLanguage, {
  hostConfigRuntimeUrlCardTitle: string
  hostConfigRuntimeUrlLabel: string
  saveButton: string
  statuses: {
    loading: string
    saving: string
    error: string
    saved: string
    dirty: string
    synced: string
  }
  details: {
    loading: string
    saving: string
    defaultError: string
    saved: string
    dirty: string
    synced: string
  }
}> = {
  'zh-CN': {
    hostConfigRuntimeUrlCardTitle: '宿主配置（开发态）',
    hostConfigRuntimeUrlLabel: '开发态运行时覆盖地址',
    saveButton: '保存',
    statuses: {
      loading: '读取中',
      saving: '保存中',
      error: '保存失败',
      saved: '已保存',
      dirty: '草稿中',
      synced: '已同步',
    },
    details: {
      loading: '正在从配置中心公共快照读取当前字段。',
      saving: '正在通过配置中心公共补丁写入当前字段。',
      defaultError: '配置中心字段更新失败。',
      saved: '当前字段已写入配置中心。',
      dirty: '当前为本地草稿；失焦、回车或点击保存将提交。',
      synced: '当前字段已与配置中心公共快照保持同步。',
    },
  },
  'en-US': {
    hostConfigRuntimeUrlCardTitle: 'Host Configuration (Development)',
    hostConfigRuntimeUrlLabel: 'Development Runtime Override URL',
    saveButton: 'Save',
    statuses: {
      loading: 'Loading',
      saving: 'Saving',
      error: 'Save Failed',
      saved: 'Saved',
      dirty: 'Draft',
      synced: 'Synced',
    },
    details: {
      loading: 'Reading the current field from the public configuration snapshot.',
      saving: 'Writing the current field through the public configuration patch.',
      defaultError: 'Failed to update the configuration center field.',
      saved: 'The current field has been written to the configuration center.',
      dirty: 'This value is currently a local draft. Blur, Enter, or Save will commit it.',
      synced: 'The current field is synchronized with the public configuration snapshot.',
    },
  },
}

const assistantSessionCopy: Record<WorkbenchLanguage, {
  sessionListAriaLabel: string
  sessionEyebrow: string
  waitingForAgent: string
  renameSessionAriaLabel: (title: string) => string
  createSession: {
    waitingForAgent: string
    switchAndCreate: (agentLabel: string) => string
    create: (agentLabel: string) => string
  }
  contextMenu: {
    menuAriaLabel: (sessionLabel: string) => string
    renameSession: string
    deleteSession: string
    generateSessionTitle: string
    copySession: string
    exportSession: string
    copyAsNewSession: string
    copyAsMarkdown: string
    copyAsPlainText: string
    exportToMarkdown: string
    exportToJson: string
    exportAsPlainText: string
    confirmDeleteSession: string
    cancelDelete: string
  }
}> = {
  'zh-CN': {
    sessionListAriaLabel: '会话创建列',
    sessionEyebrow: '会话',
    waitingForAgent: '等待选择智能体',
    renameSessionAriaLabel: (title) => `重命名 ${title}`,
    createSession: {
      waitingForAgent: '等待后端目录提供可用智能体',
      switchAndCreate: (agentLabel) => `切换到 ${agentLabel} 并新建会话`,
      create: (agentLabel) => `为 ${agentLabel} 创建会话`,
    },
    contextMenu: {
      menuAriaLabel: (sessionLabel) => `${sessionLabel} 会话菜单`,
      renameSession: '重命名会话',
      deleteSession: '删除会话',
      generateSessionTitle: '生成会话名',
      copySession: '复制会话',
      exportSession: '导出会话',
      copyAsNewSession: '复制为新会话',
      copyAsMarkdown: '复制为 Markdown',
      copyAsPlainText: '复制为纯文本',
      exportToMarkdown: '导出到 Markdown',
      exportToJson: '导出到 JSON',
      exportAsPlainText: '导出为纯文本',
      confirmDeleteSession: '确认删除会话',
      cancelDelete: '取消删除',
    },
  },
  'en-US': {
    sessionListAriaLabel: 'Session creation panel',
    sessionEyebrow: 'Sessions',
    waitingForAgent: 'Select an agent to continue',
    renameSessionAriaLabel: (title) => `Rename ${title}`,
    createSession: {
      waitingForAgent: 'Waiting for the runtime directory to provide an available agent',
      switchAndCreate: (agentLabel) => `Switch to ${agentLabel} and create a session`,
      create: (agentLabel) => `Create a session for ${agentLabel}`,
    },
    contextMenu: {
      menuAriaLabel: (sessionLabel) => `${sessionLabel} session menu`,
      renameSession: 'Rename Session',
      deleteSession: 'Delete Session',
      generateSessionTitle: 'Generate Session Title',
      copySession: 'Copy Session',
      exportSession: 'Export Session',
      copyAsNewSession: 'Copy as New Session',
      copyAsMarkdown: 'Copy as Markdown',
      copyAsPlainText: 'Copy as Plain Text',
      exportToMarkdown: 'Export to Markdown',
      exportToJson: 'Export to JSON',
      exportAsPlainText: 'Export as Plain Text',
      confirmDeleteSession: 'Confirm Delete Session',
      cancelDelete: 'Cancel Delete',
    },
  },
}

const copilotChatCopy: Record<WorkbenchLanguage, {
  panel: {
    eyebrow: string
    loadingAgentsTitle: string
    loadingAgentsDescription: string
    loadAgentsFailedTitle: string
    loadAgentsFailedDescription: string
    noAgentsTitle: string
    noAgentsDescription: string
    sessionPlaceholder: string
    sessionCreateError: string
    noModelTitle: string
    noModelDescription: string
  }
  messages: {
    emptyStateTitle: string
    errorDetailButton: string
    assistantResponse: string
    reasoningGenerating: string
  }
  composer: {
    thinkingPlaceholder: string
    thinkingSettingsAriaLabel: string
    currentValueLabel: string
    unsetValue: string
    resizeHandleAriaLabel: string
    messageInputAriaLabel: string
    messageInputPlaceholder: string
    sendMessage: string
    cancelCurrentResponse: string
    fixedReasoning: string
    locked: string
    discreteOptionsAriaLabel: string
    budgetModeAriaLabel: string
    budgetAriaLabel: string
  }
  modelPicker: {
    notConfigured: string
    invalidBadge: string
    panelAriaLabel: string
    searchPlaceholder: string
    filterByTagAriaLabel: string
    allTag: string
    noModels: string
    noMatchingModels: string
    noModelsInGroup: string
    iconAriaLabel: (title: string) => string
  }
  toolPicker: {
    panelAriaLabel: string
    searchPlaceholder: string
    quickActionsAriaLabel: string
    selectAll: string
    invertSelection: string
    recommendedSet: string
    noMatchingTools: string
    noToolsEnabled: string
    enabledToolsSummary: (count: number) => string
    triggerLabel: (summary: string) => string
    disabledBadge: string
    disabledHint: string
    availabilityLabels: {
      available: string
      disabledByGlobalSetting: string
      unavailable: string
    }
  }
}> = {
  'zh-CN': {
    panel: {
      eyebrow: 'Copilot',
      loadingAgentsTitle: '正在加载助手列表',
      loadingAgentsDescription: '请稍候，加载完成后即可开始聊天。',
      loadAgentsFailedTitle: '加载助手列表失败',
      loadAgentsFailedDescription: '当前无法获取可用助手，请稍后重试。',
      noAgentsTitle: '暂无可用助手',
      noAgentsDescription: '请检查连接状态，或稍后再试。',
      sessionPlaceholder: '可在左侧选择助手并新建会话',
      sessionCreateError: '当前无法创建会话，请重试。',
      noModelTitle: '尚未配置模型',
      noModelDescription: '请先前往设置页添加模型服务商和模型。',
    },
    messages: {
      emptyStateTitle: '当前尚未发送消息',
      errorDetailButton: '查看错误详情',
      assistantResponse: '助手响应',
      reasoningGenerating: '生成中',
    },
    composer: {
      thinkingPlaceholder: '思考',
      thinkingSettingsAriaLabel: '推理设置',
      currentValueLabel: '当前值',
      unsetValue: '未设置',
      resizeHandleAriaLabel: '拖动以调整输入区高度',
      messageInputAriaLabel: '消息内容',
      messageInputPlaceholder: '按 Enter 发送，按 Ctrl + Enter 换行',
      sendMessage: '发送消息',
      cancelCurrentResponse: '取消当前响应',
      fixedReasoning: '固定推理',
      locked: '锁定',
      discreteOptionsAriaLabel: '推理可选项',
      budgetModeAriaLabel: '推理预算模式',
      budgetAriaLabel: '推理预算',
    },
    modelPicker: {
      notConfigured: '尚未配置模型',
      invalidBadge: '失效',
      panelAriaLabel: '选择模型',
      searchPlaceholder: '搜索模型…',
      filterByTagAriaLabel: '按标签筛选',
      allTag: '全部',
      noModels: '暂无可用模型。',
      noMatchingModels: '未找到匹配的模型。',
      noModelsInGroup: '暂无模型',
      iconAriaLabel: (title) => `${title} 图标`,
    },
    toolPicker: {
      panelAriaLabel: '选择工具',
      searchPlaceholder: '搜索工具…',
      quickActionsAriaLabel: '工具快捷操作',
      selectAll: '全选',
      invertSelection: '反选',
      recommendedSet: '推荐工具集',
      noMatchingTools: '未找到匹配的工具。',
      noToolsEnabled: '未启用工具',
      enabledToolsSummary: (count) => `启用 ${count} 项工具`,
      triggerLabel: (summary) => `工具：${summary}`,
      disabledBadge: '已禁用',
      disabledHint: '当前策略：总是关闭',
      availabilityLabels: {
        available: '可用',
        disabledByGlobalSetting: '全局关闭',
        unavailable: '不可用',
      },
    },
  },
  'en-US': {
    panel: {
      eyebrow: 'Copilot',
      loadingAgentsTitle: 'Loading agent list',
      loadingAgentsDescription: 'Please wait. You can start chatting once loading finishes.',
      loadAgentsFailedTitle: 'Failed to load agent list',
      loadAgentsFailedDescription: 'Available agents cannot be fetched right now. Please try again later.',
      noAgentsTitle: 'No agents available',
      noAgentsDescription: 'Check the connection state or try again later.',
      sessionPlaceholder: 'Select an agent on the left and create a session',
      sessionCreateError: 'A session cannot be created right now. Please try again.',
      noModelTitle: 'No model configured',
      noModelDescription: 'Go to Settings and add a model provider and model first.',
    },
    messages: {
      emptyStateTitle: 'No messages have been sent yet',
      errorDetailButton: 'View Error Details',
      assistantResponse: 'Assistant Response',
      reasoningGenerating: 'Generating',
    },
    composer: {
      thinkingPlaceholder: 'Thinking',
      thinkingSettingsAriaLabel: 'Reasoning settings',
      currentValueLabel: 'Current Value',
      unsetValue: 'Not Set',
      resizeHandleAriaLabel: 'Drag to resize the input area',
      messageInputAriaLabel: 'Message content',
      messageInputPlaceholder: 'Press Enter to send, Ctrl + Enter for a new line',
      sendMessage: 'Send message',
      cancelCurrentResponse: 'Cancel current response',
      fixedReasoning: 'Fixed reasoning',
      locked: 'Locked',
      discreteOptionsAriaLabel: 'Reasoning options',
      budgetModeAriaLabel: 'Reasoning budget mode',
      budgetAriaLabel: 'Reasoning budget',
    },
    modelPicker: {
      notConfigured: 'No model configured',
      invalidBadge: 'Invalid',
      panelAriaLabel: 'Select model',
      searchPlaceholder: 'Search models…',
      filterByTagAriaLabel: 'Filter by tags',
      allTag: 'All',
      noModels: 'No models are currently available.',
      noMatchingModels: 'No matching models were found.',
      noModelsInGroup: 'No models',
      iconAriaLabel: (title) => `${title} icon`,
    },
    toolPicker: {
      panelAriaLabel: 'Select tools',
      searchPlaceholder: 'Search tools…',
      quickActionsAriaLabel: 'Tool quick actions',
      selectAll: 'Select All',
      invertSelection: 'Invert Selection',
      recommendedSet: 'Recommended Set',
      noMatchingTools: 'No matching tools were found.',
      noToolsEnabled: 'No tools enabled',
      enabledToolsSummary: (count) => `${count} tools enabled`,
      triggerLabel: (summary) => `Tools: ${summary}`,
      disabledBadge: 'Disabled',
      disabledHint: 'Current policy: always off',
      availabilityLabels: {
        available: 'Available',
        disabledByGlobalSetting: 'Globally Disabled',
        unavailable: 'Unavailable',
      },
    },
  },
}

const assistantDirectoryCopy: Record<WorkbenchLanguage, {
  asideAriaLabel: string
  eyebrow: string
  title: string
  loadingDescription: string
}> = {
  'zh-CN': {
    asideAriaLabel: '智能体目录列',
    eyebrow: '助手',
    title: '后端智能体目录',
    loadingDescription: '正在从后端拉取智能体目录…',
  },
  'en-US': {
    asideAriaLabel: 'Agent directory',
    eyebrow: 'Assistant',
    title: 'Runtime Agent Directory',
    loadingDescription: 'Loading agent directory from the runtime…',
  },
}

const workbenchShellCopy: Record<WorkbenchLanguage, {
  railAriaLabel: string
  workspaceLoadFailureDescription: string
  retryCurrentWorkspace: string
  switchBackToAssistant: string
  reloadPage: string
}> = {
  'zh-CN': {
    railAriaLabel: '导航栏',
    workspaceLoadFailureDescription: '当前页面加载失败，请尝试切换到其他页面或重试。',
    retryCurrentWorkspace: '重试当前页面',
    switchBackToAssistant: '切换回助手页面',
    reloadPage: '重新加载页面',
  },
  'en-US': {
    railAriaLabel: 'Navigation bar',
    workspaceLoadFailureDescription: 'The current page failed to load. Please try switching to another page or retry.',
    retryCurrentWorkspace: 'Retry current page',
    switchBackToAssistant: 'Switch back to Assistant',
    reloadPage: 'Reload page',
  },
}

const workspaceMetaByLanguage: Record<WorkbenchLanguage, Record<WorkspaceView, { label: string; loadingDescription: string }>> = {
  'zh-CN': {
    assistant: {
      label: '助手',
      loadingDescription: '正在加载助手页面…',
    },
    settings: {
      label: '设置',
      loadingDescription: '正在加载设置页面…',
    },
    capabilities: {
      label: '能力',
      loadingDescription: '正在加载能力页面…',
    },
    files: {
      label: '文件',
      loadingDescription: '正在加载文件管理页面…',
    },
    sustech: {
      label: 'SUSTech',
      loadingDescription: '正在加载 SUSTech 页面…',
    },
    developer: {
      label: '开发',
      loadingDescription: '正在加载开发页面…',
    },
  },
  'en-US': {
    assistant: {
      label: 'Assistant',
      loadingDescription: 'Loading assistant page…',
    },
    settings: {
      label: 'Settings',
      loadingDescription: 'Loading settings page…',
    },
    capabilities: {
      label: 'Capabilities',
      loadingDescription: 'Loading capabilities page…',
    },
    files: {
      label: 'Files',
      loadingDescription: 'Loading file management page…',
    },
    sustech: {
      label: 'SUSTech',
      loadingDescription: 'Loading SUSTech page…',
    },
    developer: {
      label: 'Developer',
      loadingDescription: 'Loading developer page…',
    },
  },
}

const hubWorkspaceContentByLanguage: Record<WorkbenchLanguage, Record<HubWorkspaceView, HubWorkspaceContent>> = {
  'zh-CN': {
    developer: {
      eyebrow: '开发工作台',
      title: '开发任务与联调面板',
      panelTitle: '开发活动',
      spotlightTitle: '代码实现与验证流程',
      highlights: ['任务队列', '构建与测试反馈', '提交与发布记录'],
      entries: [
        { id: 'dev-tasks', title: '实现任务看板' },
        { id: 'dev-builds', title: '构建与验证' },
        { id: 'dev-history', title: '变更历史' },
      ],
    },
  },
  'en-US': {
    developer: {
      eyebrow: 'Developer',
      title: 'Development Tasks and Integration Panel',
      panelTitle: 'Development Activity',
      spotlightTitle: 'Code Delivery and Validation Flow',
      highlights: ['Task queue', 'Build and validation feedback', 'Commit and release history'],
      entries: [
        { id: 'dev-tasks', title: 'Implementation Board' },
        { id: 'dev-builds', title: 'Builds and Validation' },
        { id: 'dev-history', title: 'Change History' },
      ],
    },
  },
}

export {
  DEFAULT_WORKBENCH_LANGUAGE,
  apiSettingsCopy,
  assistantDirectoryCopy,
  assistantSessionCopy,
  configCenterPublicFieldCopy,
  copilotChatCopy,
  dataSettingsCopy,
  defaultModelRoutesCopy,
  displaySettingsCopy,
  docsSettingsCopy,
  externalSourcesCopy,
  generalSettingsCopy,
  hubWorkspaceContentByLanguage,
  providerContextMenuCopy,
  providerDetailsCopy,
  providerListCopy,
  providerModelEditorCopy,
  providerModelListCopy,
  providerSecretCopy,
  providerSecretsFeedbackCopy,
  mcpSettingsCopy,
  memorySettingsCopy,
  searchSettingsCopy,
  settingsSectionLabels,
  settingsShellCopy,
  sustechInfoCopy,
  workbenchShellCopy,
  workspaceLabels,
  workspaceMetaByLanguage,
}

