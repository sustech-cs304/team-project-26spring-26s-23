import {
  getProviderCatalogEntry,
  normalizeProviderCatalogIdentifier,
} from '../../src/provider-catalog'
import type {
  ModelCapability,
  ProviderModelProfile,
  ProviderProfile,
  ProviderProfileCompatibility,
  ProviderProfileExtensions,
} from '../../src/workbench/types'
import { initialProviderProfiles } from '../../src/workbench/settings/config'
import {
  cloneThinkingCapabilityDeclaration,
  normalizeThinkingCapabilityDeclaration,
} from '../../src/workbench/thinking-capabilities'
import { asRecord, normalizeBoolean, normalizeNonEmptyString, normalizeString } from './normalize'

export interface SettingsWorkspaceStoredProviderProfile {
  profileId: string
  providerId: string
  displayName: string
  baseUrl: string
  models: ProviderModelProfile[]
  compatibility: ProviderProfileCompatibility
  extensions: ProviderProfileExtensions
}

export function createDefaultStoredProviderProfiles(): SettingsWorkspaceStoredProviderProfile[] {
  return initialProviderProfiles.map((profile) => projectStoredProviderProfile(profile))
}

export function projectStoredProviderProfile(profile: ProviderProfile): SettingsWorkspaceStoredProviderProfile {
  const profileId = normalizeNonEmptyString(profile.profileId, profile.id)
  const providerId = resolveStoredProviderId({
    providerId: profile.providerId,
    protocol: profile.protocol,
    profileId,
  })
  const displayName = normalizeNonEmptyString(profile.name, normalizeNonEmptyString(profile.displayName, profile.name))
  const extensions = normalizeProviderProfileExtensions({
    ...(profile.extensions ?? {}),
    ...buildLegacyProviderProfileExtensionPatch(profile, providerId),
  })
  const models = ensureTrackedModels(
    normalizeProviderModelProfiles(profile.availableModels, profileId),
    profileId,
    displayName,
    [
      getProviderProfileExtensionString(extensions, 'fastModel'),
      getProviderProfileExtensionString(extensions, 'fallbackModel'),
    ],
  )

  return {
    profileId,
    providerId,
    displayName,
    baseUrl: normalizeString(profile.baseUrl, profile.endpoint),
    models,
    compatibility: normalizeStoredProviderCompatibility(profile.compatibility, providerId),
    extensions,
  }
}

export function projectEditableProviderProfile(
  profile: SettingsWorkspaceStoredProviderProfile,
  hasApiKey: boolean,
): ProviderProfile {
  const protocol = getProviderProfileExtensionString(profile.extensions, 'legacyProtocol') || profile.providerId

  return {
    id: profile.profileId,
    profileId: profile.profileId,
    providerId: profile.providerId,
    name: profile.displayName,
    displayName: profile.displayName,
    protocol,
    endpoint: profile.baseUrl,
    baseUrl: profile.baseUrl,
    hasApiKey,
    fastModel: getProviderProfileExtensionString(profile.extensions, 'fastModel'),
    fallbackModel: getProviderProfileExtensionString(profile.extensions, 'fallbackModel'),
    organization: getProviderProfileExtensionString(profile.extensions, 'organization'),
    region: getProviderProfileExtensionString(profile.extensions, 'region'),
    notes: getProviderProfileExtensionString(profile.extensions, 'notes'),
    compatibility: cloneStoredProviderCompatibility(profile.compatibility),
    extensions: cloneProviderProfileExtensions(profile.extensions),
    availableModels: profile.models.map(cloneProviderModelProfile),
  }
}

export function cloneStoredProviderProfile(
  profile: SettingsWorkspaceStoredProviderProfile,
): SettingsWorkspaceStoredProviderProfile {
  return {
    ...profile,
    models: profile.models.map(cloneProviderModelProfile),
    compatibility: cloneStoredProviderCompatibility(profile.compatibility),
    extensions: cloneProviderProfileExtensions(profile.extensions),
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
  const profileId = normalizeNonEmptyString(record.profileId, normalizeNonEmptyString(record.id, `provider-${index + 1}`))

  if (profileId === '') {
    return null
  }

  const providerId = resolveStoredProviderId({
    providerId: normalizeString(record.providerId, ''),
    protocol: normalizeString(record.protocol, ''),
    profileId,
  })
  const displayName = normalizeNonEmptyString(record.displayName, normalizeNonEmptyString(record.name, `Provider ${index + 1}`))
  const baseUrl = normalizeString(record.baseUrl, normalizeString(record.endpoint, ''))
  const extensions = normalizeProviderProfileExtensions({
    ...asRecord(record.extensions),
    ...buildLegacyProviderProfileExtensionPatch({
      id: profileId,
      profileId,
      providerId,
      name: displayName,
      displayName,
      protocol: normalizeString(record.protocol, providerId),
      endpoint: baseUrl,
      baseUrl,
      hasApiKey: false,
      fastModel: normalizeString(record.fastModel, ''),
      fallbackModel: normalizeString(record.fallbackModel, ''),
      organization: normalizeString(record.organization, ''),
      region: normalizeString(record.region, ''),
      notes: normalizeString(record.notes, ''),
      compatibility: undefined,
      extensions: undefined,
      availableModels: [],
    }, providerId),
  })
  const rawModels = normalizeProviderModelProfiles(
    Array.isArray(record.models) ? record.models : record.availableModels,
    profileId,
  )
  const models = ensureTrackedModels(rawModels, profileId, displayName, [
    getProviderProfileExtensionString(extensions, 'fastModel'),
    getProviderProfileExtensionString(extensions, 'fallbackModel'),
  ])

  return {
    profileId,
    providerId,
    displayName,
    baseUrl,
    models,
    compatibility: normalizeStoredProviderCompatibility(record.compatibility, providerId),
    extensions,
  }
}

function normalizeProviderModelProfiles(input: unknown, profileId: string): ProviderModelProfile[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .map((model, index) => normalizeProviderModelProfile(model, profileId, index))
    .filter((model): model is ProviderModelProfile => model !== null)
}

function normalizeProviderModelProfile(
  input: unknown,
  profileId: string,
  index: number,
): ProviderModelProfile | null {
  const record = asRecord(input)
  const modelId = normalizeNonEmptyString(record.modelId, '')

  if (modelId === '') {
    return null
  }

  return {
    id: normalizeNonEmptyString(record.id, `${profileId}-model-${index + 1}`),
    modelId,
    displayName: normalizeNonEmptyString(record.displayName, modelId),
    groupName: normalizeNonEmptyString(record.groupName, profileId),
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

function resolveStoredProviderId(input: {
  providerId?: string
  protocol?: string
  profileId: string
}): string {
  const directProviderId = normalizeProviderCatalogIdentifier(input.providerId ?? '')
  if (directProviderId !== '') {
    return getProviderCatalogEntry(directProviderId)?.providerId ?? directProviderId
  }

  const protocolProviderId = normalizeProviderCatalogIdentifier(input.protocol ?? '')
  if (protocolProviderId !== '') {
    return getProviderCatalogEntry(protocolProviderId)?.providerId ?? protocolProviderId
  }

  const fallbackProfileId = normalizeProviderCatalogIdentifier(input.profileId)
  return fallbackProfileId || 'unknown-provider'
}

function normalizeStoredProviderCompatibility(
  input: unknown,
  providerId: string,
): ProviderProfileCompatibility {
  const record = asRecord(input)
  const status = normalizeNonEmptyString(record.status, '')
  const reason = normalizeString(record.reason, '')

  if (status === 'active' || status === 'legacy' || status === 'unsupported') {
    return {
      status,
      reason,
    }
  }

  const catalogEntry = getProviderCatalogEntry(providerId)
  if (catalogEntry === null) {
    return {
      status: 'unsupported',
      reason: `Provider '${providerId}' is not defined in the current provider catalog.`,
    }
  }

  if (catalogEntry.runtimeStatus === 'legacy-unsupported') {
    return {
      status: 'legacy',
      reason: `Provider '${catalogEntry.providerId}' is marked as legacy / unsupported in the provider catalog.`,
    }
  }

  return {
    status: 'active',
    reason: '',
  }
}

function ensureTrackedModels(
  models: ProviderModelProfile[],
  profileId: string,
  displayName: string,
  trackedModelIds: string[],
): ProviderModelProfile[] {
  const normalizedModels = models.map(cloneProviderModelProfile)
  const knownModelIds = new Set(
    normalizedModels
      .map((model) => normalizeNonEmptyString(model.modelId, ''))
      .filter((modelId) => modelId !== ''),
  )

  trackedModelIds.forEach((modelId, index) => {
    const normalizedModelId = normalizeNonEmptyString(modelId, '')
    if (normalizedModelId === '' || knownModelIds.has(normalizedModelId)) {
      return
    }

    normalizedModels.push(createPlaceholderProviderModelProfile(profileId, displayName, normalizedModelId, index))
    knownModelIds.add(normalizedModelId)
  })

  return normalizedModels
}

function createPlaceholderProviderModelProfile(
  profileId: string,
  displayName: string,
  modelId: string,
  index: number,
): ProviderModelProfile {
  return {
    id: `${profileId}-migrated-model-${index + 1}`,
    modelId,
    displayName: modelId,
    groupName: displayName,
    capabilities: ['reasoning'],
    thinkingCapability: undefined,
    supportsStreaming: true,
    currency: 'usd',
    inputPrice: '0.50',
    outputPrice: '3.00',
  }
}

function buildLegacyProviderProfileExtensionPatch(
  profile: ProviderProfile,
  providerId: string,
): ProviderProfileExtensions {
  const protocol = normalizeProviderCatalogIdentifier(profile.protocol)

  return normalizeProviderProfileExtensions({
    fastModel: profile.fastModel,
    fallbackModel: profile.fallbackModel,
    organization: profile.organization,
    region: profile.region,
    notes: profile.notes,
    ...(protocol !== '' && protocol !== providerId ? { legacyProtocol: protocol } : {}),
  })
}

function normalizeProviderProfileExtensions(input: unknown): ProviderProfileExtensions {
  const record = asRecord(input)
  const normalizedExtensions: ProviderProfileExtensions = {}

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = normalizeNonEmptyString(key, '')
    if (normalizedKey === '') {
      continue
    }

    if (typeof value === 'string') {
      const normalizedValue = value.trim()
      if (normalizedValue !== '') {
        normalizedExtensions[normalizedKey] = normalizedValue
      }
      continue
    }

    if (typeof value === 'number') {
      if (Number.isFinite(value)) {
        normalizedExtensions[normalizedKey] = value
      }
      continue
    }

    if (typeof value === 'boolean' || value === null) {
      normalizedExtensions[normalizedKey] = value
    }
  }

  return normalizedExtensions
}

function cloneProviderProfileExtensions(extensions: ProviderProfileExtensions): ProviderProfileExtensions {
  return { ...extensions }
}

function cloneStoredProviderCompatibility(
  compatibility: ProviderProfileCompatibility,
): ProviderProfileCompatibility {
  return {
    status: compatibility.status,
    reason: compatibility.reason,
  }
}

function getProviderProfileExtensionString(extensions: ProviderProfileExtensions, key: string): string {
  const value = extensions[key]
  return typeof value === 'string' ? value : ''
}

