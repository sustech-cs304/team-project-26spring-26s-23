import type { ProviderProfile } from '../../src/workbench/types'
import type { SettingsWorkspaceProviderSecretStateById } from './secret-schema'
import {
  cloneStoredProviderProfile,
  createDefaultSettingsWorkspaceDefaultModelRouting,
  createDefaultStoredProviderProfiles,
  normalizeStoredProviderProfiles,
  type SettingsWorkspaceStoredProviderProfile,
} from './provider-schema'
import { asRecord, normalizeBooleanStringGroup, normalizeStringGroup } from './normalize'

export const SETTINGS_WORKSPACE_STATE_DOCUMENT_VERSION = 1 as const

export type SettingsWorkspaceStateSource = 'stored' | 'initialized-defaults'

export interface SettingsWorkspaceStateValues {
  sustech: {
    studentId: string
    email: string
    blackboardAutoDownloadEnabled: boolean
    blackboardDownloadLimitMb: string
  }
  providerProfiles: SettingsWorkspaceStoredProviderProfile[]
  defaultModelRouting: {
    primaryAssistantModel: string
    fastAssistantModel: string
  }
  general: {
    language: string
    proxyMode: string
    assistantNotificationsEnabled: boolean
    backupEnabled: boolean
  }
  data: {
    dataPath: string
    backupCycle: string
    launchSyncEnabled: boolean
  }
  mcp: {
    mcpAutoDiscoveryEnabled: boolean
    toolPermissionMode: string
  }
  search: {
    searchEngine: string
    searchResultCount: string
    compressionMode: string
  }
  memory: {
    memoryStrategy: string
    memoryCleanupEnabled: boolean
  }
  api: {
    apiReconnectMode: string
    healthPollingEnabled: boolean
    apiBaseUrl: string
  }
  docs: {
    docsFormat: string
    outputDirectory: string
    autoFileNameEnabled: boolean
  }
  externalSource: {
    wakeupShareLink: string
  }
}

export interface SettingsWorkspaceStateDocument {
  version: typeof SETTINGS_WORKSPACE_STATE_DOCUMENT_VERSION
  kind: 'settings-workspace-state'
  values: SettingsWorkspaceStateValues
}

export interface SettingsWorkspaceEditableState extends Omit<SettingsWorkspaceStateValues, 'providerProfiles'> {
  providerProfiles: ProviderProfile[]
}

export type SettingsWorkspaceStateSaveInput = SettingsWorkspaceStateValues

const DEFAULT_SETTINGS_WORKSPACE_STATE_VALUES: SettingsWorkspaceStateValues = {
  sustech: {
    studentId: '',
    email: '',
    blackboardAutoDownloadEnabled: false,
    blackboardDownloadLimitMb: '0',
  },
  providerProfiles: createDefaultStoredProviderProfiles(),
  defaultModelRouting: createDefaultSettingsWorkspaceDefaultModelRouting(),
  general: {
    language: 'zh-CN',
    proxyMode: 'system',
    assistantNotificationsEnabled: false,
    backupEnabled: true,
  },
  data: {
    dataPath: 'D:/workspace/copilot-data',
    backupCycle: 'daily',
    launchSyncEnabled: true,
  },
  mcp: {
    mcpAutoDiscoveryEnabled: true,
    toolPermissionMode: 'manual',
  },
  search: {
    searchEngine: 'google',
    searchResultCount: '8',
    compressionMode: 'summary',
  },
  memory: {
    memoryStrategy: 'session-longterm',
    memoryCleanupEnabled: true,
  },
  api: {
    apiReconnectMode: 'exponential',
    healthPollingEnabled: true,
    apiBaseUrl: 'http://127.0.0.1:8000',
  },
  docs: {
    docsFormat: 'markdown',
    outputDirectory: 'D:/workspace/exports',
    autoFileNameEnabled: true,
  },
  externalSource: {
    wakeupShareLink: '',
  },
}

export function createDefaultSettingsWorkspaceStateValues(): SettingsWorkspaceStateValues {
  return cloneSettingsWorkspaceStateValues(DEFAULT_SETTINGS_WORKSPACE_STATE_VALUES)
}

export function createDefaultSettingsWorkspaceStateDocument(): SettingsWorkspaceStateDocument {
  return createSettingsWorkspaceStateDocument(createDefaultSettingsWorkspaceStateValues())
}

export function createSettingsWorkspaceStateDocument(
  values: SettingsWorkspaceStateValues,
): SettingsWorkspaceStateDocument {
  return {
    version: SETTINGS_WORKSPACE_STATE_DOCUMENT_VERSION,
    kind: 'settings-workspace-state',
    values: cloneSettingsWorkspaceStateValues(values),
  }
}

export function normalizeSettingsWorkspaceStateValues(input: unknown): SettingsWorkspaceStateValues {
  const record = asRecord(input)
  const defaults = DEFAULT_SETTINGS_WORKSPACE_STATE_VALUES

  return {
    sustech: normalizeBooleanStringGroup(record.sustech, defaults.sustech),
    providerProfiles: normalizeStoredProviderProfiles(record.providerProfiles),
    defaultModelRouting: normalizeStringGroup(record.defaultModelRouting, defaults.defaultModelRouting),
    general: normalizeBooleanStringGroup(record.general, defaults.general),
    data: normalizeBooleanStringGroup(record.data, defaults.data),
    mcp: normalizeBooleanStringGroup(record.mcp, defaults.mcp),
    search: normalizeStringGroup(record.search, defaults.search),
    memory: normalizeBooleanStringGroup(record.memory, defaults.memory),
    api: normalizeBooleanStringGroup(record.api, defaults.api),
    docs: normalizeBooleanStringGroup(record.docs, defaults.docs),
    externalSource: normalizeStringGroup(record.externalSource, defaults.externalSource),
  }
}

export function normalizeSettingsWorkspaceStateDocument(input: unknown): SettingsWorkspaceStateDocument {
  const record = asRecord(input)
  return createSettingsWorkspaceStateDocument(normalizeSettingsWorkspaceStateValues(record.values))
}

export function projectSettingsWorkspaceEditableState(
  values: SettingsWorkspaceStateValues,
  secretStates: SettingsWorkspaceProviderSecretStateById,
): SettingsWorkspaceEditableState {
  return {
    ...cloneSettingsWorkspaceStateValues(values),
    providerProfiles: values.providerProfiles.map((profile) => ({
      ...cloneStoredProviderProfile(profile),
      hasApiKey: secretStates[profile.id]?.hasApiKey ?? false,
    })),
  }
}

function cloneSettingsWorkspaceStateValues(values: SettingsWorkspaceStateValues): SettingsWorkspaceStateValues {
  return {
    sustech: { ...values.sustech },
    providerProfiles: values.providerProfiles.map(cloneStoredProviderProfile),
    defaultModelRouting: { ...values.defaultModelRouting },
    general: { ...values.general },
    data: { ...values.data },
    mcp: { ...values.mcp },
    search: { ...values.search },
    memory: { ...values.memory },
    api: { ...values.api },
    docs: { ...values.docs },
    externalSource: { ...values.externalSource },
  }
}
