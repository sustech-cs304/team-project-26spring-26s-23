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
  defaultModelRoutesCopy,
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

export function getDefaultModelRoutesCopy(language: string) {
  return defaultModelRoutesCopy[normalizeWorkbenchLanguage(language)]
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
