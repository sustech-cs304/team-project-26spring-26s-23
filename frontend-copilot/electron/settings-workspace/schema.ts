import type { ModelCapability, ProviderModelProfile, ProviderProfile } from '../../src/workbench/types'
import { initialProviderProfiles } from '../../src/workbench/settings/config'

export const SETTINGS_WORKSPACE_STATE_DOCUMENT_VERSION = 1 as const
export const SETTINGS_WORKSPACE_SECRETS_DOCUMENT_VERSION = 1 as const

export type SettingsWorkspaceStateSource = 'stored' | 'initialized-defaults'

export interface SettingsWorkspaceStoredProviderProfile {
  id: string
  name: string
  protocol: string
  endpoint: string
  defaultModel: string
  fastModel: string
  fallbackModel: string
  organization: string
  region: string
  notes: string
  availableModels: ProviderModelProfile[]
}

export interface SettingsWorkspaceStateValues {
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
}

export interface SettingsWorkspaceStateDocument {
  version: typeof SETTINGS_WORKSPACE_STATE_DOCUMENT_VERSION
  kind: 'settings-workspace-state'
  values: SettingsWorkspaceStateValues
}

export interface SettingsWorkspaceSecretRecord {
  apiKey: string
}

export interface SettingsWorkspaceSecretsValues {
  providerSecrets: Record<string, SettingsWorkspaceSecretRecord>
}

export interface SettingsWorkspaceSecretsDocument {
  version: typeof SETTINGS_WORKSPACE_SECRETS_DOCUMENT_VERSION
  kind: 'settings-workspace-secrets'
  values: SettingsWorkspaceSecretsValues
}

export interface SettingsWorkspaceProviderSecretState {
  hasApiKey: boolean
  apiKey: string
}

export type SettingsWorkspaceProviderSecretStateById = Record<string, SettingsWorkspaceProviderSecretState>

export interface SettingsWorkspaceEditableState extends Omit<SettingsWorkspaceStateValues, 'providerProfiles'> {
  providerProfiles: ProviderProfile[]
}

export type SettingsWorkspaceStateSaveInput = SettingsWorkspaceStateValues

const DEFAULT_SETTINGS_WORKSPACE_STATE_VALUES: SettingsWorkspaceStateValues = {
  providerProfiles: createDefaultStoredProviderProfiles(),
  defaultModelRouting: {
    primaryAssistantModel: initialProviderProfiles[0]?.defaultModel ?? '',
    fastAssistantModel: initialProviderProfiles[0]?.fastModel ?? '',
  },
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
    providerProfiles: normalizeStoredProviderProfiles(record.providerProfiles),
    defaultModelRouting: normalizeStringGroup(record.defaultModelRouting, defaults.defaultModelRouting),
    general: normalizeBooleanStringGroup(record.general, defaults.general),
    data: normalizeBooleanStringGroup(record.data, defaults.data),
    mcp: normalizeBooleanStringGroup(record.mcp, defaults.mcp),
    search: normalizeStringGroup(record.search, defaults.search),
    memory: normalizeBooleanStringGroup(record.memory, defaults.memory),
    api: normalizeBooleanStringGroup(record.api, defaults.api),
    docs: normalizeBooleanStringGroup(record.docs, defaults.docs),
  }
}

export function normalizeSettingsWorkspaceStateDocument(input: unknown): SettingsWorkspaceStateDocument {
  const record = asRecord(input)
  return createSettingsWorkspaceStateDocument(normalizeSettingsWorkspaceStateValues(record.values))
}

export function createDefaultSettingsWorkspaceSecretsDocument(): SettingsWorkspaceSecretsDocument {
  return createSettingsWorkspaceSecretsDocument({ providerSecrets: {} })
}

export function createSettingsWorkspaceSecretsDocument(
  values: SettingsWorkspaceSecretsValues,
): SettingsWorkspaceSecretsDocument {
  return {
    version: SETTINGS_WORKSPACE_SECRETS_DOCUMENT_VERSION,
    kind: 'settings-workspace-secrets',
    values: {
      providerSecrets: Object.fromEntries(
        Object.entries(values.providerSecrets).flatMap(([providerId, secret]) => {
          const normalizedProviderId = normalizeNonEmptyString(providerId, '')
          const normalizedApiKey = normalizeNonEmptyString(secret.apiKey, '')

          if (!normalizedProviderId || !normalizedApiKey) {
            return []
          }

          return [[normalizedProviderId, { apiKey: normalizedApiKey }]]
        }),
      ),
    },
  }
}

export function normalizeSettingsWorkspaceSecretsDocument(input: unknown): SettingsWorkspaceSecretsDocument {
  const record = asRecord(input)
  const values = asRecord(record.values)
  const providerSecrets = asRecord(values.providerSecrets)

  return createSettingsWorkspaceSecretsDocument({
    providerSecrets: Object.fromEntries(
      Object.entries(providerSecrets).flatMap(([providerId, secretRecord]) => {
        const normalizedProviderId = normalizeNonEmptyString(providerId, '')
        const normalizedApiKey = normalizeNonEmptyString(asRecord(secretRecord).apiKey, '')

        if (!normalizedProviderId || !normalizedApiKey) {
          return []
        }

        return [[normalizedProviderId, { apiKey: normalizedApiKey }]]
      }),
    ),
  })
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

export function projectProviderSecretStateById(
  providerIds: readonly string[],
  secretsDocument: SettingsWorkspaceSecretsDocument,
): SettingsWorkspaceProviderSecretStateById {
  return Object.fromEntries(
    providerIds.map((providerId) => {
      const normalizedProviderId = normalizeNonEmptyString(providerId, '')
      const apiKey =
        normalizedProviderId === ''
          ? ''
          : normalizeNonEmptyString(secretsDocument.values.providerSecrets[normalizedProviderId]?.apiKey, '')

      return [
        providerId,
        {
          hasApiKey: apiKey !== '',
          apiKey,
        },
      ]
    }),
  )
}

export function projectStoredProviderProfile(profile: ProviderProfile): SettingsWorkspaceStoredProviderProfile {
  return {
    id: profile.id,
    name: profile.name,
    protocol: profile.protocol,
    endpoint: profile.endpoint,
    defaultModel: profile.defaultModel,
    fastModel: profile.fastModel,
    fallbackModel: profile.fallbackModel,
    organization: profile.organization,
    region: profile.region,
    notes: profile.notes,
    availableModels: profile.availableModels.map(cloneProviderModelProfile),
  }
}

function cloneSettingsWorkspaceStateValues(values: SettingsWorkspaceStateValues): SettingsWorkspaceStateValues {
  return {
    providerProfiles: values.providerProfiles.map(cloneStoredProviderProfile),
    defaultModelRouting: { ...values.defaultModelRouting },
    general: { ...values.general },
    data: { ...values.data },
    mcp: { ...values.mcp },
    search: { ...values.search },
    memory: { ...values.memory },
    api: { ...values.api },
    docs: { ...values.docs },
  }
}

function createDefaultStoredProviderProfiles(): SettingsWorkspaceStoredProviderProfile[] {
  return initialProviderProfiles.map((profile) => projectStoredProviderProfile(profile))
}

function cloneStoredProviderProfile(profile: SettingsWorkspaceStoredProviderProfile): SettingsWorkspaceStoredProviderProfile {
  return {
    ...profile,
    availableModels: profile.availableModels.map(cloneProviderModelProfile),
  }
}

function cloneProviderModelProfile(model: ProviderModelProfile): ProviderModelProfile {
  return {
    ...model,
    capabilities: [...model.capabilities],
  }
}

function normalizeStoredProviderProfiles(input: unknown): SettingsWorkspaceStoredProviderProfile[] {
  if (!Array.isArray(input)) {
    return createDefaultStoredProviderProfiles()
  }

  const normalizedProfiles = input
    .map((profile, index) => normalizeStoredProviderProfile(profile, index))
    .filter((profile): profile is SettingsWorkspaceStoredProviderProfile => profile !== null)

  return normalizedProfiles.length > 0 ? normalizedProfiles : createDefaultStoredProviderProfiles()
}

function normalizeStoredProviderProfile(
  input: unknown,
  index: number,
): SettingsWorkspaceStoredProviderProfile | null {
  const record = asRecord(input)
  const providerId = normalizeNonEmptyString(record.id, `provider-${index + 1}`)

  if (providerId === '') {
    return null
  }

  const availableModels = normalizeProviderModelProfiles(record.availableModels, providerId)
  const defaultModel = normalizeNonEmptyString(record.defaultModel, availableModels[0]?.modelId ?? 'default-model')
  const fastModel = normalizeNonEmptyString(record.fastModel, availableModels[1]?.modelId ?? defaultModel)
  const fallbackModel = normalizeNonEmptyString(record.fallbackModel, availableModels[2]?.modelId ?? defaultModel)

  return {
    id: providerId,
    name: normalizeNonEmptyString(record.name, `Provider ${index + 1}`),
    protocol: normalizeNonEmptyString(record.protocol, 'openai'),
    endpoint: normalizeNonEmptyString(record.endpoint, 'https://api.example.com/v1'),
    defaultModel,
    fastModel,
    fallbackModel,
    organization: normalizeString(record.organization, ''),
    region: normalizeNonEmptyString(record.region, 'Global'),
    notes: normalizeString(record.notes, ''),
    availableModels,
  }
}

function normalizeProviderModelProfiles(input: unknown, providerId: string): ProviderModelProfile[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .map((model, index) => normalizeProviderModelProfile(model, providerId, index))
    .filter((model): model is ProviderModelProfile => model !== null)
}

function normalizeProviderModelProfile(
  input: unknown,
  providerId: string,
  index: number,
): ProviderModelProfile | null {
  const record = asRecord(input)
  const modelId = normalizeNonEmptyString(record.modelId, '')

  if (modelId === '') {
    return null
  }

  return {
    id: normalizeNonEmptyString(record.id, `${providerId}-model-${index + 1}`),
    modelId,
    displayName: normalizeNonEmptyString(record.displayName, modelId),
    groupName: normalizeNonEmptyString(record.groupName, providerId),
    capabilities: normalizeModelCapabilities(record.capabilities),
    supportsStreaming: normalizeBoolean(record.supportsStreaming, true),
    currency: normalizeNonEmptyString(record.currency, 'usd'),
    inputPrice: normalizeNonEmptyString(record.inputPrice, '0.50'),
    outputPrice: normalizeNonEmptyString(record.outputPrice, '3.00'),
  }
}

function normalizeModelCapabilities(input: unknown): ModelCapability[] {
  if (!Array.isArray(input)) {
    return ['reasoning']
  }

  const capabilities = input
    .map((capability) => normalizeNonEmptyString(capability, ''))
    .filter((capability): capability is ModelCapability => {
      return capability === 'vision'
        || capability === 'search'
        || capability === 'reasoning'
        || capability === 'tools'
        || capability === 'rerank'
        || capability === 'embedding'
    })

  return capabilities.length > 0 ? Array.from(new Set(capabilities)) : ['reasoning']
}

function normalizeStringGroup<TGroup extends Record<string, string>>(input: unknown, defaults: TGroup): TGroup {
  const record = asRecord(input)

  return Object.fromEntries(
    Object.entries(defaults).map(([key, defaultValue]) => [key, normalizeNonEmptyString(record[key], defaultValue)]),
  ) as TGroup
}

function normalizeBooleanStringGroup<TGroup extends Record<string, boolean | string>>(
  input: unknown,
  defaults: TGroup,
): TGroup {
  const record = asRecord(input)

  return Object.fromEntries(
    Object.entries(defaults).map(([key, defaultValue]) => {
      return [
        key,
        typeof defaultValue === 'boolean'
          ? normalizeBoolean(record[key], defaultValue)
          : normalizeNonEmptyString(record[key], defaultValue),
      ]
    }),
  ) as TGroup
}

function normalizeNonEmptyString(input: unknown, fallback: string): string {
  const normalized = normalizeString(input, fallback)
  return normalized === '' ? fallback : normalized
}

function normalizeString(input: unknown, fallback: string): string {
  return typeof input === 'string' ? input.trim() : fallback
}

function normalizeBoolean(input: unknown, fallback: boolean): boolean {
  return typeof input === 'boolean' ? input : fallback
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}
