import type {
  ModelRouteRef,
  ProviderProfile,
} from '../../src/workbench/types'
import type { SettingsWorkspaceProviderSecretStateById } from './secret-schema'
import {
  cloneStoredProviderProfile,
  createDefaultStoredProviderProfiles,
  normalizeStoredProviderProfiles,
  projectEditableProviderProfile,
  type SettingsWorkspaceStoredProviderProfile,
} from './provider-schema'
import { asRecord, normalizeBooleanStringGroup, normalizeNonEmptyString, normalizeStringGroup } from './normalize'

export const SETTINGS_WORKSPACE_STATE_DOCUMENT_VERSION = 3 as const

export type LegacyToolPermissionMode = 'manual' | 'trusted' | 'strict'
export type ToolPermissionPolicyMode = 'allow' | 'ask' | 'deny' | 'delay'
export type ToolPermissionPolicySource = 'user' | 'migrated'

export interface SettingsWorkspaceToolPermissionPolicyEntry {
  mode: ToolPermissionPolicyMode
  timeoutAction?: 'approve' | 'deny'
  timeoutSeconds?: number
  source?: ToolPermissionPolicySource
  updatedAt?: string
}

export interface SettingsWorkspaceToolPermissionPolicyState {
  version: 1
  migrationSourceMode?: LegacyToolPermissionMode
  defaultMode: ToolPermissionPolicyMode
  toolPermissions: Record<string, SettingsWorkspaceToolPermissionPolicyEntry>
}

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
    assistantNotificationsEnabled: boolean
  }
  mcp: {
    mcpAutoDiscoveryEnabled: boolean
    toolPermissionMode: LegacyToolPermissionMode
    toolPermissionPolicy: SettingsWorkspaceToolPermissionPolicyState
  }
  api: {
    apiReconnectMode: string
    healthPollingEnabled: boolean
    apiBaseUrl: string
  }
  docs: {
    docsFormat: string
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
  defaultModelRouting: {
    primaryAssistantModel: null,
    fastAssistantModel: null,
  },
  general: {
    language: 'zh-CN',
    assistantNotificationsEnabled: false,
  },
  mcp: {
    mcpAutoDiscoveryEnabled: true,
    toolPermissionMode: 'manual',
    toolPermissionPolicy: {
      ...createDefaultToolPermissionPolicyState('ask'),
      migrationSourceMode: 'manual',
    },
  },
  api: {
    apiReconnectMode: 'exponential',
    healthPollingEnabled: true,
    apiBaseUrl: 'http://127.0.0.1:8000',
  },
  docs: {
    docsFormat: 'markdown',
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

  const normalizedMcp = normalizeMcpState(record.mcp, defaults.mcp)

  return {
    sustech: normalizeBooleanStringGroup(record.sustech, defaults.sustech),
    providerProfiles,
    defaultModelRouting: normalizeStoredDefaultModelRouting(record.defaultModelRouting, providerProfiles),
    general: normalizeBooleanStringGroup(record.general, defaults.general),
    mcp: normalizedMcp,
    api: normalizeBooleanStringGroup(record.api, defaults.api),
    docs: normalizeStringGroup(record.docs, defaults.docs),
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
    mcp: clonedValues.mcp,
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
    mcp: {
      mcpAutoDiscoveryEnabled: values.mcp.mcpAutoDiscoveryEnabled,
      toolPermissionMode: values.mcp.toolPermissionMode,
      toolPermissionPolicy: cloneToolPermissionPolicyState(values.mcp.toolPermissionPolicy),
    },
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

function normalizeMcpState(
  input: unknown,
  defaults: SettingsWorkspaceStateValues['mcp'],
): SettingsWorkspaceStateValues['mcp'] {
  const record = asRecord(input)
  const legacyMode = normalizeLegacyToolPermissionMode(record.toolPermissionMode)
  const toolPermissionPolicy = normalizeToolPermissionPolicyState(record.toolPermissionPolicy, legacyMode)

  return {
    mcpAutoDiscoveryEnabled: typeof record.mcpAutoDiscoveryEnabled === 'boolean'
      ? record.mcpAutoDiscoveryEnabled
      : defaults.mcpAutoDiscoveryEnabled,
    toolPermissionMode: legacyModeToStoredValue(toolPermissionPolicy.defaultMode),
    toolPermissionPolicy,
  }
}

function createDefaultToolPermissionPolicyState(
  defaultMode: ToolPermissionPolicyMode,
): SettingsWorkspaceToolPermissionPolicyState {
  return {
    version: 1,
    defaultMode,
    toolPermissions: {},
  }
}

function cloneToolPermissionPolicyState(
  state: SettingsWorkspaceToolPermissionPolicyState,
): SettingsWorkspaceToolPermissionPolicyState {
  return {
    version: state.version,
    migrationSourceMode: state.migrationSourceMode,
    defaultMode: state.defaultMode,
    toolPermissions: Object.fromEntries(
      Object.entries(state.toolPermissions).map(([toolId, entry]) => [toolId, { ...entry }]),
    ),
  }
}

function normalizeToolPermissionPolicyState(
  input: unknown,
  legacyMode: LegacyToolPermissionMode,
): SettingsWorkspaceToolPermissionPolicyState {
  const record = asRecord(input)
  const version = record.version === 1 ? 1 : null
  const defaultMode = normalizeToolPermissionPolicyMode(record.defaultMode)

  if (version === 1 && defaultMode !== null) {
    return {
      version: 1,
      migrationSourceMode: normalizeLegacyToolPermissionModeOptional(record.migrationSourceMode) ?? undefined,
      defaultMode,
      toolPermissions: normalizeToolPermissionPolicyEntries(record.toolPermissions),
    }
  }

  return {
    version: 1,
    migrationSourceMode: legacyMode,
    defaultMode: migrateLegacyToolPermissionMode(legacyMode),
    toolPermissions: {},
  }
}

function normalizeToolPermissionPolicyEntries(
  input: unknown,
): Record<string, SettingsWorkspaceToolPermissionPolicyEntry> {
  const record = asRecord(input)
  const entries = Object.entries(record).flatMap(([toolId, rawEntry]) => {
    const entryRecord = asRecord(rawEntry)
    const mode = normalizeToolPermissionPolicyMode(entryRecord.mode)
    if (mode === null) {
      return []
    }

    const normalizedEntry: SettingsWorkspaceToolPermissionPolicyEntry = { mode }
    const timeoutAction = normalizeToolPermissionTimeoutAction(entryRecord.timeoutAction)
    const timeoutSeconds = normalizeToolPermissionTimeoutSeconds(entryRecord.timeoutSeconds)
    const source = normalizeToolPermissionPolicySource(entryRecord.source)
    const updatedAt = normalizeNonEmptyString(entryRecord.updatedAt, '')

    if (timeoutAction !== null) {
      normalizedEntry.timeoutAction = timeoutAction
    }
    if (timeoutSeconds !== null) {
      normalizedEntry.timeoutSeconds = timeoutSeconds
    }
    if (source !== null) {
      normalizedEntry.source = source
    }
    if (updatedAt !== '') {
      normalizedEntry.updatedAt = updatedAt
    }

    return [[toolId, normalizedEntry]]
  })

  return Object.fromEntries(entries)
}

function normalizeLegacyToolPermissionMode(input: unknown): LegacyToolPermissionMode {
  return normalizeLegacyToolPermissionModeOptional(input) ?? 'manual'
}

function normalizeLegacyToolPermissionModeOptional(input: unknown): LegacyToolPermissionMode | null {
  switch (normalizeNonEmptyString(input, '')) {
    case 'manual':
    case 'trusted':
    case 'strict':
      return input as LegacyToolPermissionMode
    default:
      return null
  }
}

function normalizeToolPermissionPolicyMode(input: unknown): ToolPermissionPolicyMode | null {
  switch (normalizeNonEmptyString(input, '')) {
    case 'allow':
    case 'ask':
    case 'deny':
    case 'delay':
      return input as ToolPermissionPolicyMode
    default:
      return null
  }
}

function normalizeToolPermissionTimeoutAction(input: unknown): 'approve' | 'deny' | null {
  switch (normalizeNonEmptyString(input, '')) {
    case 'approve':
    case 'deny':
      return input as 'approve' | 'deny'
    default:
      return null
  }
}

function normalizeToolPermissionTimeoutSeconds(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return null
  }
  const normalized = Math.trunc(input)
  return normalized > 0 ? normalized : null
}

function normalizeToolPermissionPolicySource(input: unknown): ToolPermissionPolicySource | null {
  switch (normalizeNonEmptyString(input, '')) {
    case 'user':
    case 'migrated':
      return input as ToolPermissionPolicySource
    default:
      return null
  }
}

function migrateLegacyToolPermissionMode(mode: LegacyToolPermissionMode): ToolPermissionPolicyMode {
  switch (mode) {
    case 'trusted':
      return 'allow'
    case 'strict':
      return 'deny'
    case 'manual':
    default:
      return 'ask'
  }
}

function legacyModeToStoredValue(mode: ToolPermissionPolicyMode): LegacyToolPermissionMode {
  switch (mode) {
    case 'allow':
      return 'trusted'
    case 'deny':
    case 'delay':
      return 'strict'
    case 'ask':
    default:
      return 'manual'
  }
}
