import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConfigCenterPublicPatchResult } from '../../electron/config-center/public-patch'
import type {
  ConfigCenterPublicSnapshot,
  ConfigCenterPublicSnapshotListener,
} from '../../electron/config-center/public-snapshot'

const configCenterMocks = vi.hoisted(() => ({
  applyConfigCenterPublicPatch: vi.fn(),
  loadConfigCenterPublicSnapshot: vi.fn(),
  projectThemeModeFromConfigCenterPublicSnapshot: vi.fn(),
  subscribeToConfigCenterPublicSnapshotUpdates: vi.fn(),
}))

vi.mock('../features/copilot/config-center', () => ({
  applyConfigCenterPublicPatch: configCenterMocks.applyConfigCenterPublicPatch,
  loadConfigCenterPublicSnapshot: configCenterMocks.loadConfigCenterPublicSnapshot,
  projectThemeModeFromConfigCenterPublicSnapshot: configCenterMocks.projectThemeModeFromConfigCenterPublicSnapshot,
  subscribeToConfigCenterPublicSnapshotUpdates: configCenterMocks.subscribeToConfigCenterPublicSnapshotUpdates,
}))

import {
  loadThemeModePreference,
  persistThemeModePreference,
  subscribeToThemeModePreferenceUpdates,
} from './theme-config'
import type { ThemeMode } from './types'

beforeEach(() => {
  configCenterMocks.applyConfigCenterPublicPatch.mockReset()
  configCenterMocks.loadConfigCenterPublicSnapshot.mockReset()
  configCenterMocks.projectThemeModeFromConfigCenterPublicSnapshot.mockReset()
  configCenterMocks.subscribeToConfigCenterPublicSnapshotUpdates.mockReset()
})

describe('theme-config', () => {
  it('loads theme mode from the config center public snapshot bridge', async () => {
    const snapshot = createPublicSnapshot('dark')
    configCenterMocks.loadConfigCenterPublicSnapshot.mockResolvedValueOnce({
      ok: true,
      snapshot,
    })
    configCenterMocks.projectThemeModeFromConfigCenterPublicSnapshot.mockReturnValueOnce('dark')

    await expect(loadThemeModePreference()).resolves.toEqual({
      ok: true,
      themeMode: 'dark',
    })

    expect(configCenterMocks.projectThemeModeFromConfigCenterPublicSnapshot).toHaveBeenCalledOnce()
    expect(configCenterMocks.projectThemeModeFromConfigCenterPublicSnapshot).toHaveBeenCalledWith(snapshot)
  })

  it('surfaces config center snapshot load failures without changing theme state', async () => {
    configCenterMocks.loadConfigCenterPublicSnapshot.mockResolvedValueOnce({
      ok: false,
      error: 'snapshot unavailable',
    })

    await expect(loadThemeModePreference()).resolves.toEqual({
      ok: false,
      error: 'snapshot unavailable',
    })

    expect(configCenterMocks.projectThemeModeFromConfigCenterPublicSnapshot).not.toHaveBeenCalled()
  })

  it('applies theme changes immediately and persists them through the config center patch bridge', async () => {
    let resolvePatchResult: ((value: ConfigCenterPublicPatchResult) => void) | undefined
    configCenterMocks.applyConfigCenterPublicPatch.mockReturnValueOnce(new Promise((resolve) => {
      resolvePatchResult = resolve
    }))
    configCenterMocks.projectThemeModeFromConfigCenterPublicSnapshot.mockReturnValueOnce('dark')
    const applyThemeMode = vi.fn()

    const resultPromise = persistThemeModePreference({
      previousThemeMode: 'light',
      themeMode: 'dark',
      applyThemeMode,
    })

    expect(applyThemeMode).toHaveBeenCalledTimes(1)
    expect(applyThemeMode).toHaveBeenNthCalledWith(1, 'dark')
    expect(configCenterMocks.applyConfigCenterPublicPatch).toHaveBeenCalledOnce()
    expect(configCenterMocks.applyConfigCenterPublicPatch).toHaveBeenCalledWith({
      domains: {
        frontendPreferences: {
          theme: 'dark',
        },
      },
    })

    resolvePatchResult?.({
      ok: true,
      snapshot: createPublicSnapshot('dark'),
    })

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      themeMode: 'dark',
    })
    expect(applyThemeMode).toHaveBeenCalledTimes(2)
    expect(applyThemeMode).toHaveBeenNthCalledWith(2, 'dark')
  })

  it('reverts the optimistic theme change when persistence fails', async () => {
    configCenterMocks.applyConfigCenterPublicPatch.mockResolvedValueOnce({
      ok: false,
      error: 'save failed',
    })
    const applyThemeMode = vi.fn()

    await expect(persistThemeModePreference({
      previousThemeMode: 'light',
      themeMode: 'dark',
      applyThemeMode,
    })).resolves.toEqual({
      ok: false,
      error: 'save failed',
      revertedThemeMode: 'light',
    })

    expect(applyThemeMode).toHaveBeenCalledTimes(2)
    expect(applyThemeMode).toHaveBeenNthCalledWith(1, 'dark')
    expect(applyThemeMode).toHaveBeenNthCalledWith(2, 'light')
    expect(configCenterMocks.projectThemeModeFromConfigCenterPublicSnapshot).not.toHaveBeenCalled()
  })

  it('maps public snapshot subscription updates into theme mode notifications', () => {
    let snapshotListener: ConfigCenterPublicSnapshotListener | undefined
    const unsubscribe = vi.fn()
    configCenterMocks.subscribeToConfigCenterPublicSnapshotUpdates.mockImplementation((listener) => {
      snapshotListener = listener
      return unsubscribe
    })
    configCenterMocks.projectThemeModeFromConfigCenterPublicSnapshot.mockImplementation((snapshot) => (
      snapshot.domains.frontendPreferences.theme
    ))
    const listener = vi.fn()

    const stop = subscribeToThemeModePreferenceUpdates(listener)
    snapshotListener?.(createPublicSnapshot('dark'))

    expect(configCenterMocks.subscribeToConfigCenterPublicSnapshotUpdates).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith('dark')

    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

function createPublicSnapshot(theme: ThemeMode): ConfigCenterPublicSnapshot {
  return {
    version: 1,
    domains: {
      frontendPreferences: {
        theme,
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
      general: {
        language: 'zh-CN',
      },
    },
  }
}
