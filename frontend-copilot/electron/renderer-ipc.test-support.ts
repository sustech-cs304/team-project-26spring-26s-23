import { vi } from 'vitest'
import type { ConfigCenterPublicPatchResult } from './config-center/public-patch'
import type { ConfigCenterPublicSnapshot, ConfigCenterPublicSnapshotLoadResult } from './config-center/public-snapshot'
import type { CopilotRuntimeLoadResult, CopilotRuntimeSnapshot } from './copilot-runtime'
import type { RendererIpcHandlers } from './renderer-ipc-registration'
import type {
  SettingsWorkspaceProviderSecretMutationResult,
  SettingsWorkspaceSecretsLoadStatusesResult,
  SettingsWorkspaceStateLoadResult,
  SettingsWorkspaceStateSaveResult,
  SettingsWorkspaceSustechCasSecretLoadResult,
  SettingsWorkspaceSustechCasSecretMutationResult,
} from './settings-workspace/ipc'
import type { SettingsWorkspaceEditableState } from './settings-workspace/state-schema'

export function createFakeIpcMain() {
  const registeredHandlers = new Map<string, (...args: unknown[]) => Promise<unknown> | unknown>()

  return {
    registeredHandlers,
    ipcMain: {
      removeHandler: vi.fn((channel: string) => {
        registeredHandlers.delete(channel)
      }),
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown> | unknown) => {
        registeredHandlers.set(channel, handler)
      }),
    },
  }
}

export function createFakeIpcRenderer() {
  const registeredListeners = new Map<string, (...args: unknown[]) => void>()

  return {
    registeredListeners,
    ipcRenderer: {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        registeredListeners.set(channel, listener)
      }),
    },
  }
}

export function createRendererIpcHandlers(): RendererIpcHandlers {
  return {
    loadConfigCenterPublicSnapshot: vi.fn(async (): Promise<ConfigCenterPublicSnapshotLoadResult> => ({
      ok: true,
      snapshot: createConfigCenterPublicSnapshot({
        theme: 'light',
        model: null,
      }),
    })),
    applyConfigCenterPublicPatch: vi.fn(async (): Promise<ConfigCenterPublicPatchResult> => ({
      ok: true,
      snapshot: createConfigCenterPublicSnapshot({
        theme: 'dark',
        model: 'qwen-plus',
      }),
    })),
    loadSettingsWorkspaceState: vi.fn(async (): Promise<SettingsWorkspaceStateLoadResult> => ({
      ok: true,
      source: 'stored',
      state: createSettingsWorkspaceState(),
    })),
    saveSettingsWorkspaceState: vi.fn(async (): Promise<SettingsWorkspaceStateSaveResult> => ({
      ok: true,
      state: createSettingsWorkspaceState(),
    })),
    loadSettingsWorkspaceSecretStates: vi.fn(async (): Promise<SettingsWorkspaceSecretsLoadStatusesResult> => ({
      ok: true,
      states: {
        openrouter: {
          hasApiKey: true,
          apiKey: 'persisted-secret',
        },
      },
    })),
    loadSettingsWorkspaceSustechCasSecret: vi.fn(async (): Promise<SettingsWorkspaceSustechCasSecretLoadResult> => ({
      ok: true,
      state: {
        hasPassword: true,
        password: 'persisted-cas-secret',
      },
    })),
    saveSettingsWorkspaceProviderSecret: vi.fn(async (): Promise<SettingsWorkspaceProviderSecretMutationResult> => ({
      ok: true,
      providerId: 'openrouter',
      state: {
        hasApiKey: true,
        apiKey: 'persisted-secret',
      },
    })),
    clearSettingsWorkspaceProviderSecret: vi.fn(async (): Promise<SettingsWorkspaceProviderSecretMutationResult> => ({
      ok: true,
      providerId: 'openrouter',
      state: {
        hasApiKey: false,
        apiKey: '',
      },
    })),
    saveSettingsWorkspaceSustechCasSecret: vi.fn(async (): Promise<SettingsWorkspaceSustechCasSecretMutationResult> => ({
      ok: true,
      state: {
        hasPassword: true,
        password: 'persisted-cas-secret',
      },
    })),
    clearSettingsWorkspaceSustechCasSecret: vi.fn(async (): Promise<SettingsWorkspaceSustechCasSecretMutationResult> => ({
      ok: true,
      state: {
        hasPassword: false,
        password: '',
      },
    })),
    loadCopilotRuntime: vi.fn(async (): Promise<CopilotRuntimeLoadResult> => ({
      ok: true,
      snapshot: createCopilotRuntimeSnapshot('ready', 'development'),
    })),
    retryCopilotRuntime: vi.fn(async (): Promise<CopilotRuntimeLoadResult> => ({
      ok: true,
      snapshot: createCopilotRuntimeSnapshot('starting', null),
    })),
    notifyBootstrapWindowReady: vi.fn(async () => undefined),
  }
}

function createConfigCenterPublicSnapshot(options: {
  theme: 'light' | 'dark'
  model: string | null
}): ConfigCenterPublicSnapshot {
  return {
    version: 1,
    domains: {
      frontendPreferences: {
        theme: options.theme,
        animationsEnabled: true,
      },
      assistantBehavior: {
        agentName: 'planner',
      },
      hostConfig: {
        runtimeUrl: 'http://127.0.0.1:4400',
      },
      backendExposed: {
        model: options.model,
      },
    },
  }
}

function createSettingsWorkspaceState(): SettingsWorkspaceEditableState {
  return {
    sustech: {
      studentId: '',
      email: '',
      blackboardAutoDownloadEnabled: false,
      blackboardDownloadLimitMb: '0',
    },
    providerProfiles: [],
    defaultModelRouting: {
      primaryAssistantModel: '',
      fastAssistantModel: '',
    },
    general: {
      language: 'zh-CN',
      proxyMode: 'system',
      assistantNotificationsEnabled: false,
      backupEnabled: true,
    },
    data: {
      dataPath: 'D:/workspace/copilot-data',
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
}

function createCopilotRuntimeSnapshot(
  status: CopilotRuntimeSnapshot['hosted']['status'],
  resolvedMode: CopilotRuntimeSnapshot['hosted']['resolvedMode'],
): CopilotRuntimeSnapshot {
  return {
    hosted: {
      status,
      expectedMode: 'development',
      resolvedMode,
      runtimeUrl: resolvedMode === null ? null : 'http://127.0.0.1:4400',
      isPackaged: false,
      failure: null,
    },
  }
}
