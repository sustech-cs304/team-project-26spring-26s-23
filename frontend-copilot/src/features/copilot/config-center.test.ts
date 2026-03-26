import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ConfigCenterPublicSnapshotApi,
  ConfigCenterPublicSnapshotLoadResult,
} from '../../../electron/config-center/public-snapshot'
import {
  loadConfigCenterPublicSnapshot,
  projectCopilotSettingsFromConfigCenterPublicSnapshot,
} from './config-center'

const snapshotUnavailableError = 'window.configCenterPublicSnapshot is unavailable in the renderer process.'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('config center public snapshot bridge', () => {
  it('returns a structured failure when window is unavailable', async () => {
    vi.stubGlobal('window', undefined)

    await expect(loadConfigCenterPublicSnapshot()).resolves.toEqual({
      ok: false,
      error: snapshotUnavailableError,
    })
  })

  it('delegates to the injected preload api when available', async () => {
    const loadResult: ConfigCenterPublicSnapshotLoadResult = {
      ok: true,
      snapshot: {
        version: 1,
        domains: {
          assistantBehavior: {
            agentName: 'campus-agent',
          },
          hostConfig: {
            runtimeUrl: 'http://127.0.0.1:8765',
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

  it('projects copilot bootstrap settings from the public snapshot shape', () => {
    expect(projectCopilotSettingsFromConfigCenterPublicSnapshot({
      version: 1,
      domains: {
        assistantBehavior: {
          agentName: 'planner',
        },
        hostConfig: {
          runtimeUrl: 'http://localhost:4400',
        },
      },
    })).toEqual({
      runtimeUrl: 'http://localhost:4400',
      agentName: 'planner',
    })
  })
})
