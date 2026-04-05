import type { ModelCapability, ProviderModelProfile, ProviderProfile } from '../../src/workbench/types'
import { initialProviderProfiles } from '../../src/workbench/settings/config'
import {
  cloneThinkingCapabilityDeclaration,
  normalizeThinkingCapabilityDeclaration,
} from '../../src/workbench/thinking-capabilities'
import { asRecord, normalizeBoolean, normalizeNonEmptyString, normalizeString } from './normalize'

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

export function createDefaultStoredProviderProfiles(): SettingsWorkspaceStoredProviderProfile[] {
  return initialProviderProfiles.map((profile) => projectStoredProviderProfile(profile))
}

export function createDefaultSettingsWorkspaceDefaultModelRouting(): {
  primaryAssistantModel: string
  fastAssistantModel: string
} {
  return {
    primaryAssistantModel: initialProviderProfiles[0]?.defaultModel ?? '',
    fastAssistantModel: initialProviderProfiles[0]?.fastModel ?? '',
  }
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

export function cloneStoredProviderProfile(
  profile: SettingsWorkspaceStoredProviderProfile,
): SettingsWorkspaceStoredProviderProfile {
  return {
    ...profile,
    availableModels: profile.availableModels.map(cloneProviderModelProfile),
  }
}

export function cloneProviderModelProfile(model: ProviderModelProfile): ProviderModelProfile {
  return {
    ...model,
    capabilities: [...model.capabilities],
    thinkingCapability: cloneThinkingCapabilityDeclaration(model.thinkingCapability),
  }
}

export function normalizeStoredProviderProfiles(input: unknown): SettingsWorkspaceStoredProviderProfile[] {
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
    thinkingCapability: normalizeThinkingCapabilityDeclaration(record.thinkingCapability),
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
