import type {
  ModelRouteRef,
  ProviderProfile,
} from '../../src/workbench/types'
import type { SettingsWorkspaceProviderSecretStateById } from './secret-schema'
import {
  cloneStoredProviderProfile,
  createDefaultSettingsWorkspaceDefaultModelRouting,
  createDefaultStoredProviderProfiles,
  normalizeStoredProviderProfiles,
  projectEditableProviderProfile,
  type SettingsWorkspaceStoredProviderProfile,
} from './provider-schema'
import { asRecord, normalizeBooleanStringGroup, normalizeNonEmptyString, normalizeStringGroup } from './normalize'

export const SETTINGS_WORKSPACE_STATE_DOCUMENT_VERSION = 2 as const

export type SettingsWorkspaceStateSource = 'stored' | 'initialized-defaults'

export interface SettingsWorkspaceStoredDefaultModelRouting {
  primaryAssistantModel: ModelRouteRef | null
  fastAssistantModel: ModelRouteRef | null
}

export interface SettingsWorkspaceEditableDefaultModelRouting {
  primaryAssistantModel: string
  fastAssistantModel: string
  primaryAssistantModelRoute?: ModelRouteRef | null
  fastAssistantModelRoute?: ModelRouteRef | null
}

export interface SettingsWorkspaceStateValues {
  sustech: {
    studentId: string
    email: string
    blackboardAutoDownloadEnabled: boolean
    blackboardDownloadLimitMb: string
  }
  providerProfiles: SettingsWorkspaceStoredProviderProfile[]
  defaultModelRouting: SettingsWorkspaceStoredDefaultModelRouting
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

export interface SettingsWorkspaceEditableState extends Omit<SettingsWorkspaceStateValues, 'providerProfiles' | 'defaultModelRouting'> {
  providerProfiles: ProviderProfile[]
  defaultModelRouting: SettingsWorkspaceEditableDefaultModelRouting
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
  const providerProfiles = normalizeStoredProviderProfiles(record.providerProfiles)

  return {
    sustech: normalizeBooleanStringGroup(record.sustech, defaults.sustech),
    providerProfiles,
    defaultModelRouting: normalizeStoredDefaultModelRouting(record.defaultModelRouting, providerProfiles),
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
  const clonedValues = cloneSettingsWorkspaceStateValues(values)

  return {
    sustech: clonedValues.sustech,
    providerProfiles: clonedValues.providerProfiles.map((profile) => {
      const profileId = normalizeNonEmptyString(profile.profileId, '')
      return projectEditableProviderProfile(profile, secretStates[profileId]?.hasApiKey ?? false)
    }),
    defaultModelRouting: projectEditableDefaultModelRouting(clonedValues.defaultModelRouting),
    general: clonedValues.general,
    data: clonedValues.data,
    mcp: clonedValues.mcp,
    search: clonedValues.search,
    memory: clonedValues.memory,
    api: clonedValues.api,
    docs: clonedValues.docs,
    externalSource: clonedValues.externalSource,
  }
}

function cloneSettingsWorkspaceStateValues(values: SettingsWorkspaceStateValues): SettingsWorkspaceStateValues {
  return {
    sustech: { ...values.sustech },
    providerProfiles: values.providerProfiles.map(cloneStoredProviderProfile),
    defaultModelRouting: cloneStoredDefaultModelRouting(values.defaultModelRouting),
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

function cloneStoredDefaultModelRouting(
  routing: SettingsWorkspaceStoredDefaultModelRouting,
): SettingsWorkspaceStoredDefaultModelRouting {
  return {
    primaryAssistantModel: cloneModelRouteRef(routing.primaryAssistantModel),
    fastAssistantModel: cloneModelRouteRef(routing.fastAssistantModel),
  }
}

function projectEditableDefaultModelRouting(
  routing: SettingsWorkspaceStoredDefaultModelRouting,
): SettingsWorkspaceEditableDefaultModelRouting {
  return {
    primaryAssistantModel: routing.primaryAssistantModel?.modelId ?? '',
    fastAssistantModel: routing.fastAssistantModel?.modelId ?? '',
    primaryAssistantModelRoute: cloneModelRouteRef(routing.primaryAssistantModel),
    fastAssistantModelRoute: cloneModelRouteRef(routing.fastAssistantModel),
  }
}

function normalizeStoredDefaultModelRouting(
  input: unknown,
  providerProfiles: SettingsWorkspaceStoredProviderProfile[],
): SettingsWorkspaceStoredDefaultModelRouting {
  const record = asRecord(input)

  return {
    primaryAssistantModel: normalizeStoredDefaultModelRoute(record.primaryAssistantModel, providerProfiles),
    fastAssistantModel: normalizeStoredDefaultModelRoute(record.fastAssistantModel, providerProfiles),
  }
}

function normalizeStoredDefaultModelRoute(
  input: unknown,
  providerProfiles: SettingsWorkspaceStoredProviderProfile[],
): ModelRouteRef | null {
  if (typeof input === 'string') {
    return migrateLegacyDefaultModelRoute(input, providerProfiles)
  }

  return normalizeStoredModelRouteRef(input, providerProfiles)
}

function normalizeStoredModelRouteRef(
  input: unknown,
  providerProfiles: SettingsWorkspaceStoredProviderProfile[],
): ModelRouteRef | null {
  const record = asRecord(input)
  const routeKind = normalizeNonEmptyString(record.routeKind, '')
  const profileId = normalizeNonEmptyString(record.profileId, '')
  const modelId = normalizeNonEmptyString(record.modelId, '')

  if (routeKind !== 'provider-model' || profileId === '' || modelId === '') {
    return null
  }

  const profile = providerProfiles.find((candidate) => candidate.profileId === profileId)
  if (profile === undefined || !profileSupportsModel(profile, modelId)) {
    return null
  }

  return {
    routeKind: 'provider-model',
    profileId,
    modelId,
  }
}

function migrateLegacyDefaultModelRoute(
  legacyModelId: string,
  providerProfiles: SettingsWorkspaceStoredProviderProfile[],
): ModelRouteRef | null {
  const normalizedModelId = normalizeNonEmptyString(legacyModelId, '')
  if (normalizedModelId === '') {
    return null
  }

  const matchingProfiles = providerProfiles.filter((profile) => profileSupportsModel(profile, normalizedModelId))
  if (matchingProfiles.length !== 1) {
    return null
  }

  return {
    routeKind: 'provider-model',
    profileId: matchingProfiles[0]!.profileId,
    modelId: normalizedModelId,
  }
}

function profileSupportsModel(
  profile: SettingsWorkspaceStoredProviderProfile,
  modelId: string,
): boolean {
  return profile.models.some((model) => normalizeNonEmptyString(model.modelId, '') === modelId)
}

function cloneModelRouteRef(routeRef: ModelRouteRef | null): ModelRouteRef | null {
  return routeRef === null
    ? null
    : {
      routeKind: routeRef.routeKind,
      profileId: routeRef.profileId,
      modelId: routeRef.modelId,
    }
}
