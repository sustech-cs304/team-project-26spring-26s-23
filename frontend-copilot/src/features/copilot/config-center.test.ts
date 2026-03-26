import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ConfigCenterPublicPatchApi,
  ConfigCenterPublicPatchResult,
} from '../../../electron/config-center/public-patch'
import type {
  ConfigCenterPublicSnapshotApi,
  ConfigCenterPublicSnapshotLoadResult,
} from '../../../electron/config-center/public-snapshot'
import {
  applyConfigCenterPublicPatch,
  loadConfigCenterPublicSnapshot,
  projectCopilotSettingsFromConfigCenterPublicSnapshot,
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

  it('delegates public patch writes to the injected preload api when available', async () => {
    const applyResult: ConfigCenterPublicPatchResult = {
      ok: true,
      snapshot: {
        version: 1,
        domains: {
          assistantBehavior: {
            agentName: 'planner',
          },
          hostConfig: {
            runtimeUrl: 'http://localhost:4400',
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
