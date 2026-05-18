import type {
  RuntimeModelRoute,
  RuntimeResolvedModelRoute,
} from './thread-run-contract'
import {
  getProviderCatalogEntry,
  getProviderCatalogRevision,
} from '../../provider-catalog'
import type {
  ModelCapability,
  ModelRouteRef,
  ProviderProfile,
} from '../../workbench/types'
import { serializeThinkingCapabilityOverrideInput } from '../../workbench/thinking-capabilities'
import {
  parseSerializedModelRouteRef,
  serializeModelRouteRef,
} from '../../workbench/settings/settings-workspace-model-options'
import type {
  CopilotModelCatalog,
  CopilotModelGroup,
  CopilotModelIconSpec,
  CopilotModelOption,
} from './_model-picker/types'

export type {
  CopilotModelCatalog,
  CopilotModelGroup,
  CopilotModelIconSpec,
  CopilotModelOption,
} from './_model-picker/types'

export function isRuntimeModelRouteSupportedForStreamingChat(route: RuntimeModelRoute | null): boolean {
  return getRuntimeModelRouteStreamingSupportReason(route) === null
}

export function getRuntimeModelRouteStreamingSupportReason(route: RuntimeModelRoute | null): string | null {
  if (route === null) {
    return null
  }

  return route.routeRef === undefined || route.routeRef === null
    ? '当前模型不可用，请重新选择。'
    : null
}

export function getCopilotModelById(
  modelId: string,
  models: CopilotModelOption[] = [],
): CopilotModelOption | null {
  const normalizedModelId = modelId.trim()
  if (normalizedModelId === '') {
    return null
  }

  return models.find((model) => (
    model.selectionValue === normalizedModelId || model.id === normalizedModelId
  )) ?? null
}

export function resolveCopilotModelOption(input: {
  models?: CopilotModelOption[]
  resolvedModelId?: string | null
  resolvedModelRoute?: RuntimeResolvedModelRoute | RuntimeModelRoute | null
}): CopilotModelOption | null {
  const models = input.models ?? []
  const normalizedResolvedModelId = normalizeModelId(input.resolvedModelId ?? '')
  const normalizedResolvedRouteModelId = normalizeModelId(resolveRuntimeRouteModelId(input.resolvedModelRoute) ?? '')

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

  const fallbackModelId = normalizedResolvedRouteModelId || normalizedResolvedModelId
  return fallbackModelId === '' ? null : createFallbackCopilotModel(fallbackModelId)
}

export function createEmptyCopilotModel(): CopilotModelOption {
  return {
    id: '',
    selectionValue: '',
    modelId: '',
    name: '尚未配置模型',
    provider: '',
    group: '',
    tags: [],
    icon: {
      label: '?',
      accent: '#94a3b8',
    },
    routeRef: null,
    route: {},
    available: false,
    unavailableReason: null,
    thinkingCapabilityOverride: null,
  }
}

export function createFallbackCopilotModel(modelId: string): CopilotModelOption {
  const trimmedModelId = modelId.trim()

  if (trimmedModelId === '') {
    return createEmptyCopilotModel()
  }

  const parsedRouteRef = parseSerializedModelRouteRef(trimmedModelId)
  const fallbackModelId = parsedRouteRef?.modelId ?? trimmedModelId
  const fallbackProvider = '当前选择不可用'

  return {
    id: trimmedModelId,
    selectionValue: trimmedModelId,
    modelId: fallbackModelId,
    name: fallbackModelId,
    provider: fallbackProvider,
    group: fallbackProvider,
    tags: [],
    icon: {
      label: fallbackModelId.slice(0, 1).toUpperCase(),
      accent: '#94a3b8',
    },
    routeRef: parsedRouteRef,
    route: parsedRouteRef === null
      ? {}
      : {
          routeRef: cloneModelRouteRef(parsedRouteRef),
        },
    available: false,
    unavailableReason: '当前选择已失效，请重新选择。',
    thinkingCapabilityOverride: null,
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
      thinkingCapability: model.thinkingCapability,
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
  preferredModelRouteRef?: ModelRouteRef | null
  models: CopilotModelOption[]
}): string {
  const preferredModelRouteRef = input.preferredModelRouteRef ?? null
  if (preferredModelRouteRef !== null) {
    const exactRouteMatch = input.models.find((model) => isSameModelRouteRef(model.routeRef, preferredModelRouteRef))
    return exactRouteMatch?.selectionValue ?? ''
  }

  const normalizedPreferredModelId = input.preferredModelId.trim()
  if (normalizedPreferredModelId !== '') {
    const exactMatch = getCopilotModelById(normalizedPreferredModelId, input.models)
    return exactMatch?.selectionValue ?? ''
  }

  return input.models.find((model) => model.available)?.selectionValue ?? input.models[0]?.selectionValue ?? ''
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
      model.selectionValue,
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
  route: RuntimeResolvedModelRoute | RuntimeModelRoute | null,
  models: CopilotModelOption[],
): CopilotModelOption | null {
  if (route === null) {
    return null
  }

  const routeRef = resolveRuntimeModelRouteRef(route)
  return routeRef === null
    ? null
    : models.find((model) => isSameModelRouteRef(model.routeRef, routeRef)) ?? null
}

function createCopilotModelOption(
  profile: ProviderProfile,
  model: {
    id: string
    modelId: string
    displayName: string
    capabilities: ModelCapability[]
    thinkingCapability?: ProviderProfile['availableModels'][number]['thinkingCapability']
  },
): CopilotModelOption {
  const providerTitle = resolveProviderTitle(profile.name, profile.id)
  const trimmedModelId = normalizeModelId(model.modelId)
  const trimmedDisplayName = model.displayName.trim()
  const modelName = trimmedDisplayName === ''
    ? (trimmedModelId === '' ? '未命名模型' : trimmedModelId)
    : trimmedDisplayName
  const routeRef = buildModelRouteRef(profile.id, trimmedModelId)
  const availability = resolveCopilotModelAvailability(profile)

  return {
    id: model.id.trim() || `${profile.id}:${trimmedModelId}`,
    selectionValue: serializeModelRouteRef(routeRef),
    modelId: trimmedModelId,
    name: modelName,
    provider: providerTitle,
    group: providerTitle,
    tags: mapCapabilitiesToTags(model.capabilities),
    icon: createProviderIconSpec(profile.id, providerTitle, modelName),
    routeRef,
    route: createRuntimeModelRoute(profile, routeRef),
    available: availability.available,
    unavailableReason: availability.reason,
    thinkingCapabilityOverride: serializeThinkingCapabilityOverrideInput(model.thinkingCapability),
  }
}

function createRuntimeModelRoute(_profile: ProviderProfile, routeRef: ModelRouteRef): RuntimeModelRoute {
  return {
    routeRef: cloneModelRouteRef(routeRef),
    catalogRevision: getProviderCatalogRevision(),
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

function normalizeModelId(value: string): string {
  return value.trim()
}

function resolveProviderIdentifier(profile: ProviderProfile): string {
  return normalizeProviderIdentifier(profile.providerId ?? profile.protocol)
}

function resolveRuntimeModelRouteRef(route: RuntimeResolvedModelRoute | RuntimeModelRoute): ModelRouteRef | null {
  const routeRef = route.routeRef
  if (routeRef === undefined || routeRef === null) {
    return null
  }

  return {
    routeKind: routeRef.routeKind,
    profileId: routeRef.profileId,
    modelId: routeRef.modelId,
  }
}

function resolveRuntimeRouteModelId(
  route: RuntimeResolvedModelRoute | RuntimeModelRoute | null | undefined,
): string | null {
  if (route === null || route === undefined) {
    return null
  }

  return 'modelId' in route ? route.modelId : route.routeRef?.modelId ?? null
}

function resolveCopilotModelAvailability(profile: ProviderProfile): {
  available: boolean
  reason: string | null
} {
  const compatibility = profile.compatibility
  if (compatibility?.status === 'legacy' || compatibility?.status === 'unsupported') {
    return {
      available: false,
      reason: '当前模型暂不可用于聊天。',
    }
  }

  const providerIdentity = resolveProviderIdentifier(profile)
  const providerCatalogEntry = getProviderCatalogEntry(providerIdentity)
  if (providerCatalogEntry === null) {
    return {
      available: false,
      reason: '当前模型暂不可用于聊天。',
    }
  }

  if (providerCatalogEntry.runtimeStatus !== 'enabled') {
    return {
      available: false,
      reason: '当前模型暂不可用于聊天。',
    }
  }

  return {
    available: true,
    reason: null,
  }
}

function buildModelRouteRef(profileId: string, modelId: string): ModelRouteRef {
  return {
    routeKind: 'provider-model',
    profileId,
    modelId,
  }
}

function cloneModelRouteRef(routeRef: ModelRouteRef): ModelRouteRef {
  return {
    routeKind: routeRef.routeKind,
    profileId: routeRef.profileId,
    modelId: routeRef.modelId,
  }
}

function isSameModelRouteRef(left: ModelRouteRef | null, right: ModelRouteRef | null): boolean {
  return left !== null
    && right !== null
    && left.routeKind === right.routeKind
    && left.profileId === right.profileId
    && left.modelId === right.modelId
}
