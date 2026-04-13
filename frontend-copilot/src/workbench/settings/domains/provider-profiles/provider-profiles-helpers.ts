import {
  createProviderSelectOptions,
  getProviderCatalogEntry,
  type ProviderCatalogEntry,
} from '../../../../provider-catalog'
import { normalizeWorkbenchLanguage, type WorkbenchLanguage } from '../../../locale'
import type { ProviderProfile, SelectOption } from '../../../types'
import { createPlaceholderProviderProfile } from './provider-profiles'

const providerHelperCopy: Record<WorkbenchLanguage, {
  unknownProvider: string
  currentProviderUnavailable: string
  currentProviderUnavailableHint: string
  supportedPrefix: string
  noCapabilities: string
  apiKeyLabel: string
  optionalApiKeyLabel: string
  noApiKeyRequired: string
  configuredPlaceholder: string
  emptyPlaceholder: string
  serviceUrlPlaceholder: string
  missingBaseUrl: string
  previewUnavailable: string
  previewPrefix: string
  modelListReadonly: string
  legacyUnsupportedReason: string
}> = {
  'zh-CN': {
    unknownProvider: '未知服务',
    currentProviderUnavailable: '当前服务不可用',
    currentProviderUnavailableHint: '请重新选择服务类型或检查配置。',
    supportedPrefix: '支持：',
    noCapabilities: '可用功能信息暂未提供。',
    apiKeyLabel: 'API 密钥',
    optionalApiKeyLabel: 'API 密钥（可选）',
    noApiKeyRequired: '当前服务无需填写 API 密钥。',
    configuredPlaceholder: '已配置，输入新密钥以替换',
    emptyPlaceholder: '输入访问密钥',
    serviceUrlPlaceholder: 'https://api.example.com/v1',
    missingBaseUrl: '未填写服务地址',
    previewUnavailable: '无法预览完整请求路径',
    previewPrefix: '链接预览：',
    modelListReadonly: '当前模型列表暂不可编辑。',
    legacyUnsupportedReason: '当前服务暂不可用。',
  },
  'en-US': {
    unknownProvider: 'Unknown provider',
    currentProviderUnavailable: 'Current provider unavailable',
    currentProviderUnavailableHint: 'Please select another provider type or review the configuration.',
    supportedPrefix: 'Supported: ',
    noCapabilities: 'Capability details are not available yet.',
    apiKeyLabel: 'API Key',
    optionalApiKeyLabel: 'API Key (Optional)',
    noApiKeyRequired: 'This provider does not require an API key.',
    configuredPlaceholder: 'Configured. Enter a new key to replace it',
    emptyPlaceholder: 'Enter API key',
    serviceUrlPlaceholder: 'https://api.example.com/v1',
    missingBaseUrl: 'Service URL not configured',
    previewUnavailable: 'Unable to preview the full request path',
    previewPrefix: 'Preview: ',
    modelListReadonly: 'The current model list is read-only.',
    legacyUnsupportedReason: 'This provider is currently unavailable.',
  },
}

const providerCapabilityLabels: Record<WorkbenchLanguage, {
  streaming: string
  tools: string
  vision: string
  reasoning: string
  search: string
}> = {
  'zh-CN': {
    streaming: '流式',
    tools: '工具',
    vision: '视觉',
    reasoning: '推理',
    search: '联网',
  },
  'en-US': {
    streaming: 'Streaming',
    tools: 'Tools',
    vision: 'Vision',
    reasoning: 'Reasoning',
    search: 'Search',
  },
}

export interface ProviderStatusNotice {
  tone: 'info' | 'warning'
  title: string
  description: string
}

export interface ProviderAuthFieldState {
  visible: boolean
  required: boolean
  label: string
  description?: string
  placeholder: string
}

export interface ProviderBaseUrlFieldState {
  editable: boolean
  description: string
  placeholder: string
}

export function findSettingsWorkspaceActiveProvider(
  providerProfiles: ProviderProfile[],
  activeProviderId: string,
): ProviderProfile | null {
  return providerProfiles.find((profile) => profile.id === activeProviderId) ?? providerProfiles[0] ?? null
}

export function resolveSettingsWorkspaceActiveProviderDetail(
  activeProvider: ProviderProfile | null,
): ProviderProfile {
  return activeProvider ?? createPlaceholderProviderProfile()
}

export function patchProviderProfileById(
  providerProfiles: ProviderProfile[],
  providerId: string,
  patch: Partial<ProviderProfile>,
): ProviderProfile[] {
  return providerProfiles.map((profile) => {
    if (profile.id === providerId) {
      return { ...profile, ...patch }
    }

    return profile
  })
}

export function resolveNextProviderIdAfterDeletion(
  providerProfiles: ProviderProfile[],
  providerId: string,
): string {
  const currentIndex = providerProfiles.findIndex((profile) => profile.id === providerId)

  if (currentIndex === -1) {
    return ''
  }

  return providerProfiles[currentIndex + 1]?.id
    ?? providerProfiles[currentIndex - 1]?.id
    ?? ''
}

export function omitProviderSecretValue(
  providerSecretValues: Record<string, string>,
  providerId: string,
): Record<string, string> {
  const remainingProviderSecretValues = { ...providerSecretValues }
  delete remainingProviderSecretValues[providerId]
  return remainingProviderSecretValues
}

export function resolveProviderCatalogEntry(profile: ProviderProfile | null): ProviderCatalogEntry | null {
  if (profile === null) {
    return null
  }

  return getProviderCatalogEntry(resolveProviderIdentity(profile))
}

export function resolveProviderTypeLabel(profile: ProviderProfile, language = 'zh-CN'): string {
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry !== null) {
    return catalogEntry.displayName
  }

  const providerIdentity = resolveProviderIdentity(profile)
  const copy = providerHelperCopy[normalizeWorkbenchLanguage(language)]
  return providerIdentity === '' ? copy.unknownProvider : providerIdentity
}

export function createProviderTypeSelectOptions(activeProvider: ProviderProfile | null, language = 'zh-CN'): SelectOption[] {
  const copy = providerHelperCopy[normalizeWorkbenchLanguage(language)]
  const options = createProviderSelectOptions().map((option) => ({
    value: option.value,
    label: option.label,
  }))
  const currentProviderIdentity = activeProvider === null ? '' : resolveProviderIdentity(activeProvider)

  if (currentProviderIdentity === '' || options.some((option) => option.value === currentProviderIdentity)) {
    return options
  }

  return [
    {
      value: currentProviderIdentity,
      label: copy.currentProviderUnavailable,
      hint: copy.currentProviderUnavailableHint,
    },
    ...options,
  ]
}

export function buildProviderTypeSelectionPatch(
  profile: ProviderProfile,
  nextProviderTypeId: string,
): Partial<ProviderProfile> {
  const nextCatalogEntry = getProviderCatalogEntry(nextProviderTypeId)
  if (nextCatalogEntry === null) {
    return {
      providerId: nextProviderTypeId,
      protocol: nextProviderTypeId,
    }
  }

  const previousCatalogEntry = resolveProviderCatalogEntry(profile)
  const currentBaseUrl = normalizeProviderBaseUrlValue(profile)
  const nextBaseUrl = currentBaseUrl === '' ? '' : currentBaseUrl
  const nextName = shouldRefreshProviderName(profile, previousCatalogEntry)
    ? nextCatalogEntry.displayName
    : profile.name

  return {
    providerId: nextCatalogEntry.providerId,
    protocol: nextCatalogEntry.providerId,
    baseUrl: nextBaseUrl,
    endpoint: nextBaseUrl,
    name: nextName,
    displayName: nextName,
    compatibility: buildCatalogBackedProviderCompatibility(nextCatalogEntry),
  }
}

export function resolveProviderStatusNotice(profile: ProviderProfile, language = 'zh-CN'): ProviderStatusNotice | null {
  const copy = providerHelperCopy[normalizeWorkbenchLanguage(language)]
  const compatibility = profile.compatibility
  if (compatibility?.status === 'legacy' || compatibility?.status === 'unsupported') {
    return {
      tone: 'warning',
      title: copy.currentProviderUnavailable,
      description: copy.currentProviderUnavailableHint,
    }
  }

  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return {
      tone: 'warning',
      title: copy.currentProviderUnavailable,
      description: copy.currentProviderUnavailableHint,
    }
  }

  if (catalogEntry.runtimeStatus !== 'enabled') {
    return {
      tone: 'info',
      title: copy.currentProviderUnavailable,
      description: copy.currentProviderUnavailableHint,
    }
  }

  return null
}

export function resolveProviderCapabilitySummary(profile: ProviderProfile, language = 'zh-CN'): string {
  const locale = normalizeWorkbenchLanguage(language)
  const copy = providerHelperCopy[locale]
  const capabilityCopy = providerCapabilityLabels[locale]
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return copy.currentProviderUnavailableHint
  }

  const capabilityLabels = [
    catalogEntry.capabilityHints.streaming ? capabilityCopy.streaming : null,
    catalogEntry.capabilityHints.tools ? capabilityCopy.tools : null,
    catalogEntry.capabilityHints.vision ? capabilityCopy.vision : null,
    catalogEntry.capabilityHints.reasoning ? capabilityCopy.reasoning : null,
    catalogEntry.capabilityHints.search ? capabilityCopy.search : null,
  ].filter((value): value is string => value !== null)

  return capabilityLabels.length > 0
    ? `${copy.supportedPrefix}${capabilityLabels.join(locale === 'en-US' ? ', ' : '、')}`
    : copy.noCapabilities
}

export function resolveProviderAuthFieldState(profile: ProviderProfile, language = 'zh-CN'): ProviderAuthFieldState {
  const copy = providerHelperCopy[normalizeWorkbenchLanguage(language)]
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return {
      visible: true,
      required: profile.hasApiKey,
      label: copy.apiKeyLabel,
      placeholder: profile.hasApiKey ? copy.configuredPlaceholder : copy.emptyPlaceholder,
    }
  }

  const supportsApiKey = catalogEntry.authSchema.supportedKinds.includes('api-key')
  const required = catalogEntry.authSchema.defaultKind === 'api-key'

  if (!supportsApiKey) {
    return {
      visible: false,
      required: false,
      label: copy.apiKeyLabel,
      description: catalogEntry.authSchema.helpText ?? copy.noApiKeyRequired,
      placeholder: '',
    }
  }

  return {
    visible: true,
    required,
    label: required ? copy.apiKeyLabel : copy.optionalApiKeyLabel,
    placeholder: profile.hasApiKey ? copy.configuredPlaceholder : copy.emptyPlaceholder,
  }
}

export function resolveProviderBaseUrlFieldState(
  profile: ProviderProfile,
  options: {
    previewModelId?: string | null
    language?: string
  } = {},
): ProviderBaseUrlFieldState {
  const copy = providerHelperCopy[normalizeWorkbenchLanguage(options.language)]
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return {
      editable: true,
      description: buildProviderBaseUrlPreviewDescription(profile, options.previewModelId, options.language),
      placeholder: profile.baseUrl?.trim() || profile.endpoint || copy.serviceUrlPlaceholder,
    }
  }

  const defaultBaseUrl = catalogEntry.baseUrlPolicy.defaultBaseUrl ?? ''
  const editable = catalogEntry.baseUrlPolicy.mode !== 'fixed'

  return {
    editable,
    description: buildProviderBaseUrlPreviewDescription(profile, options.previewModelId, options.language),
    placeholder: defaultBaseUrl || copy.serviceUrlPlaceholder,
  }
}

export function resolveProviderBaseUrlValidationMessage(profile: ProviderProfile, language = 'zh-CN'): string | null {
  const copy = providerHelperCopy[normalizeWorkbenchLanguage(language)]
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry?.baseUrlPolicy.mode === 'fixed') {
    return null
  }

  return normalizeProviderBaseUrlValue(profile) === '' ? copy.missingBaseUrl : null
}

export function resolveProviderBaseUrlPreviewText(
  profile: ProviderProfile,
  previewModelId?: string | null,
  language = 'zh-CN',
): string {
  const copy = providerHelperCopy[normalizeWorkbenchLanguage(language)]
  const normalizedBaseUrl = normalizeProviderBaseUrlValue(profile)
  if (normalizedBaseUrl === '') {
    return copy.missingBaseUrl
  }

  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return copy.previewUnavailable
  }

  const previewSuffix = resolveProviderPreviewSuffix(catalogEntry.endpointType, profile, previewModelId)
  if (previewSuffix === null) {
    return copy.previewUnavailable
  }

  return joinBaseUrlAndSuffix(normalizedBaseUrl, previewSuffix)
}

export function resolveProviderModelEditingAvailability(profile: ProviderProfile, language = 'zh-CN'): {
  canEditModels: boolean
  description?: string
} {
  const copy = providerHelperCopy[normalizeWorkbenchLanguage(language)]
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return {
      canEditModels: true,
    }
  }

  if (catalogEntry.modelConfigPolicy.mode === 'read-only' || !catalogEntry.modelConfigPolicy.allowCustomModels) {
    return {
      canEditModels: false,
      description: copy.modelListReadonly,
    }
  }

  return {
    canEditModels: true,
  }
}

function resolveProviderIdentity(profile: ProviderProfile): string {
  return (profile.providerId ?? profile.protocol).trim().toLowerCase()
}

function buildProviderBaseUrlPreviewDescription(
  profile: ProviderProfile,
  previewModelId?: string | null,
  language = 'zh-CN',
): string {
  const copy = providerHelperCopy[normalizeWorkbenchLanguage(language)]
  return `${copy.previewPrefix}${resolveProviderBaseUrlPreviewText(profile, previewModelId, language)}`
}

function resolveProviderPreviewSuffix(
  endpointType: string,
  profile: ProviderProfile,
  previewModelId?: string | null,
): string | null {
  switch (endpointType.trim().toLowerCase()) {
    case 'openai-compatible':
      return '/chat/completions'
    case 'anthropic-native':
      return '/v1/messages'
    case 'gemini-native':
      return `/models/${resolveProviderPreviewModelId(profile, previewModelId)}:generateContent`
    case 'xai-native':
      return '/v1/chat/completions'
    case 'ollama-native':
      return '/chat/completions'
    default:
      return null
  }
}

function resolveProviderPreviewModelId(
  profile: ProviderProfile,
  previewModelId?: string | null,
): string {
  const normalizedPreviewModelId = previewModelId?.trim() ?? ''
  if (normalizedPreviewModelId !== '') {
    return normalizedPreviewModelId
  }

  const fallbackModelId = profile.availableModels[0]?.modelId?.trim() ?? ''
  return fallbackModelId === '' ? '<model-id>' : fallbackModelId
}

function normalizeProviderBaseUrlValue(profile: ProviderProfile): string {
  return profile.baseUrl?.trim() || profile.endpoint.trim()
}

function joinBaseUrlAndSuffix(baseUrl: string, suffix: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  const normalizedSuffix = suffix.trim().replace(/^\/+/, '')

  if (normalizedBaseUrl === '') {
    return normalizedSuffix === '' ? '' : `/${normalizedSuffix}`
  }

  if (normalizedSuffix === '') {
    return normalizedBaseUrl
  }

  return `${normalizedBaseUrl}/${normalizedSuffix}`
}


function shouldRefreshProviderName(
  profile: ProviderProfile,
  previousCatalogEntry: ProviderCatalogEntry | null,
): boolean {
  const normalizedName = profile.name.trim()
  if (normalizedName === '') {
    return true
  }

  if (previousCatalogEntry !== null && normalizedName === previousCatalogEntry.displayName) {
    return true
  }

  return /^custom provider(?:\s+\d+)?$/i.test(normalizedName)
}

function buildCatalogBackedProviderCompatibility(
  catalogEntry: ProviderCatalogEntry,
): NonNullable<ProviderProfile['compatibility']> {
  if (catalogEntry.runtimeStatus === 'legacy-unsupported') {
    return {
      status: 'legacy',
      reason: providerHelperCopy['zh-CN'].legacyUnsupportedReason,
    }
  }

  return {
    status: 'active',
    reason: '',
  }
}
