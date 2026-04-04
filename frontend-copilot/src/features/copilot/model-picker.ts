import type { RuntimeModelRoute } from './thread-run-contract'
import type { ModelCapability, ProviderProfile } from '../../workbench/types'

export interface CopilotModelIconSpec {
  label: string
  accent: string
}

export interface CopilotModelOption {
  id: string
  modelId: string
  name: string
  provider: string
  group: string
  tags: string[]
  icon: CopilotModelIconSpec
  route: RuntimeModelRoute
}

export interface CopilotModelGroup {
  key: string
  title: string
  models: CopilotModelOption[]
}

export interface CopilotModelCatalog {
  groups: CopilotModelGroup[]
  models: CopilotModelOption[]
}

export const STREAMING_CHAT_SUPPORTED_ENDPOINT_TYPES = ['openai-compatible'] as const

const STREAMING_CHAT_SUPPORTED_ENDPOINT_TYPE_SET = new Set<string>(STREAMING_CHAT_SUPPORTED_ENDPOINT_TYPES)

export function isStreamingChatEndpointTypeSupported(endpointType: string): boolean {
  return STREAMING_CHAT_SUPPORTED_ENDPOINT_TYPE_SET.has(normalizeEndpointType(endpointType))
}

export function isRuntimeModelRouteSupportedForStreamingChat(route: RuntimeModelRoute | null): boolean {
  return route !== null && isStreamingChatEndpointTypeSupported(route.snapshot.endpointType)
}

export function getRuntimeModelRouteStreamingSupportReason(route: RuntimeModelRoute | null): string | null {
  if (route === null) {
    return null
  }

  const endpointType = normalizeEndpointType(route.snapshot.endpointType)
  if (endpointType === '' || isStreamingChatEndpointTypeSupported(endpointType)) {
    return null
  }

  return `当前流式聊天暂不支持“${endpointType}”端点类型，请切换到 openai-compatible 模型路由。`
}

export function getCopilotModelById(
  modelId: string,
  models: CopilotModelOption[] = [],
): CopilotModelOption | null {
  return models.find((model) => model.id === modelId) ?? null
}

export function resolveCopilotModelOption(input: {
  models?: CopilotModelOption[]
  resolvedModelId?: string | null
  resolvedModelRoute?: RuntimeModelRoute | null
}): CopilotModelOption | null {
  const models = input.models ?? []
  const normalizedResolvedModelId = normalizeModelId(input.resolvedModelId ?? '')
  const normalizedResolvedRouteModelId = normalizeModelId(input.resolvedModelRoute?.snapshot.modelId ?? '')

  const exactIdMatch = normalizedResolvedModelId === ''
    ? null
    : getCopilotModelById(normalizedResolvedModelId, models)
  if (exactIdMatch !== null) {
    return exactIdMatch
  }

  const exactRouteMatch = findCopilotModelByRoute(input.resolvedModelRoute ?? null, models)
  if (exactRouteMatch !== null) {
    return exactRouteMatch
  }

  for (const candidate of [normalizedResolvedModelId, normalizedResolvedRouteModelId]) {
    if (candidate === '') {
      continue
    }

    const modelIdMatch = models.find((model) => model.modelId === candidate || model.id === candidate)
    if (modelIdMatch !== undefined) {
      return modelIdMatch
    }
  }

  const fallbackModelId = normalizedResolvedModelId || normalizedResolvedRouteModelId
  return fallbackModelId === '' ? null : createFallbackCopilotModel(fallbackModelId)
}

export function createEmptyCopilotModel(): CopilotModelOption {
  return {
    id: '',
    modelId: '',
    name: '尚未配置模型',
    provider: '',
    group: '',
    tags: [],
    icon: {
      label: '?',
      accent: '#94a3b8',
    },
    route: {
      providerProfileId: '',
      snapshot: {
        provider: '',
        endpointType: '',
        baseUrl: '',
        modelId: '',
      },
    },
  }
}

export function createFallbackCopilotModel(modelId: string): CopilotModelOption {
  const trimmedModelId = modelId.trim()

  if (trimmedModelId === '') {
    return createEmptyCopilotModel()
  }

  return {
    id: trimmedModelId,
    modelId: trimmedModelId,
    name: trimmedModelId,
    provider: 'Custom',
    group: 'Custom',
    tags: [],
    icon: {
      label: trimmedModelId.slice(0, 1).toUpperCase(),
      accent: '#94a3b8',
    },
    route: {
      providerProfileId: '',
      snapshot: {
        provider: '',
        endpointType: '',
        baseUrl: '',
        modelId: trimmedModelId,
      },
    },
  }
}

export function createCopilotModelCatalog(providerProfiles: ProviderProfile[]): CopilotModelCatalog {
  const groups = providerProfiles.map((profile) => ({
    key: profile.id,
    title: resolveProviderTitle(profile.name, profile.id),
    models: profile.availableModels.map((model) => createCopilotModelOption(profile, {
      id: model.id,
      modelId: model.modelId,
      displayName: model.displayName,
      capabilities: model.capabilities,
    })),
  }))

  return {
    groups,
    models: groups.flatMap((group) => group.models),
  }
}

export function createCopilotModelCatalogFromOptions(models: CopilotModelOption[]): CopilotModelCatalog {
  const groups = groupCopilotModels(models)

  return {
    groups,
    models,
  }
}

export function resolveCopilotPreferredModelId(input: {
  preferredModelId: string
  models: CopilotModelOption[]
}): string {
  const normalizedPreferredModelId = input.preferredModelId.trim()
  if (normalizedPreferredModelId !== '') {
    const exactMatch = input.models.find((model) => model.id === normalizedPreferredModelId)
    if (exactMatch !== undefined) {
      return exactMatch.id
    }

    const routeMatch = input.models.find((model) => model.modelId === normalizedPreferredModelId)
    if (routeMatch !== undefined) {
      return routeMatch.id
    }
  }

  return input.models[0]?.id ?? ''
}

export function getCopilotModelTags(models: CopilotModelOption[] = []): string[] {
  const seen = new Set<string>()

  for (const model of models) {
    for (const tag of model.tags) {
      seen.add(tag)
    }
  }

  return [...seen]
}

export function filterCopilotModels(input: {
  models?: CopilotModelOption[]
  query: string
  tags: string[]
}): CopilotModelOption[] {
  const models = input.models ?? []
  const normalizedQuery = input.query.trim().toLowerCase()

  return models.filter((model) => {
    const matchesTag = input.tags.length === 0 || input.tags.every((tag) => model.tags.includes(tag))
    if (!matchesTag) {
      return false
    }

    if (normalizedQuery === '') {
      return true
    }

    const searchableText = [
      model.id,
      model.modelId,
      model.name,
      model.provider,
      model.group,
      ...model.tags,
    ].join(' ').toLowerCase()

    return searchableText.includes(normalizedQuery)
  })
}

export function filterCopilotModelGroups(input: {
  groups: CopilotModelGroup[]
  query: string
  tags: string[]
}): CopilotModelGroup[] {
  return input.groups.map((group) => ({
    ...group,
    models: filterCopilotModels({
      models: group.models,
      query: input.query,
      tags: input.tags,
    }),
  }))
}

export function groupCopilotModels(models: CopilotModelOption[]): CopilotModelGroup[] {
  const groups = new Map<string, CopilotModelOption[]>()

  for (const model of models) {
    const currentGroup = groups.get(model.group) ?? []
    currentGroup.push(model)
    groups.set(model.group, currentGroup)
  }

  return [...groups.entries()].map(([key, groupedModels]) => ({
    key,
    title: key,
    models: groupedModels,
  }))
}

function findCopilotModelByRoute(
  route: RuntimeModelRoute | null,
  models: CopilotModelOption[],
): CopilotModelOption | null {
  if (route === null) {
    return null
  }

  const providerProfileId = route.providerProfileId.trim()
  const routeModelId = normalizeModelId(route.snapshot.modelId)
  if (providerProfileId === '' || routeModelId === '') {
    return null
  }

  return models.find((model) => (
    model.route.providerProfileId === providerProfileId
    && model.route.snapshot.modelId === routeModelId
  )) ?? null
}

function createCopilotModelOption(
  profile: ProviderProfile,
  model: {
    id: string
    modelId: string
    displayName: string
    capabilities: ModelCapability[]
  },
): CopilotModelOption {
  const providerTitle = resolveProviderTitle(profile.name, profile.id)
  const trimmedModelId = normalizeModelId(model.modelId)
  const trimmedDisplayName = model.displayName.trim()
  const modelName = trimmedDisplayName === ''
    ? (trimmedModelId === '' ? '未命名模型' : trimmedModelId)
    : trimmedDisplayName

  return {
    id: model.id.trim() || `${profile.id}:${trimmedModelId}`,
    modelId: trimmedModelId,
    name: modelName,
    provider: providerTitle,
    group: providerTitle,
    tags: mapCapabilitiesToTags(model.capabilities),
    icon: createProviderIconSpec(profile.id, providerTitle, modelName),
    route: createRuntimeModelRoute(profile, trimmedModelId),
  }
}

function createRuntimeModelRoute(profile: ProviderProfile, modelId: string): RuntimeModelRoute {
  const provider = normalizeProviderIdentifier(profile.protocol)

  return {
    providerProfileId: profile.id,
    snapshot: {
      provider,
      endpointType: provider === 'openai' ? 'openai-compatible' : provider,
      baseUrl: normalizeBaseUrl(profile.endpoint),
      modelId,
    },
  }
}

function mapCapabilitiesToTags(capabilities: ModelCapability[]): string[] {
  const tags = capabilities.flatMap((capability) => {
    switch (capability) {
      case 'vision':
        return ['视觉']
      case 'search':
        return ['联网']
      case 'reasoning':
        return ['推理']
      case 'tools':
        return ['工具']
      default:
        return []
    }
  })

  return Array.from(new Set(tags))
}

function createProviderIconSpec(providerId: string, providerTitle: string, modelName: string): CopilotModelIconSpec {
  const palette = ['#60a5fa', '#a78bfa', '#34d399', '#fb923c', '#f472b6', '#facc15', '#38bdf8', '#c084fc']
  const hashSource = `${providerId}:${providerTitle}`
  let hash = 0

  for (const char of hashSource) {
    hash = (hash * 31) + char.charCodeAt(0)
  }

  const iconLabelSource = modelName.trim() || providerTitle.trim() || providerId.trim()

  return {
    label: iconLabelSource.slice(0, 1).toUpperCase() || '?',
    accent: palette[Math.abs(hash) % palette.length] ?? '#94a3b8',
  }
}

function resolveProviderTitle(name: string, fallbackId: string): string {
  return name.trim() || fallbackId.trim() || '未命名服务商'
}

function normalizeProviderIdentifier(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeEndpointType(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function normalizeModelId(value: string): string {
  return value.trim()
}
