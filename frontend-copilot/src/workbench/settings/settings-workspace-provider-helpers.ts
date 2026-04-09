import {
  createProviderSelectOptions,
  describeProviderRuntimeStatus,
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
  description: string
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
  return providerIdentity === '' ? '未知 Provider' : providerIdentity
}

export function createProviderTypeSelectOptions(activeProvider: ProviderProfile | null): SelectOption[] {
  const options = createProviderSelectOptions()
  const currentProviderIdentity = activeProvider === null ? '' : resolveProviderIdentity(activeProvider)

  if (currentProviderIdentity === '' || options.some((option) => option.value === currentProviderIdentity)) {
    return options
  }

  return [
    {
      value: currentProviderIdentity,
      label: `历史配置 · ${currentProviderIdentity}`,
      hint: '当前 provider 不在 catalog 中，仅保留查看与迁移。',
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
  const currentBaseUrl = (profile.baseUrl?.trim() || profile.endpoint.trim())
  const previousDefaultBaseUrl = previousCatalogEntry?.baseUrlPolicy.defaultBaseUrl?.trim() ?? ''
  const nextDefaultBaseUrl = nextCatalogEntry.baseUrlPolicy.defaultBaseUrl?.trim() ?? ''
  const shouldResetBaseUrl = currentBaseUrl === '' || currentBaseUrl === previousDefaultBaseUrl
  const nextName = shouldRefreshProviderName(profile, previousCatalogEntry)
    ? nextCatalogEntry.displayName
    : profile.name

  return {
    providerId: nextCatalogEntry.providerId,
    protocol: nextCatalogEntry.providerId,
    baseUrl: shouldResetBaseUrl ? nextDefaultBaseUrl : currentBaseUrl,
    endpoint: shouldResetBaseUrl ? nextDefaultBaseUrl : currentBaseUrl,
    name: nextName,
    displayName: nextName,
    compatibility: buildCatalogBackedProviderCompatibility(nextCatalogEntry),
  }
}

export function resolveProviderStatusNotice(profile: ProviderProfile): ProviderStatusNotice | null {
  const compatibility = profile.compatibility
  if (compatibility?.status === 'legacy') {
    return {
      tone: 'warning',
      title: '历史兼容配置',
      description: compatibility.reason.trim() || '当前 provider 已进入历史兼容状态，仅保留查看与迁移。',
    }
  }

  if (compatibility?.status === 'unsupported') {
    return {
      tone: 'warning',
      title: '不受支持的配置',
      description: compatibility.reason.trim() || '当前 provider 不在 catalog 中，设置页仅保留原始配置。',
    }
  }

  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return {
      tone: 'warning',
      title: '不受支持的 Provider',
      description: `Provider '${resolveProviderIdentity(profile) || profile.id}' 不在当前 catalog 中，设置页会保留原始字段但不会把它视为已支持的新链路配置。`,
    }
  }

  if (catalogEntry.runtimeStatus === 'catalog-only') {
    return {
      tone: 'info',
      title: '仅数据层兼容',
      description: '当前 provider 已进入统一 catalog，并可在设置页保存，但聊天主链与运行时尚未启用。',
    }
  }

  if (catalogEntry.runtimeStatus === 'legacy-unsupported') {
    return {
      tone: 'warning',
      title: '历史兼容 / 当前未启用',
      description: '当前 provider 在 catalog 中被标记为 legacy-unsupported，仅保留查看与迁移。',
    }
  }

  return null
}

export function resolveProviderCapabilitySummary(profile: ProviderProfile): string {
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return '当前 provider 不在 catalog 中，无法提供可信的能力提示。'
  }

  const capabilityLabels = [
    catalogEntry.capabilityHints.streaming ? '流式' : null,
    catalogEntry.capabilityHints.tools ? '工具' : null,
    catalogEntry.capabilityHints.vision ? '视觉' : null,
    catalogEntry.capabilityHints.reasoning ? '推理' : null,
    catalogEntry.capabilityHints.search ? '联网' : null,
  ].filter((value): value is string => value !== null)

  const runtimeStatusLabel = describeProviderRuntimeStatus(catalogEntry.runtimeStatus)
  const summaryParts = [
    `Provider: ${catalogEntry.displayName}`,
    `Endpoint: ${catalogEntry.endpointType}`,
    capabilityLabels.length > 0 ? `基础能力提示：${capabilityLabels.join('、')}` : 'catalog 未提供能力提示',
    runtimeStatusLabel === null ? null : `状态：${runtimeStatusLabel}`,
  ].filter((value): value is string => value !== null)

  return summaryParts.join(' · ')
}

export function resolveProviderAuthFieldState(profile: ProviderProfile): ProviderAuthFieldState {
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return {
      visible: true,
      required: profile.hasApiKey,
      label: 'API 密钥',
      description: '当前 provider 不在 catalog 中，设置页保留原始 API Key 字段以便迁移。',
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
      description: catalogEntry.authSchema.helpText ?? '当前 provider 不需要 API Key。',
      placeholder: '',
    }
  }

  return {
    visible: true,
    required,
    label: required ? 'API 密钥' : 'API 密钥（可选）',
    description: catalogEntry.authSchema.helpText
      ?? (required ? '当前 provider 需要 API Key。' : '当前 provider 默认无需 API Key，可按需填写。'),
    placeholder: required
      ? (profile.hasApiKey ? '已配置，输入新密钥以替换' : '输入访问密钥')
      : (profile.hasApiKey ? '已配置，可输入新密钥以替换' : '当前无需填写，可按需配置'),
  }
}

export function resolveProviderBaseUrlFieldState(profile: ProviderProfile): ProviderBaseUrlFieldState {
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return {
      editable: true,
      description: '当前 provider 不在 catalog 中，保留原始 Base URL 输入。',
      placeholder: profile.baseUrl?.trim() || profile.endpoint,
    }
  }

  const defaultBaseUrl = catalogEntry.baseUrlPolicy.defaultBaseUrl ?? ''

  switch (catalogEntry.baseUrlPolicy.mode) {
    case 'required':
      return {
        editable: true,
        description: '该 provider 需要显式填写 Base URL。',
        placeholder: defaultBaseUrl || 'https://api.example.com/v1',
      }
    case 'fixed':
      return {
        editable: false,
        description: '该 provider 的 Base URL 由 catalog 固定，不在设置页中编辑。',
        placeholder: defaultBaseUrl,
      }
    case 'optional':
    default:
      return {
        editable: true,
        description: defaultBaseUrl
          ? `可留空以使用 catalog 默认地址：${defaultBaseUrl}`
          : '可按需填写自定义 Base URL。',
        placeholder: defaultBaseUrl || 'https://api.example.com/v1',
      }
  }
}

export function resolveProviderModelEditingAvailability(profile: ProviderProfile): {
  canEditModels: boolean
  description: string
} {
  const catalogEntry = resolveProviderCatalogEntry(profile)
  if (catalogEntry === null) {
    return {
      canEditModels: true,
      description: '当前 provider 不在 catalog 中，模型列表按兼容模式继续允许编辑。',
    }
  }

  if (catalogEntry.modelConfigPolicy.mode === 'read-only' || !catalogEntry.modelConfigPolicy.allowCustomModels) {
    return {
      canEditModels: false,
      description: '该 provider 的模型列表当前为只读。',
    }
  }

  return {
    canEditModels: true,
    description: catalogEntry.modelConfigPolicy.defaultModelRequired
      ? '模型列表由当前 profile 维护，并要求选择默认模型。'
      : '模型列表由当前 profile 维护。',
  }
}

function resolveProviderIdentity(profile: ProviderProfile): string {
  return (profile.providerId ?? profile.protocol).trim().toLowerCase()
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
      reason: `Provider '${catalogEntry.providerId}' is marked as legacy / unsupported in the provider catalog.`,
    }
  }

  return {
    status: 'active',
    reason: '',
  }
}
