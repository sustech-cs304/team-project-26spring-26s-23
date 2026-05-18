import {
  getProviderCatalogEntry,
} from '../../provider-catalog'
import type {
  ModelRouteRef,
  ProviderProfile,
  SelectOption,
} from '../types'

const PROVIDER_MODEL_ROUTE_KIND = 'provider-model'
const MODEL_ROUTE_SELECTION_PREFIX = `${PROVIDER_MODEL_ROUTE_KIND}|`
const MODEL_UNAVAILABLE_REASON = '当前模型不可用，请重新选择。'

export function collectAllModelOptions(
  providerProfiles: ProviderProfile[],
  currentValues: string[] = [],
): SelectOption[] {
  const options = providerProfiles.flatMap((profile) => {
    const availability = resolveProviderDefaultRouteAvailability(profile)

    return profile.availableModels.map((model) => {
      const route = buildModelRouteRef(profile.id, model.modelId)
      const modelLabel = model.displayName.trim() || model.modelId
      const hintParts = [
        availability.available ? null : availability.reason,
      ].filter((value): value is string => value !== null && value !== '')

      return {
        value: serializeModelRouteRef(route),
        label: `${profile.name} · ${modelLabel}`,
        ...(hintParts.length > 0 ? { hint: hintParts.join(' · ') } : {}),
        ...(availability.available ? {} : { disabled: true }),
      }
    })
  })

  const fallbackOptions = currentValues
    .map((value) => value.trim())
    .filter((value, index, array) => value !== '' && array.indexOf(value) === index)
    .filter((value) => !options.some((option) => option.value === value))
    .map((value) => createCurrentSelectionFallbackOption(providerProfiles, value))
    .filter((option): option is SelectOption => option !== null)

  return fallbackOptions.length === 0 ? options : [...fallbackOptions, ...options]
}

export function buildDefaultModelRouteSelectionValue(input: {
  selectedModelId: string
  persistedRoute: ModelRouteRef | null
  providerProfiles: ProviderProfile[]
}): string {
  const persistedRoute = input.persistedRoute
  if (persistedRoute !== null && providerProfilesSupportRoute(input.providerProfiles, persistedRoute)) {
    return serializeModelRouteRef(persistedRoute)
  }

  return input.selectedModelId.trim()
}

export function serializeModelRouteRef(route: ModelRouteRef): string {
  return `${route.routeKind}|${encodeURIComponent(route.profileId)}|${encodeURIComponent(route.modelId)}`
}

export function parseSerializedModelRouteRef(value: string): ModelRouteRef | null {
  const normalizedValue = value.trim()
  if (!normalizedValue.startsWith(MODEL_ROUTE_SELECTION_PREFIX)) {
    return null
  }

  const parts = normalizedValue.split('|')
  if (parts.length !== 3) {
    return null
  }

  const [routeKind, encodedProfileId, encodedModelId] = parts
  if (routeKind !== PROVIDER_MODEL_ROUTE_KIND) {
    return null
  }

  const profileId = decodeRouteValuePart(encodedProfileId)
  const modelId = decodeRouteValuePart(encodedModelId)
  if (profileId === '' || modelId === '') {
    return null
  }

  return {
    routeKind: PROVIDER_MODEL_ROUTE_KIND,
    profileId,
    modelId,
  }
}

export function syncTrackedModelSelectionValue(
  currentValue: string,
  profileId: string,
  previousModelId: string | null,
  nextModelId: string | null,
): string {
  const normalizedPreviousModelId = previousModelId?.trim() ?? ''
  if (normalizedPreviousModelId === '') {
    return currentValue
  }

  const parsedRoute = parseSerializedModelRouteRef(currentValue)
  if (parsedRoute !== null) {
    if (parsedRoute.profileId !== profileId || parsedRoute.modelId !== normalizedPreviousModelId) {
      return currentValue
    }

    return nextModelId?.trim()
      ? serializeModelRouteRef({
          routeKind: PROVIDER_MODEL_ROUTE_KIND,
          profileId,
          modelId: nextModelId.trim(),
        })
      : ''
  }

  return currentValue === normalizedPreviousModelId ? (nextModelId?.trim() ?? '') : currentValue
}

export function resolveSettingsWorkspaceActiveProviderId(
  providerProfiles: ProviderProfile[],
  currentActiveProviderId: string,
): string {
  return providerProfiles.some((profile) => profile.id === currentActiveProviderId)
    ? currentActiveProviderId
    : providerProfiles[0]?.id ?? ''
}

function providerProfilesSupportRoute(providerProfiles: ProviderProfile[], route: ModelRouteRef): boolean {
  const profile = providerProfiles.find((candidate) => candidate.id === route.profileId)
  return profile !== undefined && profile.availableModels.some((model) => model.modelId === route.modelId)
}

function resolveProviderDefaultRouteAvailability(profile: ProviderProfile): {
  available: boolean
  reason: string | null
} {
  const compatibility = profile.compatibility
  if (compatibility?.status === 'legacy' || compatibility?.status === 'unsupported') {
    return {
      available: false,
      reason: MODEL_UNAVAILABLE_REASON,
    }
  }

  const catalogEntry = getProviderCatalogEntry(profile.providerId ?? profile.protocol)
  if (catalogEntry === null) {
    return {
      available: false,
      reason: MODEL_UNAVAILABLE_REASON,
    }
  }

  if (catalogEntry.runtimeStatus !== 'enabled') {
    return {
      available: false,
      reason: MODEL_UNAVAILABLE_REASON,
    }
  }

  return {
    available: true,
    reason: null,
  }
}

function createCurrentSelectionFallbackOption(
  providerProfiles: ProviderProfile[],
  currentValue: string,
): SelectOption | null {
  const parsedRoute = parseSerializedModelRouteRef(currentValue)
  if (parsedRoute !== null) {
    const stillExists = providerProfilesSupportRoute(providerProfiles, parsedRoute)
    if (stillExists) {
      return null
    }

    return {
      value: currentValue,
      label: '当前选择已失效',
      hint: '请重新选择模型。',
      disabled: true,
    }
  }

  return {
    value: currentValue,
    label: '当前选择不可用',
    hint: '请重新选择模型。',
    disabled: true,
  }
}

function buildModelRouteRef(profileId: string, modelId: string): ModelRouteRef {
  return {
    routeKind: PROVIDER_MODEL_ROUTE_KIND,
    profileId,
    modelId,
  }
}

function decodeRouteValuePart(value: string): string {
  try {
    return decodeURIComponent(value).trim()
  } catch {
    return ''
  }
}
