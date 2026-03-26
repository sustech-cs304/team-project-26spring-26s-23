import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CONFIG_CENTER_PUBLIC_PATCH_CHANNEL, type ConfigCenterPublicPatchApi } from './config-center/public-patch'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL,
  type ConfigCenterPublicSnapshot,
  type ConfigCenterPublicSnapshotApi,
  type ConfigCenterPublicSnapshotSubscriptionApi,
} from './config-center/public-snapshot'
import { COPILOT_RUNTIME_LOAD_CHANNEL, COPILOT_RUNTIME_RETRY_CHANNEL, type CopilotRuntimeApi } from './copilot-runtime'

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
    ])
    expect(exposedKeys).not.toContain('copilotSettings')
  })

  it('routes exposed preload APIs through the expected runtime and config center channels', async () => {
    preloadMocks.invoke.mockResolvedValue(undefined)
    await import('./preload')

    const runtimeApi = getExposedApi<CopilotRuntimeApi>('copilotRuntime')
    const snapshotApi = getExposedApi<ConfigCenterPublicSnapshotApi>('configCenterPublicSnapshot')
    const subscriptionApi = getExposedApi<ConfigCenterPublicSnapshotSubscriptionApi>('configCenterPublicSnapshotSubscription')
    const patchApi = getExposedApi<ConfigCenterPublicPatchApi>('configCenterPublicPatch')

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
    ])

    const listener = vi.fn()
    const stop = subscriptionApi.subscribe(listener)
    const onCall = preloadMocks.on.mock.calls[0]
    expect(onCall?.[0]).toBe(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL)
    expect(onCall?.[1]).toBeTypeOf('function')

    const snapshot: ConfigCenterPublicSnapshot = {
      version: 1,
      domains: {
        frontendPreferences: {
          theme: 'dark',
        },
        assistantBehavior: {
          agentName: 'planner',
        },
        hostConfig: {
          runtimeUrl: 'http://localhost:4400',
        },
      },
    }

    const registeredListener = onCall?.[1] as ((event: unknown, payload: ConfigCenterPublicSnapshot) => void) | undefined
    registeredListener?.(undefined, snapshot)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(snapshot)

    stop()
    expect(preloadMocks.off).toHaveBeenCalledOnce()
    expect(preloadMocks.off).toHaveBeenCalledWith(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL, onCall?.[1])
  })
})

function getExposedApi<TApi>(key: string): TApi {
  const exposedEntry = preloadMocks.exposeInMainWorld.mock.calls.find(([candidateKey]) => candidateKey === key)

  if (exposedEntry === undefined) {
    throw new Error(`Expected preload bridge to expose "${key}".`)
  }

  return exposedEntry[1] as TApi
}
