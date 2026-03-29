import { describe, expect, it, vi } from 'vitest'

import { CONFIG_CENTER_PUBLIC_PATCH_CHANNEL, type ConfigCenterPublicPatchApi } from './config-center/public-patch'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL,
  type ConfigCenterPublicSnapshot,
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
      (event: unknown, payload: ConfigCenterPublicSnapshot) => void
    >(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL)
    const snapshot = createConfigCenterPublicSnapshotFixture()

    registeredListener(undefined, snapshot)

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(snapshot)

    stop()

    expect(getOffMock()).toHaveBeenCalledOnce()
    expect(getOffMock()).toHaveBeenCalledWith(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL, registeredListener)
  })
})
