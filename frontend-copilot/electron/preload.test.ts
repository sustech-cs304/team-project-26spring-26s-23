import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BOOTSTRAP_WINDOW_READY_CHANNEL, type BootstrapWindowApi } from './bootstrap-window'
import { CONFIG_CENTER_PUBLIC_PATCH_CHANNEL, type ConfigCenterPublicPatchApi } from './config-center/public-patch'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL,
  type ConfigCenterPublicSnapshot,
  type ConfigCenterPublicSnapshotApi,
  type ConfigCenterPublicSnapshotSubscriptionApi,
} from './config-center/public-snapshot'
import { COPILOT_RUNTIME_LOAD_CHANNEL, COPILOT_RUNTIME_RETRY_CHANNEL, type CopilotRuntimeApi } from './copilot-runtime'
import { MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL, type RuntimeConsoleEntry } from './renderer-ipc'
import {
  SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_CLEAR_SUSTECH_CAS_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_LOAD_SUSTECH_CAS_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_SAVE_SUSTECH_CAS_CHANNEL,
  SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL,
  SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL,
  type SettingsWorkspaceSecretsApi,
  type SettingsWorkspaceStateApi,
} from './settings-workspace/ipc'

const preloadMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: preloadMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: preloadMocks.invoke,
    on: preloadMocks.on,
    off: preloadMocks.off,
  },
}))

beforeEach(() => {
  vi.resetModules()
  preloadMocks.exposeInMainWorld.mockReset()
  preloadMocks.invoke.mockReset()
  preloadMocks.on.mockReset()
  preloadMocks.off.mockReset()
})

describe('preload renderer bridge', () => {
  it('exposes runtime and config center public APIs without the legacy settings bridge', async () => {
    await import('./preload')

    const exposedKeys = preloadMocks.exposeInMainWorld.mock.calls.map(([key]) => key)

    expect(exposedKeys).toEqual([
      'copilotRuntime',
      'configCenterPublicSnapshot',
      'configCenterPublicSnapshotSubscription',
      'configCenterPublicPatch',
      'settingsWorkspaceState',
      'settingsWorkspaceSecrets',
      'bootstrapWindow',
    ])
    expect(exposedKeys).not.toContain('copilotSettings')
  })

  it('routes exposed preload APIs through the expected runtime and config center channels', async () => {
    preloadMocks.invoke.mockResolvedValue(undefined)
    await import('./preload')

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const runtimeApi = getExposedApi<CopilotRuntimeApi>('copilotRuntime')
    const snapshotApi = getExposedApi<ConfigCenterPublicSnapshotApi>('configCenterPublicSnapshot')
    const subscriptionApi = getExposedApi<ConfigCenterPublicSnapshotSubscriptionApi>('configCenterPublicSnapshotSubscription')
    const patchApi = getExposedApi<ConfigCenterPublicPatchApi>('configCenterPublicPatch')
    const settingsWorkspaceStateApi = getExposedApi<SettingsWorkspaceStateApi>('settingsWorkspaceState')
    const settingsWorkspaceSecretsApi = getExposedApi<SettingsWorkspaceSecretsApi>('settingsWorkspaceSecrets')
    const bootstrapWindowApi = getExposedApi<BootstrapWindowApi>('bootstrapWindow')

    await runtimeApi.load()
    await runtimeApi.retry()
    await snapshotApi.load()
    await patchApi.apply({
      domains: {
        assistantBehavior: {
          agentName: 'planner',
        },
      },
    })
    await settingsWorkspaceStateApi.load()
    await settingsWorkspaceStateApi.save({
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
    })
    await settingsWorkspaceSecretsApi.loadStatuses({ providerIds: ['openrouter'] })
    await settingsWorkspaceSecretsApi.loadSustechCasPassword()
    await settingsWorkspaceSecretsApi.saveProviderApiKey({ providerId: 'openrouter', apiKey: 'draft-secret' })
    await settingsWorkspaceSecretsApi.clearProviderApiKey({ providerId: 'openrouter' })
    await settingsWorkspaceSecretsApi.saveSustechCasPassword({ password: 'cas-secret' })
    await settingsWorkspaceSecretsApi.clearSustechCasPassword()
    await bootstrapWindowApi.signalBootstrapScreenReady()

    expect(preloadMocks.invoke.mock.calls).toEqual([
      [COPILOT_RUNTIME_LOAD_CHANNEL],
      [COPILOT_RUNTIME_RETRY_CHANNEL],
      [CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL],
      [CONFIG_CENTER_PUBLIC_PATCH_CHANNEL, {
        domains: {
          assistantBehavior: {
            agentName: 'planner',
          },
        },
      }],
      [SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL],
      [SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL, {
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
      }],
      [SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL, { providerIds: ['openrouter'] }],
      [SETTINGS_WORKSPACE_SECRETS_LOAD_SUSTECH_CAS_CHANNEL],
      [SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL, { providerId: 'openrouter', apiKey: 'draft-secret' }],
      [SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL, { providerId: 'openrouter' }],
      [SETTINGS_WORKSPACE_SECRETS_SAVE_SUSTECH_CAS_CHANNEL, { password: 'cas-secret' }],
      [SETTINGS_WORKSPACE_SECRETS_CLEAR_SUSTECH_CAS_CHANNEL],
      [BOOTSTRAP_WINDOW_READY_CHANNEL],
    ])

    const runtimeConsoleOnCall = preloadMocks.on.mock.calls.find(([channel]) => channel === MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL)
    expect(runtimeConsoleOnCall?.[1]).toBeTypeOf('function')

    const runtimeConsoleEntry: RuntimeConsoleEntry = {
      source: 'electron-main',
      level: 'debug',
      message: '[startup] app:ready',
      context: {
        sinceMainMs: 12,
      },
    }
    const runtimeConsoleWarningEntry: RuntimeConsoleEntry = {
      source: 'electron-main',
      level: 'warn',
      message: '[desktop-runtime] Ignoring invalid hosted runtime command-line arguments.',
    }

    const runtimeConsoleListener = runtimeConsoleOnCall?.[1] as ((event: unknown, payload: RuntimeConsoleEntry) => void) | undefined
    runtimeConsoleListener?.(undefined, runtimeConsoleEntry)
    runtimeConsoleListener?.(undefined, runtimeConsoleWarningEntry)

    expect(debugSpy).toHaveBeenCalledWith('[electron-main]', '[startup] app:ready', {
      sinceMainMs: 12,
    })
    expect(warnSpy).toHaveBeenCalledWith(
      '[electron-main]',
      '[desktop-runtime] Ignoring invalid hosted runtime command-line arguments.',
    )

    const listener = vi.fn()
    const stop = subscriptionApi.subscribe(listener)
    const snapshotOnCall = preloadMocks.on.mock.calls.find(([channel]) => channel === CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL)
    expect(snapshotOnCall?.[1]).toBeTypeOf('function')

    const snapshot: ConfigCenterPublicSnapshot = {
      version: 1,
      domains: {
        frontendPreferences: {
          theme: 'dark',
          animationsEnabled: true,
        },
        assistantBehavior: {
          agentName: 'planner',
        },
        hostConfig: {
          runtimeUrl: 'http://localhost:4400',
        },
        backendExposed: {
          model: 'qwen-plus',
        },
      },
    }

    const registeredListener = snapshotOnCall?.[1] as ((event: unknown, payload: ConfigCenterPublicSnapshot) => void) | undefined
    registeredListener?.(undefined, snapshot)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(snapshot)

    stop()
    expect(preloadMocks.off).toHaveBeenCalledOnce()
    expect(preloadMocks.off).toHaveBeenCalledWith(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL, snapshotOnCall?.[1])

    debugSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

function getExposedApi<TApi>(key: string): TApi {
  const exposedEntry = preloadMocks.exposeInMainWorld.mock.calls.find(([candidateKey]) => candidateKey === key)

  if (exposedEntry === undefined) {
    throw new Error(`Expected preload bridge to expose "${key}".`)
  }

  return exposedEntry[1] as TApi
}
