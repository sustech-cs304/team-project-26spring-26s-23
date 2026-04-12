import {
  createProviderSelectOptions,
  getProviderCatalogEntry,
  type ProviderCatalogEntry,
} from '../../provider-catalog'
import type { ProviderProfile, SelectOption } from '../types'
import { createPlaceholderProviderProfile } from './provider-profiles'

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

export function resolveProviderTypeLabel(profile: ProviderProfile): string {
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry !== null) {
    return catalogEntry.displayName
  }

  const providerIdentity = resolveProviderIdentity(profile)
  return providerIdentity === '' ? '未知服务' : providerIdentity
}

export function createProviderTypeSelectOptions(activeProvider: ProviderProfile | null): SelectOption[] {
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
      label: '当前服务不可用',
      hint: '请重新选择服务类型。',
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

export function resolveProviderStatusNotice(profile: ProviderProfile): ProviderStatusNotice | null {
  const compatibility = profile.compatibility
  if (compatibility?.status === 'legacy' || compatibility?.status === 'unsupported') {
    return {
      tone: 'warning',
      title: '当前服务不可用',
      description: '请重新选择服务类型或检查配置。',
    }
  }

  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return {
      tone: 'warning',
      title: '当前服务不可用',
      description: '请重新选择服务类型或检查配置。',
    }
  }

  if (catalogEntry.runtimeStatus !== 'enabled') {
    return {
      tone: 'info',
      title: '当前服务不可用',
      description: '请重新选择服务类型或检查配置。',
    }
  }

  return null
}

export function resolveProviderCapabilitySummary(profile: ProviderProfile): string {
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return '请完成服务配置后再使用。'
  }

  const capabilityLabels = [
    catalogEntry.capabilityHints.streaming ? '流式' : null,
    catalogEntry.capabilityHints.tools ? '工具' : null,
    catalogEntry.capabilityHints.vision ? '视觉' : null,
    catalogEntry.capabilityHints.reasoning ? '推理' : null,
    catalogEntry.capabilityHints.search ? '联网' : null,
  ].filter((value): value is string => value !== null)

  return capabilityLabels.length > 0
    ? `支持：${capabilityLabels.join('、')}`
    : '可用功能信息暂未提供。'
}

export function resolveProviderAuthFieldState(profile: ProviderProfile): ProviderAuthFieldState {
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return {
      visible: true,
      required: profile.hasApiKey,
      label: 'API 密钥',
      placeholder: profile.hasApiKey ? '已配置，输入新密钥以替换' : '输入访问密钥',
    }
  }

  const supportsApiKey = catalogEntry.authSchema.supportedKinds.includes('api-key')
  const required = catalogEntry.authSchema.defaultKind === 'api-key'

  if (!supportsApiKey) {
    return {
      visible: false,
      required: false,
      label: 'API 密钥',
      description: catalogEntry.authSchema.helpText ?? '当前服务无需填写 API 密钥。',
      placeholder: '',
    }
  }

  return {
    visible: true,
    required,
    label: required ? 'API 密钥' : 'API 密钥（可选）',
    placeholder: required
      ? (profile.hasApiKey ? '已配置，输入新密钥以替换' : '输入访问密钥')
      : (profile.hasApiKey ? '已配置，可输入新密钥以替换' : '可按需填写'),
  }
}

export function resolveProviderBaseUrlFieldState(
  profile: ProviderProfile,
  options: {
    previewModelId?: string | null
  } = {},
): ProviderBaseUrlFieldState {
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return {
      editable: true,
      description: buildProviderBaseUrlPreviewDescription(profile, options.previewModelId),
      placeholder: profile.baseUrl?.trim() || profile.endpoint || 'https://api.example.com/v1',
    }
  }

  const defaultBaseUrl = catalogEntry.baseUrlPolicy.defaultBaseUrl ?? ''
  const editable = catalogEntry.baseUrlPolicy.mode !== 'fixed'

  return {
    editable,
    description: buildProviderBaseUrlPreviewDescription(profile, options.previewModelId),
    placeholder: defaultBaseUrl || 'https://api.example.com/v1',
  }
}

export function resolveProviderBaseUrlValidationMessage(profile: ProviderProfile): string | null {
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry?.baseUrlPolicy.mode === 'fixed') {
    return null
  }

  return normalizeProviderBaseUrlValue(profile) === '' ? '未填写服务地址' : null
}

export function resolveProviderBaseUrlPreviewText(
  profile: ProviderProfile,
  previewModelId?: string | null,
): string {
  const normalizedBaseUrl = normalizeProviderBaseUrlValue(profile)
  if (normalizedBaseUrl === '') {
    return '未填写服务地址'
  }

  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return '无法预览完整请求路径'
  }

  const previewSuffix = resolveProviderPreviewSuffix(catalogEntry.endpointType, profile, previewModelId)
  if (previewSuffix === null) {
    return '无法预览完整请求路径'
  }

  return joinBaseUrlAndSuffix(normalizedBaseUrl, previewSuffix)
}

export function resolveProviderModelEditingAvailability(profile: ProviderProfile): {
  canEditModels: boolean
  description?: string
} {
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return {
      canEditModels: true,
    }
  }

  if (catalogEntry.modelConfigPolicy.mode === 'read-only' || !catalogEntry.modelConfigPolicy.allowCustomModels) {
    return {
      canEditModels: false,
      description: '当前模型列表暂不可编辑。',
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
): string {
  return `链接预览：${resolveProviderBaseUrlPreviewText(profile, previewModelId)}`
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
      reason: '当前服务暂不可用。',
    }
  }

  return {
    status: 'active',
    reason: '',
  }
}
