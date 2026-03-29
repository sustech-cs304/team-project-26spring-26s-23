import type {
  SettingsWorkspaceEditableState,
  SettingsWorkspaceStateSaveInput,
} from '../../../electron/settings-workspace/schema'
import type { ProviderModelProfile, ProviderProfile, SelectOption } from '../types'
import { initialProviderProfiles } from './config'
import {
  loadSettingsWorkspaceSecretStatuses,
  loadSettingsWorkspaceState,
  loadSettingsWorkspaceSustechCasPassword,
} from './workspace-state'

export interface SettingsWorkspaceFormState {
  studentId: string
  sustechEmail: string
  blackboardAutoDownloadEnabled: boolean
  blackboardDownloadLimitMb: string
  providerProfiles: ProviderProfile[]
  primaryAssistantModel: string
  fastAssistantModel: string
  language: string
  proxyMode: string
  assistantNotificationsEnabled: boolean
  backupEnabled: boolean
  dataPath: string
  backupCycle: string
  launchSyncEnabled: boolean
  mcpAutoDiscoveryEnabled: boolean
  toolPermissionMode: string
  searchEngine: string
  searchResultCount: string
  compressionMode: string
  memoryStrategy: string
  memoryCleanupEnabled: boolean
  apiReconnectMode: string
  healthPollingEnabled: boolean
  apiBaseUrl: string
  docsFormat: string
  outputDirectory: string
  autoFileNameEnabled: boolean
  wakeupShareLink: string
}

export interface SettingsWorkspaceHydrationPayload {
  state: SettingsWorkspaceFormState
  activeProviderId: string
  providerSecretValues: Record<string, string>
  casPasswordValue: string
}

export const initialSettingsWorkspaceActiveProviderId = initialProviderProfiles[0]?.id ?? ''

const INITIAL_SETTINGS_WORKSPACE_FORM_STATE: SettingsWorkspaceFormState = {
  studentId: '',
  sustechEmail: '',
  blackboardAutoDownloadEnabled: false,
  blackboardDownloadLimitMb: '0',
  providerProfiles: cloneProviderProfiles(initialProviderProfiles),
  primaryAssistantModel: initialProviderProfiles[0]?.defaultModel ?? '',
  fastAssistantModel: initialProviderProfiles[0]?.fastModel ?? '',
  language: 'zh-CN',
  proxyMode: 'system',
  assistantNotificationsEnabled: false,
  backupEnabled: true,
  dataPath: 'D:/workspace/copilot-data',
  backupCycle: 'daily',
  launchSyncEnabled: true,
  mcpAutoDiscoveryEnabled: true,
  toolPermissionMode: 'manual',
  searchEngine: 'google',
  searchResultCount: '8',
  compressionMode: 'summary',
  memoryStrategy: 'session-longterm',
  memoryCleanupEnabled: true,
  apiReconnectMode: 'exponential',
  healthPollingEnabled: true,
  apiBaseUrl: 'http://127.0.0.1:8000',
  docsFormat: 'markdown',
  outputDirectory: 'D:/workspace/exports',
  autoFileNameEnabled: true,
  wakeupShareLink: '',
}

export function createInitialSettingsWorkspaceFormState(): SettingsWorkspaceFormState {
  return cloneSettingsWorkspaceFormState(INITIAL_SETTINGS_WORKSPACE_FORM_STATE)
}

export function createSettingsWorkspaceFormStateFromEditableState(
  state: SettingsWorkspaceEditableState,
): SettingsWorkspaceFormState {
  return {
    studentId: state.sustech.studentId,
    sustechEmail: state.sustech.email,
    blackboardAutoDownloadEnabled: state.sustech.blackboardAutoDownloadEnabled,
    blackboardDownloadLimitMb: state.sustech.blackboardDownloadLimitMb,
    providerProfiles: cloneProviderProfiles(state.providerProfiles),
    primaryAssistantModel: state.defaultModelRouting.primaryAssistantModel,
    fastAssistantModel: state.defaultModelRouting.fastAssistantModel,
    language: state.general.language,
    proxyMode: state.general.proxyMode,
    assistantNotificationsEnabled: state.general.assistantNotificationsEnabled,
    backupEnabled: state.general.backupEnabled,
    dataPath: state.data.dataPath,
    backupCycle: state.data.backupCycle,
    launchSyncEnabled: state.data.launchSyncEnabled,
    mcpAutoDiscoveryEnabled: state.mcp.mcpAutoDiscoveryEnabled,
    toolPermissionMode: state.mcp.toolPermissionMode,
    searchEngine: state.search.searchEngine,
    searchResultCount: state.search.searchResultCount,
    compressionMode: state.search.compressionMode,
    memoryStrategy: state.memory.memoryStrategy,
    memoryCleanupEnabled: state.memory.memoryCleanupEnabled,
    apiReconnectMode: state.api.apiReconnectMode,
    healthPollingEnabled: state.api.healthPollingEnabled,
    apiBaseUrl: state.api.apiBaseUrl,
    docsFormat: state.docs.docsFormat,
    outputDirectory: state.docs.outputDirectory,
    autoFileNameEnabled: state.docs.autoFileNameEnabled,
    wakeupShareLink: state.externalSource.wakeupShareLink,
  }
}

export function createSettingsWorkspaceStateSaveInput(
  state: SettingsWorkspaceFormState,
): SettingsWorkspaceStateSaveInput {
  return {
    sustech: {
      studentId: state.studentId,
      email: state.sustechEmail,
      blackboardAutoDownloadEnabled: state.blackboardAutoDownloadEnabled,
      blackboardDownloadLimitMb: state.blackboardDownloadLimitMb,
    },
    providerProfiles: state.providerProfiles.map(({ hasApiKey: _hasApiKey, ...profile }) => ({
      ...profile,
      availableModels: profile.availableModels.map(cloneProviderModelProfile),
    })),
    defaultModelRouting: {
      primaryAssistantModel: state.primaryAssistantModel,
      fastAssistantModel: state.fastAssistantModel,
    },
    general: {
      language: state.language,
      proxyMode: state.proxyMode,
      assistantNotificationsEnabled: state.assistantNotificationsEnabled,
      backupEnabled: state.backupEnabled,
    },
    data: {
      dataPath: state.dataPath,
      backupCycle: state.backupCycle,
      launchSyncEnabled: state.launchSyncEnabled,
    },
    mcp: {
      mcpAutoDiscoveryEnabled: state.mcpAutoDiscoveryEnabled,
      toolPermissionMode: state.toolPermissionMode,
    },
    search: {
      searchEngine: state.searchEngine,
      searchResultCount: state.searchResultCount,
      compressionMode: state.compressionMode,
    },
    memory: {
      memoryStrategy: state.memoryStrategy,
      memoryCleanupEnabled: state.memoryCleanupEnabled,
    },
    api: {
      apiReconnectMode: state.apiReconnectMode,
      healthPollingEnabled: state.healthPollingEnabled,
      apiBaseUrl: state.apiBaseUrl,
    },
    docs: {
      docsFormat: state.docsFormat,
      outputDirectory: state.outputDirectory,
      autoFileNameEnabled: state.autoFileNameEnabled,
    },
    externalSource: {
      wakeupShareLink: state.wakeupShareLink,
    },
  }
}

export function collectAllModelOptions(providerProfiles: ProviderProfile[]): SelectOption[] {
  const modelsById = new Map<string, ProviderModelProfile>()

  providerProfiles.forEach((profile) => {
    profile.availableModels.forEach((model) => {
      if (!modelsById.has(model.modelId)) {
        modelsById.set(model.modelId, model)
      }
    })
  })

  return Array.from(modelsById.values()).map((model) => ({
    value: model.modelId,
    label: model.displayName || model.modelId,
  }))
}

export function resolveSettingsWorkspaceActiveProviderId(
  providerProfiles: ProviderProfile[],
  currentActiveProviderId: string,
): string {
  return providerProfiles.some((profile) => profile.id === currentActiveProviderId)
    ? currentActiveProviderId
    : providerProfiles[0]?.id ?? ''
}

export function projectLoadedProviderSecretValues(
  states: Record<string, { apiKey: string }>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(states).flatMap(([providerId, state]) => {
      return state.apiKey ? [[providerId, state.apiKey]] : []
    }),
  )
}

export async function loadSettingsWorkspaceHydration(
  currentActiveProviderId: string,
): Promise<SettingsWorkspaceHydrationPayload | null> {
  const result = await loadSettingsWorkspaceState()

  if (!result.ok) {
    return null
  }

  let providerSecretValues: Record<string, string> = {}
  let casPasswordValue = ''

  const secretStatusesResult = await loadSettingsWorkspaceSecretStatuses({
    providerIds: result.state.providerProfiles.map((profile) => profile.id),
  })
  const sustechCasPasswordResult = await loadSettingsWorkspaceSustechCasPassword()

  if (secretStatusesResult.ok) {
    providerSecretValues = projectLoadedProviderSecretValues(secretStatusesResult.states)
  }

  if (sustechCasPasswordResult.ok) {
    casPasswordValue = sustechCasPasswordResult.state.password
  }

  const state = createSettingsWorkspaceFormStateFromEditableState(result.state)

  return {
    state,
    activeProviderId: resolveSettingsWorkspaceActiveProviderId(state.providerProfiles, currentActiveProviderId),
    providerSecretValues,
    casPasswordValue,
  }
}

function cloneSettingsWorkspaceFormState(state: SettingsWorkspaceFormState): SettingsWorkspaceFormState {
  return {
    ...state,
    providerProfiles: cloneProviderProfiles(state.providerProfiles),
  }
}

function cloneProviderProfiles(providerProfiles: ProviderProfile[]): ProviderProfile[] {
  return providerProfiles.map((profile) => ({
    ...profile,
    availableModels: profile.availableModels.map(cloneProviderModelProfile),
  }))
}

function cloneProviderModelProfile(model: ProviderModelProfile): ProviderModelProfile {
  return {
    ...model,
    capabilities: [...model.capabilities],
  }
}
