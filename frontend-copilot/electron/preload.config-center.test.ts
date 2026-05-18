import { describe, expect, it, vi } from 'vitest'

import { CONFIG_CENTER_PUBLIC_PATCH_CHANNEL, type ConfigCenterPublicPatchApi } from './config-center/public-patch'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL,
  type ConfigCenterPublicSnapshotApi,
  type ConfigCenterPublicSnapshotSubscriptionApi,
} from './config-center/public-snapshot'
import {
  createConfigCenterPublicSnapshotFixture,
  getExposedApi,
  getInvokeMock,
  getOffMock,
  getRegisteredOnListener,
  loadPreloadModule,
} from './preload.test-support'

describe('preload config center bridge', () => {
  it('routes public config center load and patch APIs through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const snapshotApi = getExposedApi<ConfigCenterPublicSnapshotApi>('configCenterPublicSnapshot')
    const patchApi = getExposedApi<ConfigCenterPublicPatchApi>('configCenterPublicPatch')
    const patch = {
      domains: {
        assistantBehavior: {
          agentName: 'planner',
          debugModeEnabled: true,
        },
      },
    }

    await snapshotApi.load()
    await patchApi.apply(patch)

    expect(invokeMock.mock.calls).toEqual([
      [CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL],
      [CONFIG_CENTER_PUBLIC_PATCH_CHANNEL, patch],
    ])
  })

  it('routes public config center subscriptions through the snapshot update channel', async () => {
    await loadPreloadModule()

    const subscriptionApi = getExposedApi<ConfigCenterPublicSnapshotSubscriptionApi>('configCenterPublicSnapshotSubscription')
    const listener = vi.fn()

    const stop = subscriptionApi.subscribe(listener)
    const registeredListener = getRegisteredOnListener<
      (...args: unknown[]) => void
    >(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL)
    const snapshot = createConfigCenterPublicSnapshotFixture()

    registeredListener(undefined, snapshot)

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(snapshot)

    stop()

    expect(getOffMock()).toHaveBeenCalledOnce()
    expect(getOffMock()).toHaveBeenCalledWith(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL, registeredListener)
  })

  it('ignores invalid public snapshot payloads before they reach renderer listeners', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await loadPreloadModule()

    try {
      const subscriptionApi = getExposedApi<ConfigCenterPublicSnapshotSubscriptionApi>('configCenterPublicSnapshotSubscription')
      const listener = vi.fn()
      const invalidPayload = {
        version: 1,
        domains: {
          frontendPreferences: {
            theme: 'dark',
            animationsEnabled: 'nope',
          },
        },
      }

      subscriptionApi.subscribe(listener)
      const registeredListener = getRegisteredOnListener<
        (event: unknown, payload: unknown) => void
      >(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL)

      registeredListener(undefined, invalidPayload)

      expect(listener).not.toHaveBeenCalled()
      expect(consoleError).toHaveBeenCalledOnce()
      expect(consoleError.mock.calls[0]?.[0]).toContain('Ignored invalid public snapshot payload')
      expect(consoleError.mock.calls[0]?.[1]).toBe(invalidPayload)
    } finally {
      consoleError.mockRestore()
    }
  })
})
