import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConfigCenterPublicPatchResult } from '../../electron/config-center/public-patch'
import type {
  ConfigCenterPublicSnapshot,
  ConfigCenterPublicSnapshotListener,
} from '../../electron/config-center/public-snapshot'

const configCenterMocks = vi.hoisted(() => ({
  applyConfigCenterPublicPatch: vi.fn(),
  loadConfigCenterPublicSnapshot: vi.fn(),
  projectAnimationsEnabledFromConfigCenterPublicSnapshot: vi.fn(),
  subscribeToConfigCenterPublicSnapshotUpdates: vi.fn(),
}))

vi.mock('../features/copilot/config-center', () => ({
  applyConfigCenterPublicPatch: configCenterMocks.applyConfigCenterPublicPatch,
  loadConfigCenterPublicSnapshot: configCenterMocks.loadConfigCenterPublicSnapshot,
  projectAnimationsEnabledFromConfigCenterPublicSnapshot:
    configCenterMocks.projectAnimationsEnabledFromConfigCenterPublicSnapshot,
  subscribeToConfigCenterPublicSnapshotUpdates: configCenterMocks.subscribeToConfigCenterPublicSnapshotUpdates,
}))

import {
  loadAnimationsEnabledPreference,
  persistAnimationsEnabledPreference,
  subscribeToAnimationsEnabledPreferenceUpdates,
} from './animation-config'

beforeEach(() => {
  configCenterMocks.applyConfigCenterPublicPatch.mockReset()
  configCenterMocks.loadConfigCenterPublicSnapshot.mockReset()
  configCenterMocks.projectAnimationsEnabledFromConfigCenterPublicSnapshot.mockReset()
  configCenterMocks.subscribeToConfigCenterPublicSnapshotUpdates.mockReset()
})

describe('animation-config', () => {
  it('loads animations preference from the config center public snapshot bridge', async () => {
    const snapshot = createPublicSnapshot(false)
    configCenterMocks.loadConfigCenterPublicSnapshot.mockResolvedValueOnce({
      ok: true,
      snapshot,
    })
    configCenterMocks.projectAnimationsEnabledFromConfigCenterPublicSnapshot.mockReturnValueOnce(false)

    await expect(loadAnimationsEnabledPreference()).resolves.toEqual({
      ok: true,
      animationsEnabled: false,
    })

    expect(configCenterMocks.projectAnimationsEnabledFromConfigCenterPublicSnapshot).toHaveBeenCalledOnce()
    expect(configCenterMocks.projectAnimationsEnabledFromConfigCenterPublicSnapshot).toHaveBeenCalledWith(snapshot)
  })

  it('surfaces config center snapshot load failures without changing animations state', async () => {
    configCenterMocks.loadConfigCenterPublicSnapshot.mockResolvedValueOnce({
      ok: false,
      error: 'snapshot unavailable',
    })

    await expect(loadAnimationsEnabledPreference()).resolves.toEqual({
      ok: false,
      error: 'snapshot unavailable',
    })

    expect(configCenterMocks.projectAnimationsEnabledFromConfigCenterPublicSnapshot).not.toHaveBeenCalled()
  })

  it('applies animation preference changes immediately and persists them through the config center patch bridge', async () => {
    let resolvePatchResult: ((value: ConfigCenterPublicPatchResult) => void) | undefined
    configCenterMocks.applyConfigCenterPublicPatch.mockReturnValueOnce(new Promise((resolve) => {
      resolvePatchResult = resolve
    }))
    configCenterMocks.projectAnimationsEnabledFromConfigCenterPublicSnapshot.mockReturnValueOnce(false)
    const applyAnimationsEnabled = vi.fn()

    const resultPromise = persistAnimationsEnabledPreference({
      previousAnimationsEnabled: true,
      animationsEnabled: false,
      applyAnimationsEnabled,
    })

    expect(applyAnimationsEnabled).toHaveBeenCalledTimes(1)
    expect(applyAnimationsEnabled).toHaveBeenNthCalledWith(1, false)
    expect(configCenterMocks.applyConfigCenterPublicPatch).toHaveBeenCalledOnce()
    expect(configCenterMocks.applyConfigCenterPublicPatch).toHaveBeenCalledWith({
      domains: {
        frontendPreferences: {
          animationsEnabled: false,
        },
      },
    })

    resolvePatchResult?.({
      ok: true,
      snapshot: createPublicSnapshot(false),
    })

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      animationsEnabled: false,
    })
    expect(applyAnimationsEnabled).toHaveBeenCalledTimes(2)
    expect(applyAnimationsEnabled).toHaveBeenNthCalledWith(2, false)
  })

  it('reverts the optimistic animation preference change when persistence fails', async () => {
    configCenterMocks.applyConfigCenterPublicPatch.mockResolvedValueOnce({
      ok: false,
      error: 'save failed',
    })
    const applyAnimationsEnabled = vi.fn()

    await expect(persistAnimationsEnabledPreference({
      previousAnimationsEnabled: true,
      animationsEnabled: false,
      applyAnimationsEnabled,
    })).resolves.toEqual({
      ok: false,
      error: 'save failed',
      revertedAnimationsEnabled: true,
    })

    expect(applyAnimationsEnabled).toHaveBeenCalledTimes(2)
    expect(applyAnimationsEnabled).toHaveBeenNthCalledWith(1, false)
    expect(applyAnimationsEnabled).toHaveBeenNthCalledWith(2, true)
    expect(configCenterMocks.projectAnimationsEnabledFromConfigCenterPublicSnapshot).not.toHaveBeenCalled()
  })

  it('maps public snapshot subscription updates into animation preference notifications', () => {
    let snapshotListener: ConfigCenterPublicSnapshotListener | undefined
    const unsubscribe = vi.fn()
    configCenterMocks.subscribeToConfigCenterPublicSnapshotUpdates.mockImplementation((listener) => {
      snapshotListener = listener
      return unsubscribe
    })
    configCenterMocks.projectAnimationsEnabledFromConfigCenterPublicSnapshot.mockImplementation((snapshot) => (
      snapshot.domains.frontendPreferences.animationsEnabled
    ))
    const listener = vi.fn()

    const stop = subscribeToAnimationsEnabledPreferenceUpdates(listener)
    snapshotListener?.(createPublicSnapshot(false))

    expect(configCenterMocks.subscribeToConfigCenterPublicSnapshotUpdates).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(false)

    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

function createPublicSnapshot(animationsEnabled: boolean): ConfigCenterPublicSnapshot {
  return {
    version: 1,
    domains: {
      frontendPreferences: {
        theme: 'light',
        animationsEnabled,
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
  }
}
