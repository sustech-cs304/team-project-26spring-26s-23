import { afterEach, describe, expect, it, vi } from 'vitest'

import { createConfigCenterPublicSnapshotSubscriptionApi } from '../../../electron/config-center/public-snapshot-subscription'
import type {
  ConfigCenterPublicPatchApi,
  ConfigCenterPublicPatchResult,
} from '../../../electron/config-center/public-patch'
import type {
  ConfigCenterPublicSnapshotApi,
  ConfigCenterPublicSnapshotLoadResult,
  ConfigCenterPublicSnapshotSubscriptionApi,
} from '../../../electron/config-center/public-snapshot'
import {
  applyConfigCenterPublicPatch,
  loadConfigCenterPublicSnapshot,
  projectAnimationsEnabledFromConfigCenterPublicSnapshot,
  projectThemeModeFromConfigCenterPublicSnapshot,
  subscribeToConfigCenterPublicSnapshotUpdates,
} from './config-center'

const snapshotUnavailableError = 'window.configCenterPublicSnapshot is unavailable in the renderer process.'
const patchUnavailableError = 'window.configCenterPublicPatch is unavailable in the renderer process.'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('config center public bridge', () => {
  it('returns a structured failure when the public snapshot api is unavailable', async () => {
    vi.stubGlobal('window', undefined)

    await expect(loadConfigCenterPublicSnapshot()).resolves.toEqual({
      ok: false,
      error: snapshotUnavailableError,
    })
  })

  it('returns a structured failure when the public patch api is unavailable', async () => {
    vi.stubGlobal('window', undefined)

    await expect(applyConfigCenterPublicPatch({
      domains: {
        assistantBehavior: {
          agentName: 'planner',
        },
      },
    })).resolves.toEqual({
      ok: false,
      error: patchUnavailableError,
    })
  })

  it('delegates to the injected preload api when available', async () => {
    const loadResult: ConfigCenterPublicSnapshotLoadResult = {
      ok: true,
      snapshot: {
        version: 1,
        domains: {
          frontendPreferences: {
            theme: 'dark',
            animationsEnabled: true,
          },
          assistantBehavior: {
            agentName: 'campus-agent',
          },
          hostConfig: {
            runtimeUrl: 'http://127.0.0.1:8765',
          },
          backendExposed: {
            model: null,
          },
        },
      },
    }
    const api: ConfigCenterPublicSnapshotApi = {
      load: vi.fn().mockResolvedValue(loadResult),
    }

    vi.stubGlobal('window', {
      configCenterPublicSnapshot: api,
    } satisfies Pick<Window, 'configCenterPublicSnapshot'>)

    await expect(loadConfigCenterPublicSnapshot()).resolves.toEqual(loadResult)
    expect(api.load).toHaveBeenCalledOnce()
  })

  it('delegates public patch writes to the injected preload api when available', async () => {
    const applyResult: ConfigCenterPublicPatchResult = {
      ok: true,
      snapshot: {
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
            model: null,
          },
        },
      },
    }
    const api: ConfigCenterPublicPatchApi = {
      apply: vi.fn().mockResolvedValue(applyResult),
    }

    vi.stubGlobal('window', {
      configCenterPublicPatch: api,
    } satisfies Pick<Window, 'configCenterPublicPatch'>)

    const patch = {
      domains: {
        hostConfig: {
          runtimeUrl: 'http://localhost:4400',
        },
      },
    }

    await expect(applyConfigCenterPublicPatch(patch)).resolves.toEqual(applyResult)
    expect(api.apply).toHaveBeenCalledOnce()
    expect(api.apply).toHaveBeenCalledWith(patch)
  })

  it('subscribes and unsubscribes through the injected preload api when available', () => {
    const unsubscribe = vi.fn()
    const subscribe = vi.fn().mockReturnValue(unsubscribe)
    const api: ConfigCenterPublicSnapshotSubscriptionApi = {
      subscribe,
    }
    const listener = vi.fn()

    vi.stubGlobal('window', {
      configCenterPublicSnapshotSubscription: api,
    } satisfies Pick<Window, 'configCenterPublicSnapshotSubscription'>)

    const stop = subscribeToConfigCenterPublicSnapshotUpdates(listener)

    expect(subscribe).toHaveBeenCalledOnce()
    expect(subscribe).toHaveBeenCalledWith(listener)

    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('returns a noop unsubscribe when the subscription api is unavailable', () => {
    vi.stubGlobal('window', undefined)

    expect(() => subscribeToConfigCenterPublicSnapshotUpdates(vi.fn())()).not.toThrow()
  })

  it('creates a preload subscription adapter with removable listeners', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const eventSource = {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
      }),
      off: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        if (listeners.get(channel) === listener) {
          listeners.delete(channel)
        }
      }),
    }
    const api = createConfigCenterPublicSnapshotSubscriptionApi(eventSource)
    const listener = vi.fn()

    const stop = api.subscribe(listener)
    const registeredListener = listeners.get('config-center:public-snapshot-updated')
    expect(eventSource.on).toHaveBeenCalledOnce()
    expect(registeredListener).toBeTypeOf('function')

    registeredListener?.(undefined, {
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
          model: null,
        },
      },
    })

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({
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
          model: null,
        },
      },
    })

    stop()
    expect(eventSource.off).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(0)
  })

  it('projects theme mode from the public snapshot shape', () => {
    expect(projectThemeModeFromConfigCenterPublicSnapshot({
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
          model: null,
        },
      },
    })).toBe('dark')
  })

  it('projects animations preference from the public snapshot shape', () => {
    expect(projectAnimationsEnabledFromConfigCenterPublicSnapshot({
      version: 1,
      domains: {
        frontendPreferences: {
          theme: 'dark',
          animationsEnabled: false,
        },
        assistantBehavior: {
          agentName: 'planner',
        },
        hostConfig: {
          runtimeUrl: 'http://localhost:4400',
        },
        backendExposed: {
          model: null,
        },
      },
    })).toBe(false)
  })

})
