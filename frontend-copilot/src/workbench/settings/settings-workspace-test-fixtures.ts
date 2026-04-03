import type { SettingsWorkspaceSecretsLoadStatusesResult } from '../../../electron/settings-workspace/ipc'
import type { SettingsWorkspaceEditableState } from '../../../electron/settings-workspace/schema'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import type { ProviderProfile } from '../types'
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

export function createProviderProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  const id = overrides.id ?? 'openrouter'
  const name = overrides.name ?? 'Persisted Router'

  return {
    id,
    name,
    protocol: overrides.protocol ?? 'openai',
    endpoint: overrides.endpoint ?? 'https://persisted.example.com/v1',
    hasApiKey: overrides.hasApiKey ?? true,
    defaultModel: overrides.defaultModel ?? 'openai/gpt-4.1',
    fastModel: overrides.fastModel ?? 'openai/gpt-4.1-mini',
    fallbackModel: overrides.fallbackModel ?? 'anthropic/claude-3.7-sonnet',
    organization: overrides.organization ?? 'persisted-org',
    region: overrides.region ?? 'Global',
    notes: overrides.notes ?? 'persisted provider note',
    availableModels:
      overrides.availableModels
      ?? [
        createProviderModelProfile(id, overrides.defaultModel ?? 'openai/gpt-4.1', name),
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

  return {
    sustech: { ...baseState.sustech, ...overrides.sustech },
    providerProfiles: overrides.providerProfiles ?? baseState.providerProfiles,
    defaultModelRouting: { ...baseState.defaultModelRouting, ...overrides.defaultModelRouting },
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
