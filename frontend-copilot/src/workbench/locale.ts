import type {
  HubWorkspaceContent,
  HubWorkspaceView,
  ModelCapability,
  SelectOption,
  SettingsSection,
  WorkspaceView,
} from './types'

export type WorkbenchLanguage = 'zh-CN' | 'en-US'

const DEFAULT_WORKBENCH_LANGUAGE: WorkbenchLanguage = 'zh-CN'

const workspaceLabels: Record<WorkbenchLanguage, Record<WorkspaceView, string>> = {
  'zh-CN': {
    assistant: '助手',
    capabilities: '能力',
    files: '文件',
    developer: '开发',
    settings: '设置',
  },
  'en-US': {
    assistant: 'Assistant',
    capabilities: 'Capabilities',
    files: 'Files',
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
    data: '数据设置',
    mcp: 'MCP 服务器',
    search: '网络搜索',
    memory: '全局记忆',
    api: 'API 服务器',
    docs: '文档处理',
    'external-source': '外部源',
  },
  'en-US': {
    'sustech-info': 'SUSTech Info',
    'model-service': 'Model Services',
    'default-model': 'Default Models',
    general: 'General',
    display: 'Display',
    data: 'Data',
    mcp: 'MCP Servers',
    search: 'Web Search',
    memory: 'Memory',
    api: 'API Server',
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
  proxyModeLabel: string
  notificationsLabel: string
  backupLabel: string
  debugModeLabel: string
  debugModeDescription: string
}> = {
  'zh-CN': {
    title: '常规设置',
    languageLabel: '界面语言',
    proxyModeLabel: '代理模式',
    notificationsLabel: '助手消息通知',
    backupLabel: '自动备份',
    debugModeLabel: '启用调试模式',
    debugModeDescription: '开启后会显示更多问题排查信息。',
  },
  'en-US': {
    title: 'General Settings',
    languageLabel: 'Interface Language',
    proxyModeLabel: 'Proxy Mode',
    notificationsLabel: 'Assistant Notifications',
    backupLabel: 'Automatic Backup',
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
    dataPathPlaceholder: '输入本地目录',
    backupCycleLabel: '备份周期',
    backupEnabledLabel: '启用自动备份',
    launchSyncLabel: '启动时同步',
  },
  'en-US': {
    title: 'Data Settings',
    dataPathLabel: 'Data Directory',
    dataPathPlaceholder: 'Enter local directory',
    backupCycleLabel: 'Backup Cycle',
    backupEnabledLabel: 'Enable Automatic Backup',
    launchSyncLabel: 'Sync on Launch',
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

const mcpSettingsCopy: Record<WorkbenchLanguage, {
  title: string
  permissionStrategyLabel: string
  autoDiscoveryLabel: string
}> = {
  'zh-CN': {
    title: 'MCP 服务器',
    permissionStrategyLabel: '工具权限策略',
    autoDiscoveryLabel: '自动发现 MCP 服务',
  },
  'en-US': {
    title: 'MCP Servers',
    permissionStrategyLabel: 'Tool Permission Policy',
    autoDiscoveryLabel: 'Auto-discover MCP services',
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
    providerTitle: '搜索服务商',
    defaultEngineLabel: '默认搜索引擎',
    resultCountLabel: '结果数量',
    configTitle: '网络搜索配置',
    compressionLabel: '压缩方式',
  },
  'en-US': {
    providerTitle: 'Search Provider',
    defaultEngineLabel: 'Default Search Engine',
    resultCountLabel: 'Result Count',
    configTitle: 'Web Search Configuration',
    compressionLabel: 'Compression Mode',
  },
}

const memorySettingsCopy: Record<WorkbenchLanguage, {
  title: string
  strategyLabel: string
  cleanupLabel: string
}> = {
  'zh-CN': {
    title: '全局记忆',
    strategyLabel: '记忆策略',
    cleanupLabel: '自动清理陈旧记忆',
  },
  'en-US': {
    title: 'Memory',
    strategyLabel: 'Memory Strategy',
    cleanupLabel: 'Automatically clean stale memory',
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
  bootstrapStatusLabels: Record<
    'loading' | 'empty' | 'incomplete' | 'starting' | 'ready' | 'failed' | 'degraded' | 'error',
    string
  >
  bootstrapRetryLabels: {
    retrying: string
    idle: string
  }
}> = {
  'zh-CN': {
    title: 'API 服务器',
    summaryTitle: '根层启动摘要',
    currentStatusLabel: '当前状态',
    retryActionLabel: '重试动作',
    retryingText: '正在重试…',
    retryIdleText: '重试读取运行态',
    apiBaseUrlLabel: '后端地址',
    reconnectPolicyLabel: '重连策略',
    healthPollingLabel: '启用健康检查轮询',
    bootstrapStatusLabels: {
      loading: '根层读取中',
      empty: '尚未配置',
      incomplete: '配置缺失',
      starting: '宿主启动中',
      ready: '运行态已就绪',
      failed: '宿主启动失败',
      degraded: '运行态降级',
      error: '读取失败',
    },
    bootstrapRetryLabels: {
      retrying: '根层重试中',
      idle: '由根层统一持有',
    },
  },
  'en-US': {
    title: 'API Server',
    summaryTitle: 'Root Bootstrap Summary',
    currentStatusLabel: 'Current Status',
    retryActionLabel: 'Retry Action',
    retryingText: 'Retrying…',
    retryIdleText: 'Retry runtime bootstrap',
    apiBaseUrlLabel: 'Backend URL',
    reconnectPolicyLabel: 'Reconnect Policy',
    healthPollingLabel: 'Enable health polling',
    bootstrapStatusLabels: {
      loading: 'Root loading',
      empty: 'Not configured',
      incomplete: 'Configuration missing',
      starting: 'Host starting',
      ready: 'Runtime ready',
      failed: 'Host startup failed',
      degraded: 'Runtime degraded',
      error: 'Load failed',
    },
    bootstrapRetryLabels: {
      retrying: 'Root retry in progress',
      idle: 'Managed by the root shell',
    },
  },
}

const docsSettingsCopy: Record<WorkbenchLanguage, {
  title: string
  formatLabel: string
  outputDirectoryLabel: string
  outputDirectoryPlaceholder: string
  autoFileNameLabel: string
}> = {
  'zh-CN': {
    title: '文档处理',
    formatLabel: '默认导出格式',
    outputDirectoryLabel: '输出目录',
    outputDirectoryPlaceholder: '输入导出目录',
    autoFileNameLabel: '自动生成文件名',
  },
  'en-US': {
    title: 'Document Processing',
    formatLabel: 'Default Export Format',
    outputDirectoryLabel: 'Output Directory',
    outputDirectoryPlaceholder: 'Enter export directory',
    autoFileNameLabel: 'Generate file names automatically',
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
    railAriaLabel: '主图标栏',
    workspaceLoadFailureDescription: '当前工作区模块未能完成懒加载或渲染，但工作台外壳仍保持可解释失败态，不会退化为纯白屏。',
    retryCurrentWorkspace: '重试当前工作区',
    switchBackToAssistant: '切换回助手工作区',
    reloadPage: '重新加载页面',
  },
  'en-US': {
    railAriaLabel: 'Primary workspace rail',
    workspaceLoadFailureDescription: 'The current workspace module failed to lazy-load or render, but the workbench shell stays visible with an explainable failure state instead of a blank screen.',
    retryCurrentWorkspace: 'Retry current workspace',
    switchBackToAssistant: 'Switch back to Assistant',
    reloadPage: 'Reload page',
  },
}

const workspaceMetaByLanguage: Record<WorkbenchLanguage, Record<WorkspaceView, { label: string; loadingDescription: string }>> = {
  'zh-CN': {
    assistant: {
      label: '助手',
      loadingDescription: '助手工作区已从工作台壳拆分为独立懒加载模块；当前仅加载默认首屏所需代码。',
    },
    settings: {
      label: '设置',
      loadingDescription: '设置工作区已从入口壳层剥离，仅在切换到设置时再按需加载。',
    },
    capabilities: {
      label: '能力',
      loadingDescription: '能力工作区模块正在按需加载，不再与默认助手首屏共同打包在一个超级入口文件中。',
    },
    files: {
      label: '文件',
      loadingDescription: '文件工作区模块正在按需加载，以缩短默认首屏装配链。',
    },
    developer: {
      label: '开发',
      loadingDescription: '开发工作区模块正在按需加载，避免与默认助手首屏形成死耦合。',
    },
  },
  'en-US': {
    assistant: {
      label: 'Assistant',
      loadingDescription: 'The assistant workspace is split into a standalone lazy-loaded module so the default first screen only loads what it immediately needs.',
    },
    settings: {
      label: 'Settings',
      loadingDescription: 'The settings workspace is split out of the entry shell and is loaded on demand only when the user switches to it.',
    },
    capabilities: {
      label: 'Capabilities',
      loadingDescription: 'The capabilities workspace is loaded on demand instead of being bundled together with the default assistant first screen in one oversized entry module.',
    },
    files: {
      label: 'Files',
      loadingDescription: 'The files workspace is loaded on demand to shorten the default first-screen bootstrap chain.',
    },
    developer: {
      label: 'Developer',
      loadingDescription: 'The developer workspace is loaded on demand to avoid hard-coupling it with the default assistant first screen.',
    },
  },
}

const hubWorkspaceContentByLanguage: Record<WorkbenchLanguage, Record<HubWorkspaceView, HubWorkspaceContent>> = {
  'zh-CN': {
    capabilities: {
      eyebrow: '能力中心',
      title: '已接入能力与工具栈',
      panelTitle: '能力分组',
      spotlightTitle: '工具调用与能力编排',
      highlights: ['MCP 服务器接入', '网页抓取与浏览器自动化', '项目内检索与本地命令执行'],
      entries: [
        { id: 'capability-mcp', title: 'MCP 扩展能力' },
        { id: 'capability-web', title: '联网搜索与抓取' },
        { id: 'capability-local', title: '本地项目操作' },
      ],
    },
    files: {
      eyebrow: '文件工作区',
      title: '知识文件与资料入口',
      panelTitle: '文件分区',
      spotlightTitle: '课程资料与上下文挂载',
      highlights: ['课程资料库', '会话附件管理', '知识索引与标签'],
      entries: [
        { id: 'files-courseware', title: '课程课件目录' },
        { id: 'files-notes', title: '个人笔记区' },
        { id: 'files-attachments', title: '对话附件' },
      ],
    },
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
    capabilities: {
      eyebrow: 'Capabilities',
      title: 'Connected Capabilities and Tooling',
      panelTitle: 'Capability Groups',
      spotlightTitle: 'Tool Calling and Capability Orchestration',
      highlights: ['MCP server integration', 'Web fetching and browser automation', 'Project search and local command execution'],
      entries: [
        { id: 'capability-mcp', title: 'MCP Extensions' },
        { id: 'capability-web', title: 'Web Search and Fetching' },
        { id: 'capability-local', title: 'Local Project Operations' },
      ],
    },
    files: {
      eyebrow: 'Files',
      title: 'Knowledge Files and Resource Entry',
      panelTitle: 'File Areas',
      spotlightTitle: 'Course Resources and Context Mounting',
      highlights: ['Course material library', 'Session attachment management', 'Knowledge indexing and tags'],
      entries: [
        { id: 'files-courseware', title: 'Course Material Directory' },
        { id: 'files-notes', title: 'Personal Notes' },
        { id: 'files-attachments', title: 'Conversation Attachments' },
      ],
    },
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

export function normalizeWorkbenchLanguage(value: string | null | undefined): WorkbenchLanguage {
  return value === 'en-US' ? 'en-US' : DEFAULT_WORKBENCH_LANGUAGE
}

export function getWorkspaceLabel(language: string, view: WorkspaceView): string {
  return workspaceLabels[normalizeWorkbenchLanguage(language)][view]
}

export function getSettingsSectionLabel(language: string, section: SettingsSection): string {
  return settingsSectionLabels[normalizeWorkbenchLanguage(language)][section]
}

export function getSettingsShellCopy(language: string): {
  workspaceAriaLabel: string
  navAriaLabel: string
  eyebrow: string
  title: string
  mainAriaLabel: string
} {
  return settingsShellCopy[normalizeWorkbenchLanguage(language)]
}

export function getGeneralSettingsCopy(language: string) {
  return generalSettingsCopy[normalizeWorkbenchLanguage(language)]
}

export function getDisplaySettingsCopy(language: string) {
  return displaySettingsCopy[normalizeWorkbenchLanguage(language)]
}

export function getSustechInfoCopy(language: string) {
  return sustechInfoCopy[normalizeWorkbenchLanguage(language)]
}

export function getDataSettingsCopy(language: string) {
  return dataSettingsCopy[normalizeWorkbenchLanguage(language)]
}

export function getDefaultModelRoutesCopy(language: string) {
  return defaultModelRoutesCopy[normalizeWorkbenchLanguage(language)]
}

export function getMcpSettingsCopy(language: string) {
  return mcpSettingsCopy[normalizeWorkbenchLanguage(language)]
}

export function getSearchSettingsCopy(language: string) {
  return searchSettingsCopy[normalizeWorkbenchLanguage(language)]
}

export function getMemorySettingsCopy(language: string) {
  return memorySettingsCopy[normalizeWorkbenchLanguage(language)]
}

export function getApiSettingsCopy(language: string) {
  return apiSettingsCopy[normalizeWorkbenchLanguage(language)]
}

export function getDocsSettingsCopy(language: string) {
  return docsSettingsCopy[normalizeWorkbenchLanguage(language)]
}

export function getExternalSourcesCopy(language: string) {
  return externalSourcesCopy[normalizeWorkbenchLanguage(language)]
}

export function getProviderListCopy(language: string) {
  return providerListCopy[normalizeWorkbenchLanguage(language)]
}

export function getProviderDetailsCopy(language: string) {
  return providerDetailsCopy[normalizeWorkbenchLanguage(language)]
}

export function getProviderSecretCopy(language: string) {
  return providerSecretCopy[normalizeWorkbenchLanguage(language)]
}

export function getProviderContextMenuCopy(language: string) {
  return providerContextMenuCopy[normalizeWorkbenchLanguage(language)]
}

export function getProviderModelListCopy(language: string) {
  return providerModelListCopy[normalizeWorkbenchLanguage(language)]
}

export function getProviderModelEditorCopy(language: string) {
  return providerModelEditorCopy[normalizeWorkbenchLanguage(language)]
}

export function getProviderSecretsFeedbackCopy(language: string) {
  return providerSecretsFeedbackCopy[normalizeWorkbenchLanguage(language)]
}

export function getAssistantDirectoryCopy(language: string) {
  return assistantDirectoryCopy[normalizeWorkbenchLanguage(language)]
}

export function getConfigCenterPublicFieldCopy(language: string) {
  return configCenterPublicFieldCopy[normalizeWorkbenchLanguage(language)]
}

export function getAssistantSessionCopy(language: string) {
  return assistantSessionCopy[normalizeWorkbenchLanguage(language)]
}

export function getCopilotChatCopy(language: string) {
  return copilotChatCopy[normalizeWorkbenchLanguage(language)]
}

export function getWorkbenchShellCopy(language: string) {
  return workbenchShellCopy[normalizeWorkbenchLanguage(language)]
}

export function getWorkspaceMeta(language: string, view: WorkspaceView): { label: string; loadingDescription: string } {
  return workspaceMetaByLanguage[normalizeWorkbenchLanguage(language)][view]
}

export function getHubWorkspaceContent(language: string, view: HubWorkspaceView): HubWorkspaceContent {
  const content = hubWorkspaceContentByLanguage[normalizeWorkbenchLanguage(language)][view]

  return {
    eyebrow: content.eyebrow,
    title: content.title,
    panelTitle: content.panelTitle,
    spotlightTitle: content.spotlightTitle,
    highlights: [...content.highlights],
    entries: content.entries.map((entry) => ({ ...entry })),
  }
}

export function getLanguageOptions(language: string): SelectOption[] {
  const locale = normalizeWorkbenchLanguage(language)

  if (locale === 'en-US') {
    return [
      { value: 'zh-CN', label: 'Simplified Chinese' },
      { value: 'en-US', label: 'English' },
    ]
  }

  return [
    { value: 'zh-CN', label: '简体中文' },
    { value: 'en-US', label: '英语' },
  ]
}

export function getProxyModeOptions(language: string): SelectOption[] {
  const locale = normalizeWorkbenchLanguage(language)

  if (locale === 'en-US') {
    return [
      { value: 'system', label: 'System Proxy' },
      { value: 'direct', label: 'Direct Connection' },
      { value: 'manual', label: 'Manual Configuration' },
    ]
  }

  return [
    { value: 'system', label: '系统代理' },
    { value: 'direct', label: '直连' },
    { value: 'manual', label: '手动配置' },
  ]
}

export function getThemeOptions(language: string): SelectOption[] {
  const locale = normalizeWorkbenchLanguage(language)

  if (locale === 'en-US') {
    return [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ]
  }

  return [
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
  ]
}

export function getBackupCycleOptions(language: string): SelectOption[] {
  const locale = normalizeWorkbenchLanguage(language)

  if (locale === 'en-US') {
    return [
      { value: 'every-launch', label: 'Every Launch' },
      { value: 'daily', label: 'Daily' },
      { value: 'weekly', label: 'Weekly' },
    ]
  }

  return [
    { value: 'every-launch', label: '每次启动' },
    { value: 'daily', label: '每天' },
    { value: 'weekly', label: '每周' },
  ]
}

export function getToolPermissionOptions(language: string): SelectOption[] {
  const locale = normalizeWorkbenchLanguage(language)

  if (locale === 'en-US') {
    return [
      { value: 'manual', label: 'Ask Every Time' },
      { value: 'trusted', label: 'Auto Allow Trusted Capabilities' },
      { value: 'strict', label: 'Strict Manual Mode' },
    ]
  }

  return [
    { value: 'manual', label: '逐次确认' },
    { value: 'trusted', label: '受信能力自动允许' },
    { value: 'strict', label: '严格手动' },
  ]
}

export function getResultCountOptions(language: string): SelectOption[] {
  const locale = normalizeWorkbenchLanguage(language)

  if (locale === 'en-US') {
    return [
      { value: '5', label: '5 results' },
      { value: '8', label: '8 results' },
      { value: '12', label: '12 results' },
    ]
  }

  return [
    { value: '5', label: '5 条' },
    { value: '8', label: '8 条' },
    { value: '12', label: '12 条' },
  ]
}

export function getCompressionOptions(language: string): SelectOption[] {
  const locale = normalizeWorkbenchLanguage(language)

  if (locale === 'en-US') {
    return [
      { value: 'summary', label: 'Summary Compression' },
      { value: 'balanced', label: 'Balanced Mode' },
      { value: 'none', label: 'No Compression' },
    ]
  }

  return [
    { value: 'summary', label: '摘要压缩' },
    { value: 'balanced', label: '平衡模式' },
    { value: 'none', label: '不压缩' },
  ]
}

export function getMemoryStrategyOptions(language: string): SelectOption[] {
  const locale = normalizeWorkbenchLanguage(language)

  if (locale === 'en-US') {
    return [
      { value: 'session-only', label: 'Session Only' },
      { value: 'session-longterm', label: 'Session + Long-term Memory' },
      { value: 'project-centric', label: 'Project First' },
    ]
  }

  return [
    { value: 'session-only', label: '仅会话内' },
    { value: 'session-longterm', label: '会话 + 长期记忆' },
    { value: 'project-centric', label: '项目优先' },
  ]
}

export function getApiReconnectOptions(language: string): SelectOption[] {
  const locale = normalizeWorkbenchLanguage(language)

  if (locale === 'en-US') {
    return [
      { value: 'exponential', label: 'Exponential Backoff' },
      { value: 'fixed', label: 'Fixed Interval' },
      { value: 'manual', label: 'Manual Reconnect' },
    ]
  }

  return [
    { value: 'exponential', label: '指数退避' },
    { value: 'fixed', label: '固定间隔' },
    { value: 'manual', label: '手动重连' },
  ]
}

export function getDocsFormatOptions(language: string): SelectOption[] {
  const locale = normalizeWorkbenchLanguage(language)

  if (locale === 'en-US') {
    return [
      { value: 'markdown', label: 'Markdown' },
      { value: 'html', label: 'HTML' },
      { value: 'pdf', label: 'PDF' },
    ]
  }

  return [
    { value: 'markdown', label: 'Markdown' },
    { value: 'html', label: 'HTML' },
    { value: 'pdf', label: 'PDF' },
  ]
}

export function getModelCapabilityOptions(language: string): Array<{ value: ModelCapability; label: string }> {
  const locale = normalizeWorkbenchLanguage(language)

  if (locale === 'en-US') {
    return [
      { value: 'vision', label: 'Vision' },
      { value: 'search', label: 'Search' },
      { value: 'reasoning', label: 'Reasoning' },
      { value: 'tools', label: 'Tools' },
      { value: 'rerank', label: 'Rerank' },
      { value: 'embedding', label: 'Embedding' },
    ]
  }

  return [
    { value: 'vision', label: '视觉' },
    { value: 'search', label: '联网' },
    { value: 'reasoning', label: '推理' },
    { value: 'tools', label: '工具' },
    { value: 'rerank', label: '重排' },
    { value: 'embedding', label: '向量' },
  ]
}
