import type { SettingsWorkspaceSecretsLoadStatusesResult } from '../../../../electron/settings-workspace/ipc'
import type {
  SettingsWorkspaceEditableState,
  SettingsWorkspaceToolPermissionPolicyState,
} from '../../../../electron/settings-workspace/schema'
import type { CopilotBootstrapController } from '../../../features/copilot/types'
import type { ModelRouteRef, ProviderProfile } from '../../types'
import { createProviderModelProfile } from '../domains/provider-profiles/provider-profiles'

export interface WorkspaceStateOverrides {
  sustech?: Partial<SettingsWorkspaceEditableState['sustech']>
  providerProfiles?: ProviderProfile[]
  defaultModelRouting?: Partial<SettingsWorkspaceEditableState['defaultModelRouting']>
  general?: Partial<SettingsWorkspaceEditableState['general']>
  mcp?: Partial<SettingsWorkspaceEditableState['mcp']>
  api?: Partial<SettingsWorkspaceEditableState['api']>
  docs?: Partial<SettingsWorkspaceEditableState['docs']>
  externalSource?: Partial<SettingsWorkspaceEditableState['externalSource']>
  toolPermissionPolicy?: Partial<SettingsWorkspaceToolPermissionPolicyState>
}

export function createBootstrapController(): CopilotBootstrapController {
  return {
    retrying: false,
    retry: () => undefined,
    state: {
      status: 'ready',
      bootstrapFields: {
        runtimeUrl: 'http://127.0.0.1:8765',
        agentName: 'campus-agent',
        debugModeEnabled: false,
      },
      storageState: 'stored',
      runtime: {
        status: 'ready',
        expectedMode: 'development',
        resolvedMode: 'development',
        runtimeUrl: 'http://127.0.0.1:8765',
        isPackaged: false,
        failure: null,
      },
      runtimeUrl: 'http://127.0.0.1:8765',
      runtimeSource: 'hosted',
      agentName: 'campus-agent',
      agentNameSource: 'config-center',
      diagnostics: {
        hostedStatus: 'ready',
        failure: null,
        mode: 'development',
        modeSource: 'resolved',
        runtimeSource: 'hosted',
      },
      devOverrideAllowed: true,
      devOverrideConfigured: false,
    },
  }
}

const CREATE_PROVIDER_DEFAULTS = {
  id: 'openrouter', name: 'Persisted Router', protocol: 'openai',
  endpoint: 'https://persisted.example.com/v1', fastModel: 'openai/gpt-4.1-mini',
  fallbackModel: 'anthropic/claude-3.7-sonnet', hasApiKey: true,
  organization: 'persisted-org', region: 'Global', notes: 'persisted provider note',
  compatibility: { status: 'active' as const, reason: '' }, extensions: {} as Record<string, unknown>,
}

/* eslint-disable-next-line complexity */
function resolveCreateProviderProfileDefaults(
  overrides: Partial<ProviderProfile> & { primaryModelId?: string },
) {
  const id = overrides.id ?? CREATE_PROVIDER_DEFAULTS.id
  const name = overrides.name ?? CREATE_PROVIDER_DEFAULTS.name
  const protocol = overrides.protocol ?? CREATE_PROVIDER_DEFAULTS.protocol
  const endpoint = overrides.endpoint ?? CREATE_PROVIDER_DEFAULTS.endpoint
  const primaryModelId = overrides.primaryModelId ?? overrides.availableModels?.[0]?.modelId ?? 'openai/gpt-4.1'
  return {
    id, name, protocol, endpoint, primaryModelId,
    profileId: overrides.profileId ?? id,
    providerId: overrides.providerId ?? protocol,
    displayName: overrides.displayName ?? name,
    baseUrl: overrides.baseUrl ?? endpoint,
    hasApiKey: overrides.hasApiKey ?? CREATE_PROVIDER_DEFAULTS.hasApiKey,
    fastModel: overrides.fastModel ?? CREATE_PROVIDER_DEFAULTS.fastModel,
    fallbackModel: overrides.fallbackModel ?? CREATE_PROVIDER_DEFAULTS.fallbackModel,
    organization: overrides.organization ?? CREATE_PROVIDER_DEFAULTS.organization,
    region: overrides.region ?? CREATE_PROVIDER_DEFAULTS.region,
    notes: overrides.notes ?? CREATE_PROVIDER_DEFAULTS.notes,
    compatibility: overrides.compatibility ?? CREATE_PROVIDER_DEFAULTS.compatibility,
    extensions: overrides.extensions ?? CREATE_PROVIDER_DEFAULTS.extensions,
  }
}

export function createProviderProfile(
  overrides: Partial<ProviderProfile> & { primaryModelId?: string } = {},
): ProviderProfile {
  const d = resolveCreateProviderProfileDefaults(overrides)

  return {
    id: d.id,
    profileId: d.profileId,
    providerId: d.providerId,
    name: d.name,
    displayName: d.displayName,
    protocol: d.protocol,
    endpoint: d.endpoint,
    baseUrl: d.baseUrl,
    hasApiKey: d.hasApiKey,
    fastModel: d.fastModel,
    fallbackModel: d.fallbackModel,
    organization: d.organization,
    region: d.region,
    notes: d.notes,
    compatibility: d.compatibility,
    extensions: d.extensions,
    availableModels:
      overrides.availableModels
      ?? [
        createProviderModelProfile(d.id, d.primaryModelId, d.name),
      ],
  }
}

export function createPersistedWorkspaceState(overrides: WorkspaceStateOverrides = {}): SettingsWorkspaceEditableState {
  const baseState: SettingsWorkspaceEditableState = {
    sustech: {
      studentId: '',
      email: '',
      blackboardCurrentTermOnly: false,
      blackboardParallelSyncWorkers: '1',
      blackboardSyncInterval: 'off',
      blackboardLastAutoSyncAt: null,
      blackboardNextAutoSyncAt: null,
    },
    providerProfiles: [createProviderProfile()],
    defaultModelRouting: {
      primaryAssistantModel: 'openai/gpt-4.1',
      fastAssistantModel: 'openai/gpt-4.1-mini',
      primaryAssistantModelRoute: {
        routeKind: 'provider-model',
        profileId: 'openrouter',
        modelId: 'openai/gpt-4.1',
      },
      fastAssistantModelRoute: {
        routeKind: 'provider-model',
        profileId: 'openrouter',
        modelId: 'openai/gpt-4.1-mini',
      },
    },
    general: {
      language: 'zh-CN',
      assistantNotificationsEnabled: true,
    },
    mcp: {
      mcpAutoDiscoveryEnabled: true,
      toolPermissionMode: 'manual',
      toolPermissionPolicy: {
        version: 1,
        migrationSourceMode: 'manual',
        defaultMode: 'ask',
        toolPermissions: {},
      },
    },
    api: {
      apiReconnectMode: 'exponential',
      healthPollingEnabled: true,
      apiBaseUrl: 'http://127.0.0.1:8000',
    },
    docs: {
      docsFormat: 'markdown',
    },
    externalSource: {
      wakeupShareLink: '',
    },
  }

  const providerProfiles = overrides.providerProfiles ?? baseState.providerProfiles
  const mergedDefaultModelRouting = { ...baseState.defaultModelRouting, ...overrides.defaultModelRouting }
  const hasPrimaryRouteOverride = Object.prototype.hasOwnProperty.call(overrides.defaultModelRouting ?? {}, 'primaryAssistantModelRoute')
  const hasFastRouteOverride = Object.prototype.hasOwnProperty.call(overrides.defaultModelRouting ?? {}, 'fastAssistantModelRoute')

  return {
    sustech: { ...baseState.sustech, ...overrides.sustech },
    providerProfiles,
    defaultModelRouting: {
      ...mergedDefaultModelRouting,
      primaryAssistantModelRoute: hasPrimaryRouteOverride
        ? overrides.defaultModelRouting?.primaryAssistantModelRoute ?? null
        : resolveModelRouteRef(providerProfiles, mergedDefaultModelRouting.primaryAssistantModel),
      fastAssistantModelRoute: hasFastRouteOverride
        ? overrides.defaultModelRouting?.fastAssistantModelRoute ?? null
        : resolveModelRouteRef(providerProfiles, mergedDefaultModelRouting.fastAssistantModel),
    },
    general: { ...baseState.general, ...overrides.general },
    mcp: {
      ...baseState.mcp,
      ...overrides.mcp,
      toolPermissionPolicy: {
        ...baseState.mcp.toolPermissionPolicy,
        ...overrides.mcp?.toolPermissionPolicy,
        toolPermissions: {
          ...baseState.mcp.toolPermissionPolicy.toolPermissions,
          ...overrides.mcp?.toolPermissionPolicy?.toolPermissions,
        },
      },
    },
    api: { ...baseState.api, ...overrides.api },
    docs: { ...baseState.docs, ...overrides.docs },
    externalSource: { ...baseState.externalSource, ...overrides.externalSource },
  }
}

function resolveModelRouteRef(
  providerProfiles: ProviderProfile[],
  modelId: string,
): ModelRouteRef | null {
  const normalizedModelId = modelId.trim()
  if (normalizedModelId === '') {
    return null
  }

  const matchingProfiles = providerProfiles.filter((profile) => {
    return profile.availableModels.some((model) => model.modelId === normalizedModelId)
  })

  if (matchingProfiles.length !== 1) {
    return null
  }

  return {
    routeKind: 'provider-model',
    profileId: matchingProfiles[0]!.profileId ?? matchingProfiles[0]!.id,
    modelId: normalizedModelId,
  }
}

export function createSingleProviderWorkspaceState(providerOverrides: Partial<ProviderProfile> = {}): SettingsWorkspaceEditableState {
  return createPersistedWorkspaceState({
    providerProfiles: [createProviderProfile(providerOverrides)],
  })
}

export function createPersistedSecretStatesResult(
  apiKey = 'persisted-secret',
  providerId = 'openrouter',
): SettingsWorkspaceSecretsLoadStatusesResult {
  return {
    ok: true,
    states: {
      [providerId]: {
        hasApiKey: apiKey !== '',
        apiKey,
      },
    },
  }
}
