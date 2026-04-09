import {
  getProviderCatalogEntry,
  getProviderCatalogRevision,
  normalizeProviderCatalogIdentifier,
  type ProviderAuthKind,
  type ProviderRuntimeStatus,
} from '../../src/provider-catalog'
import type { ProviderProfile } from '../../src/workbench/types'
import { normalizeNonEmptyString } from './normalize'
import type { SettingsWorkspaceProviderSecretStateById } from './secret-schema'
import type { SettingsWorkspaceEditableState } from './state-schema'

export const SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES = {
  INVALID_REQUEST: 'invalid_provider_route_request',
  PROVIDER_PROFILE_NOT_FOUND: 'provider_profile_not_found',
  PROVIDER_CATALOG_ENTRY_NOT_FOUND: 'provider_catalog_entry_not_found',
  PROVIDER_PROFILE_LEGACY: 'provider_profile_legacy',
  PROVIDER_PROFILE_UNSUPPORTED: 'provider_profile_unsupported',
  PROVIDER_RUNTIME_CATALOG_ONLY: 'provider_runtime_catalog_only',
  PROVIDER_RUNTIME_LEGACY_UNSUPPORTED: 'provider_runtime_legacy_unsupported',
  PROVIDER_MODEL_NOT_FOUND: 'provider_model_not_found',
  PROVIDER_SECRET_MISSING: 'provider_secret_missing',
  CATALOG_REVISION_MISMATCH: 'provider_catalog_revision_mismatch',
} as const

export type SettingsWorkspaceProviderRouteErrorCode =
  (typeof SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES)[keyof typeof SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES]

export interface SettingsWorkspaceModelRouteRef {
  routeKind: 'provider-model'
  profileId: string
  modelId: string
}

export interface SettingsWorkspaceProviderRouteResolveRequest {
  routeRef: SettingsWorkspaceModelRouteRef
  catalogRevision?: string
}

export interface SettingsWorkspaceResolvedProviderRoute {
  routeRef: SettingsWorkspaceModelRouteRef
  providerProfileId: string
  provider: string
  providerId: string
  adapterId: string
  runtimeStatus: ProviderRuntimeStatus
  catalogRevision: string
  endpointFamily: string
  endpointType: string
  baseUrl: string
  modelId: string
  authKind: ProviderAuthKind
}

export interface SettingsWorkspaceResolvedProviderRoutePrivateAuth {
  authKind: ProviderAuthKind
  authPayload: {
    apiKey?: string
  }
  apiKey: string
}

export interface SettingsWorkspaceProviderRouteResolveError {
  code: SettingsWorkspaceProviderRouteErrorCode
  message: string
  details: Record<string, unknown>
}

export type SettingsWorkspaceProviderRouteResolveResult =
  | {
    ok: true
    resolvedRoute: SettingsWorkspaceResolvedProviderRoute
    privateAuth: SettingsWorkspaceResolvedProviderRoutePrivateAuth
  }
  | {
    ok: false
    error: SettingsWorkspaceProviderRouteResolveError
  }

export interface ResolveSettingsWorkspaceProviderRouteInput {
  state: SettingsWorkspaceEditableState
  secretStates: SettingsWorkspaceProviderSecretStateById
  request: SettingsWorkspaceProviderRouteResolveRequest
}

export function resolveSettingsWorkspaceProviderRoute(
  input: ResolveSettingsWorkspaceProviderRouteInput,
): SettingsWorkspaceProviderRouteResolveResult {
  const requestedRouteRef = resolveRequestedRouteRef(input.request)
  if (requestedRouteRef === null) {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.INVALID_REQUEST,
        message: 'Provider route request must include a stable routeRef.',
        details: {},
      },
    }
  }

  const providerProfile = input.state.providerProfiles.find((profile) => {
    return normalizeIdentifier(resolveProfileId(profile)) === normalizeIdentifier(requestedRouteRef.profileId)
  })

  if (providerProfile === undefined) {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.PROVIDER_PROFILE_NOT_FOUND,
        message: `Provider profile '${requestedRouteRef.profileId}' does not exist.`,
        details: {
          providerProfileId: requestedRouteRef.profileId,
          routeRef: requestedRouteRef,
        },
      },
    }
  }

  const providerProfileId = resolveProfileId(providerProfile)
  const providerId = resolveProviderIdFromProfile(providerProfile)
  const providerCatalogEntry = getProviderCatalogEntry(providerId)
  if (providerCatalogEntry === null) {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.PROVIDER_CATALOG_ENTRY_NOT_FOUND,
        message: `Provider '${providerId}' is not defined in provider catalog.`,
        details: {
          providerProfileId,
          providerId,
          routeRef: requestedRouteRef,
        },
      },
    }
  }

  const compatibilityStatus = providerProfile.compatibility?.status ?? 'active'
  if (compatibilityStatus === 'legacy') {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.PROVIDER_PROFILE_LEGACY,
        message: `Provider profile '${providerProfileId}' is marked as legacy and cannot be resolved for runtime execution.`,
        details: {
          providerProfileId,
          providerId,
          routeRef: requestedRouteRef,
          compatibility: providerProfile.compatibility,
        },
      },
    }
  }

  if (compatibilityStatus === 'unsupported') {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.PROVIDER_PROFILE_UNSUPPORTED,
        message: `Provider profile '${providerProfileId}' is marked as unsupported and cannot be resolved for runtime execution.`,
        details: {
          providerProfileId,
          providerId,
          routeRef: requestedRouteRef,
          compatibility: providerProfile.compatibility,
        },
      },
    }
  }

  if (providerCatalogEntry.runtimeStatus === 'catalog-only') {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.PROVIDER_RUNTIME_CATALOG_ONLY,
        message: `Provider '${providerCatalogEntry.providerId}' is catalog-only and cannot be resolved for runtime execution.`,
        details: {
          providerProfileId,
          providerId: providerCatalogEntry.providerId,
          routeRef: requestedRouteRef,
          runtimeStatus: providerCatalogEntry.runtimeStatus,
        },
      },
    }
  }

  if (providerCatalogEntry.runtimeStatus === 'legacy-unsupported') {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.PROVIDER_RUNTIME_LEGACY_UNSUPPORTED,
        message: `Provider '${providerCatalogEntry.providerId}' is marked as legacy-unsupported in provider catalog.`,
        details: {
          providerProfileId,
          providerId: providerCatalogEntry.providerId,
          routeRef: requestedRouteRef,
          runtimeStatus: providerCatalogEntry.runtimeStatus,
        },
      },
    }
  }

  const normalizedModelId = normalizeModelId(requestedRouteRef.modelId)
  if (!providerProfileSupportsModel(providerProfile, normalizedModelId)) {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.PROVIDER_MODEL_NOT_FOUND,
        message: `Provider profile '${providerProfileId}' does not define model '${normalizedModelId}'.`,
        details: {
          providerProfileId,
          providerId: providerCatalogEntry.providerId,
          routeRef: requestedRouteRef,
          modelId: normalizedModelId,
          supportedModelIds: buildSupportedModelIds(providerProfile),
        },
      },
    }
  }

  const catalogRevision = getProviderCatalogRevision()
  const requestedCatalogRevision = normalizeNonEmptyString(input.request.catalogRevision, '')
  if (requestedCatalogRevision !== '' && requestedCatalogRevision !== catalogRevision) {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.CATALOG_REVISION_MISMATCH,
        message: `Requested provider catalog revision '${requestedCatalogRevision}' does not match current revision '${catalogRevision}'.`,
        details: {
          providerProfileId,
          providerId: providerCatalogEntry.providerId,
          routeRef: requestedRouteRef,
          expectedCatalogRevision: requestedCatalogRevision,
          actualCatalogRevision: catalogRevision,
        },
      },
    }
  }

  const normalizedBaseUrl = resolveExpectedBaseUrl(providerProfile, providerCatalogEntry)
  const normalizedRouteRef = buildRouteRef(providerProfileId, normalizedModelId)

  const authKind = providerCatalogEntry.authSchema.defaultKind
  const apiKey = normalizeNonEmptyString(input.secretStates[providerProfileId]?.apiKey, '')
  if (authKind !== 'none' && apiKey === '') {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.PROVIDER_SECRET_MISSING,
        message: `Provider profile '${providerProfileId}' is missing an API key.`,
        details: {
          providerProfileId,
          providerId: providerCatalogEntry.providerId,
          routeRef: normalizedRouteRef,
          authKind,
        },
      },
    }
  }

  const resolvedRoute: SettingsWorkspaceResolvedProviderRoute = {
    routeRef: normalizedRouteRef,
    providerProfileId,
    provider: providerCatalogEntry.providerId,
    providerId: providerCatalogEntry.providerId,
    adapterId: providerCatalogEntry.adapterId,
    runtimeStatus: providerCatalogEntry.runtimeStatus,
    catalogRevision,
    endpointFamily: resolveEndpointFamily(providerCatalogEntry.endpointType),
    endpointType: providerCatalogEntry.endpointType,
    baseUrl: normalizedBaseUrl,
    modelId: normalizedModelId,
    authKind,
  }

  return {
    ok: true,
    resolvedRoute,
    privateAuth: {
      authKind,
      authPayload: apiKey === '' ? {} : { apiKey },
      apiKey,
    },
  }
}

function resolveRequestedRouteRef(
  request: SettingsWorkspaceProviderRouteResolveRequest,
): SettingsWorkspaceModelRouteRef | null {
  if (!isRouteRef(request.routeRef)) {
    return null
  }

  return buildRouteRef(request.routeRef.profileId, request.routeRef.modelId)
}

function providerProfileSupportsModel(profile: ProviderProfile, modelId: string): boolean {
  return buildSupportedModelIds(profile).includes(modelId)
}

function buildSupportedModelIds(profile: ProviderProfile): string[] {
  return Array.from(new Set(
    profile.availableModels
      .map((model) => normalizeModelId(model.modelId))
      .filter((candidate) => candidate !== ''),
  ))
}

function buildRouteRef(profileId: string, modelId: string): SettingsWorkspaceModelRouteRef {
  return {
    routeKind: 'provider-model',
    profileId: normalizeNonEmptyString(profileId, ''),
    modelId: normalizeModelId(modelId),
  }
}

function resolveProfileId(profile: ProviderProfile): string {
  return normalizeNonEmptyString(profile.profileId, normalizeNonEmptyString(profile.id, ''))
}

function resolveProviderIdFromProfile(profile: ProviderProfile): string {
  return normalizeProviderCatalogIdentifier(profile.providerId ?? profile.protocol)
}

function resolveExpectedBaseUrl(
  profile: ProviderProfile,
  providerCatalogEntry: NonNullable<ReturnType<typeof getProviderCatalogEntry>>,
): string {
  return normalizeBaseUrl(
    profile.baseUrl
      ?? profile.endpoint
      ?? providerCatalogEntry.baseUrlPolicy.defaultBaseUrl
      ?? '',
  )
}

function resolveEndpointFamily(endpointType: string): string {
  const normalizedEndpointType = normalizeIdentifier(endpointType)
  if (normalizedEndpointType === '') {
    return ''
  }

  const separatorIndex = normalizedEndpointType.indexOf('-')
  return separatorIndex < 0 ? normalizedEndpointType : normalizedEndpointType.slice(0, separatorIndex)
}

function isRouteRef(value: SettingsWorkspaceProviderRouteResolveRequest['routeRef']): value is SettingsWorkspaceModelRouteRef {
  return value !== undefined
    && value !== null
    && value.routeKind === 'provider-model'
    && normalizeNonEmptyString(value.profileId, '') !== ''
    && normalizeModelId(value.modelId) !== ''
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function normalizeModelId(value: string): string {
  return normalizeNonEmptyString(value, '')
}
