import type { SettingsWorkspaceSecretsLoadStatusesResult } from '../../../electron/settings-workspace/ipc'
import type { SettingsWorkspaceEditableState } from '../../../electron/settings-workspace/schema'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import type { ModelRouteRef, ProviderProfile } from '../types'
import { createProviderModelProfile } from './provider-profiles'

export interface WorkspaceStateOverrides {
  sustech?: Partial<SettingsWorkspaceEditableState['sustech']>
  providerProfiles?: ProviderProfile[]
  defaultModelRouting?: Partial<SettingsWorkspaceEditableState['defaultModelRouting']>
  general?: Partial<SettingsWorkspaceEditableState['general']>
  data?: Partial<SettingsWorkspaceEditableState['data']>
  mcp?: Partial<SettingsWorkspaceEditableState['mcp']>
  search?: Partial<SettingsWorkspaceEditableState['search']>
  memory?: Partial<SettingsWorkspaceEditableState['memory']>
  api?: Partial<SettingsWorkspaceEditableState['api']>
  docs?: Partial<SettingsWorkspaceEditableState['docs']>
  externalSource?: Partial<SettingsWorkspaceEditableState['externalSource']>
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

export function createProviderProfile(
  overrides: Partial<ProviderProfile> & { primaryModelId?: string } = {},
): ProviderProfile {
  const id = overrides.id ?? 'openrouter'
  const name = overrides.name ?? 'Persisted Router'

  const protocol = overrides.protocol ?? 'openai'
  const endpoint = overrides.endpoint ?? 'https://persisted.example.com/v1'
  const primaryModelId = overrides.primaryModelId ?? overrides.availableModels?.[0]?.modelId ?? 'openai/gpt-4.1'
  const fastModel = overrides.fastModel ?? 'openai/gpt-4.1-mini'
  const fallbackModel = overrides.fallbackModel ?? 'anthropic/claude-3.7-sonnet'

  return {
    id,
    profileId: overrides.profileId ?? id,
    providerId: overrides.providerId ?? protocol,
    name,
    displayName: overrides.displayName ?? name,
    protocol,
    endpoint,
    baseUrl: overrides.baseUrl ?? endpoint,
    hasApiKey: overrides.hasApiKey ?? true,
    fastModel,
    fallbackModel,
    organization: overrides.organization ?? 'persisted-org',
    region: overrides.region ?? 'Global',
    notes: overrides.notes ?? 'persisted provider note',
    compatibility: overrides.compatibility ?? {
      status: 'active',
      reason: '',
    },
    extensions: overrides.extensions ?? {},
    availableModels:
      overrides.availableModels
      ?? [
        createProviderModelProfile(id, primaryModelId, name),
      ],
  }
}

export function createPersistedWorkspaceState(overrides: WorkspaceStateOverrides = {}): SettingsWorkspaceEditableState {
  const baseState: SettingsWorkspaceEditableState = {
    sustech: {
      studentId: '',
      email: '',
      blackboardAutoDownloadEnabled: false,
      blackboardDownloadLimitMb: '0',
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
      proxyMode: 'system',
      assistantNotificationsEnabled: true,
      backupEnabled: false,
    },
    data: {
      dataPath: 'D:/workspace/persisted-data',
      backupCycle: 'daily',
      launchSyncEnabled: true,
    },
    mcp: {
      mcpAutoDiscoveryEnabled: true,
      toolPermissionMode: 'manual',
    },
    search: {
      searchEngine: 'google',
      searchResultCount: '8',
      compressionMode: 'summary',
    },
    memory: {
      memoryStrategy: 'session-longterm',
      memoryCleanupEnabled: true,
    },
    api: {
      apiReconnectMode: 'exponential',
      healthPollingEnabled: true,
      apiBaseUrl: 'http://127.0.0.1:8000',
    },
    docs: {
      docsFormat: 'markdown',
      outputDirectory: 'D:/workspace/exports',
      autoFileNameEnabled: true,
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
    data: { ...baseState.data, ...overrides.data },
    mcp: { ...baseState.mcp, ...overrides.mcp },
    search: { ...baseState.search, ...overrides.search },
    memory: { ...baseState.memory, ...overrides.memory },
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
