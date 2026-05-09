import { beforeEach, vi } from 'vitest'

import type { ConfigCenterPublicSnapshot } from '../../config-center/public-snapshot'
import type { SettingsWorkspaceEditableState } from '../../settings-workspace/state-schema'

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
  resetPreloadBridgeMocks()
})

export async function loadPreloadModule(): Promise<void> {
  await import('../../preload')
}

export function resetPreloadBridgeMocks(): void {
  preloadMocks.exposeInMainWorld.mockReset()
  preloadMocks.invoke.mockReset()
  preloadMocks.on.mockReset()
  preloadMocks.off.mockReset()
}

export function getExposedBridgeKeys(): string[] {
  return preloadMocks.exposeInMainWorld.mock.calls.map(([key]) => key as string)
}

export function getExposedApi<TApi>(key: string): TApi {
  const exposedEntry = preloadMocks.exposeInMainWorld.mock.calls.find(([candidateKey]) => candidateKey === key)

  if (exposedEntry === undefined) {
    throw new Error(`Expected preload bridge to expose "${key}".`)
  }

  return exposedEntry[1] as TApi
}

export function getInvokeMock() {
  return preloadMocks.invoke
}

export function getOffMock() {
  return preloadMocks.off
}

export function getRegisteredOnListener<TListener extends (...args: any[]) => unknown>(channel: string): TListener {
  const onCall = preloadMocks.on.mock.calls.find(([candidateChannel]) => candidateChannel === channel)

  if (onCall === undefined || typeof onCall[1] !== 'function') {
    throw new Error(`Expected preload bridge to register a listener for channel "${channel}".`)
  }

  return onCall[1] as TListener
}

export function createConfigCenterPublicSnapshotFixture(): ConfigCenterPublicSnapshot {
  return {
    version: 1,
    domains: {
      frontendPreferences: {
        theme: 'dark',
        animationsEnabled: true,
      },
      assistantBehavior: {
        agentName: 'planner',
        debugModeEnabled: false,
      },
      hostConfig: {
        runtimeUrl: 'http://localhost:4400',
      },
      backendExposed: {
        model: 'qwen-plus',
      },
      general: {
        language: 'zh-CN',
      },
    },
  }
}

export function createSettingsWorkspaceStateFixture(): SettingsWorkspaceEditableState {
  return {
    sustech: {
      studentId: '',
      email: '',
      blackboardCurrentTermOnly: false,
      blackboardParallelSyncWorkers: '1',
      blackboardSyncInterval: 'off' as const,
      blackboardLastAutoSyncAt: null,
      blackboardNextAutoSyncAt: null,
    },
    providerProfiles: [],
    defaultModelRouting: {
      primaryAssistantModel: '',
      fastAssistantModel: '',
      primaryAssistantModelRoute: null,
      fastAssistantModelRoute: null,
    },
    general: {
      language: 'zh-CN',
      assistantNotificationsEnabled: false,
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
}
