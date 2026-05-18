import type {
  HubWorkspaceContent,
  HubWorkspaceView,
  ModelCapability,
  SelectOption,
  SettingsSection,
  WorkspaceView,
} from './types'

import type { WorkbenchLanguage } from './_locale/types'
export type { WorkbenchLanguage } from './_locale/types'

import {
  DEFAULT_WORKBENCH_LANGUAGE,
  workspaceLabels,
  settingsSectionLabels,
  settingsShellCopy,
  generalSettingsCopy,
  displaySettingsCopy,
  sustechInfoCopy,
  dataSettingsCopy,
  defaultModelRoutesCopy,
  mcpSettingsCopy,
  searchSettingsCopy,
  memorySettingsCopy,
  apiSettingsCopy,
  docsSettingsCopy,
  externalSourcesCopy,
  providerListCopy,
  providerDetailsCopy,
  providerSecretCopy,
  providerContextMenuCopy,
  providerModelListCopy,
  providerModelEditorCopy,
  providerSecretsFeedbackCopy,
  configCenterPublicFieldCopy,
  assistantSessionCopy,
  copilotChatCopy,
  assistantDirectoryCopy,
  workbenchShellCopy,
  workspaceMetaByLanguage,
  hubWorkspaceContentByLanguage,
} from './_locale/strings'


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
