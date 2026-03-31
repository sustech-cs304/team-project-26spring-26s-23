import type { ProviderProfile } from '../../src/workbench/types'
import { normalizeNonEmptyString } from './normalize'
import type { SettingsWorkspaceProviderSecretStateById } from './secret-schema'
import type { SettingsWorkspaceEditableState } from './state-schema'

export const SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES = {
  PROVIDER_PROFILE_NOT_FOUND: 'provider_profile_not_found',
  ROUTE_SNAPSHOT_MISMATCH: 'route_snapshot_mismatch',
  PROVIDER_SECRET_MISSING: 'provider_secret_missing',
} as const

export type SettingsWorkspaceProviderRouteErrorCode =
  (typeof SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES)[keyof typeof SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES]

export type SettingsWorkspaceProviderRouteSnapshotMismatchField =
  | 'provider'
  | 'endpointType'
  | 'baseUrl'
  | 'modelId'

export interface SettingsWorkspaceProviderRouteSnapshot {
  provider: string
  endpointType: string
  baseUrl: string
  modelId: string
}

export interface SettingsWorkspaceProviderRouteResolveRequest {
  providerProfileId: string
  snapshot: SettingsWorkspaceProviderRouteSnapshot
}

export interface SettingsWorkspaceResolvedProviderRoute {
  providerProfileId: string
  provider: string
  endpointType: string
  baseUrl: string
  modelId: string
  auth: {
    apiKey: string
  }
}

export interface SettingsWorkspaceProviderRouteSnapshotMismatch {
  field: SettingsWorkspaceProviderRouteSnapshotMismatchField
  expected: string
  actual: string
}

export interface SettingsWorkspaceProviderRouteResolveError {
  code: SettingsWorkspaceProviderRouteErrorCode
  message: string
  details: Record<string, unknown>
}

export type SettingsWorkspaceProviderRouteResolveResult =
  | {
    ok: true
    route: SettingsWorkspaceResolvedProviderRoute
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
  const normalizedProviderProfileId = normalizeIdentifier(input.request.providerProfileId)
  const providerProfile = input.state.providerProfiles.find((profile) => {
    return normalizeIdentifier(profile.id) === normalizedProviderProfileId
  })

  if (providerProfile === undefined) {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.PROVIDER_PROFILE_NOT_FOUND,
        message: `Provider profile '${input.request.providerProfileId}' does not exist.`,
        details: {
          providerProfileId: input.request.providerProfileId,
        },
      },
    }
  }

  const mismatches = collectSnapshotMismatches(providerProfile, input.request.snapshot)
  if (mismatches.length > 0) {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.ROUTE_SNAPSHOT_MISMATCH,
        message: `Provider profile '${providerProfile.id}' no longer matches the requested route snapshot.`,
        details: {
          providerProfileId: providerProfile.id,
          mismatches,
        },
      },
    }
  }

  const apiKey = normalizeNonEmptyString(input.secretStates[providerProfile.id]?.apiKey, '')
  if (apiKey === '') {
    return {
      ok: false,
      error: {
        code: SETTINGS_WORKSPACE_PROVIDER_ROUTE_ERROR_CODES.PROVIDER_SECRET_MISSING,
        message: `Provider profile '${providerProfile.id}' is missing an API key.`,
        details: {
          providerProfileId: providerProfile.id,
        },
      },
    }
  }

  const normalizedBaseUrl = normalizeBaseUrl(providerProfile.endpoint)
  const normalizedModelId = normalizeModelId(input.request.snapshot.modelId)

  return {
    ok: true,
    route: {
      providerProfileId: providerProfile.id,
      provider: projectProviderIdentifier(providerProfile),
      endpointType: projectEndpointType(providerProfile),
      baseUrl: normalizedBaseUrl,
      modelId: normalizedModelId,
      auth: {
        apiKey,
      },
    },
  }
}

function collectSnapshotMismatches(
  profile: ProviderProfile,
  snapshot: SettingsWorkspaceProviderRouteSnapshot,
): SettingsWorkspaceProviderRouteSnapshotMismatch[] {
  const mismatches: SettingsWorkspaceProviderRouteSnapshotMismatch[] = []
  const expectedProvider = projectProviderIdentifier(profile)
  const actualProvider = normalizeIdentifier(snapshot.provider)
  if (expectedProvider !== actualProvider) {
    mismatches.push({
      field: 'provider',
      expected: expectedProvider,
      actual: actualProvider,
    })
  }

  const expectedEndpointType = projectEndpointType(profile)
  const actualEndpointType = normalizeIdentifier(snapshot.endpointType)
  if (expectedEndpointType !== actualEndpointType) {
    mismatches.push({
      field: 'endpointType',
      expected: expectedEndpointType,
      actual: actualEndpointType,
    })
  }

  const expectedBaseUrl = normalizeBaseUrl(profile.endpoint)
  const actualBaseUrl = normalizeBaseUrl(snapshot.baseUrl)
  if (expectedBaseUrl !== actualBaseUrl) {
    mismatches.push({
      field: 'baseUrl',
      expected: expectedBaseUrl,
      actual: actualBaseUrl,
    })
  }

  const normalizedModelId = normalizeModelId(snapshot.modelId)
  if (!providerProfileSupportsModel(profile, normalizedModelId)) {
    mismatches.push({
      field: 'modelId',
      expected: buildSupportedModelSummary(profile),
      actual: normalizedModelId,
    })
  }

  return mismatches
}

function providerProfileSupportsModel(profile: ProviderProfile, modelId: string): boolean {
  const supportedModelIds = new Set<string>()

  for (const model of profile.availableModels) {
    const normalizedModelId = normalizeModelId(model.modelId)
    if (normalizedModelId !== '') {
      supportedModelIds.add(normalizedModelId)
    }
  }

  for (const candidate of [profile.defaultModel, profile.fastModel, profile.fallbackModel]) {
    const normalizedModelId = normalizeModelId(candidate)
    if (normalizedModelId !== '') {
      supportedModelIds.add(normalizedModelId)
    }
  }

  return supportedModelIds.has(modelId)
}

function buildSupportedModelSummary(profile: ProviderProfile): string {
  const supportedModelIds = Array.from(new Set([
    ...profile.availableModels.map((model) => normalizeModelId(model.modelId)),
    normalizeModelId(profile.defaultModel),
    normalizeModelId(profile.fastModel),
    normalizeModelId(profile.fallbackModel),
  ].filter((modelId) => modelId !== '')))

  return supportedModelIds.join(', ')
}

function projectProviderIdentifier(profile: ProviderProfile): string {
  return normalizeIdentifier(profile.protocol)
}

function projectEndpointType(profile: ProviderProfile): string {
  const provider = projectProviderIdentifier(profile)
  return provider === 'openai' ? 'openai-compatible' : provider
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
