import { describe, expect, it, vi } from 'vitest'
import { createElectronUnifiedConfigService } from './main-process'

function createPreparedPaths(testName: string) {
  return {
    configDir: `/mock/user-data/${testName}/desktop-runtime/config`,
    copilotSettingsFile: `/mock/user-data/${testName}/desktop-runtime/config/copilot-settings.json`,
    legacyCopilotSettingsFile: `/mock/user-data/${testName}/copilot-settings.json`,
  } as const
}

describe('createElectronUnifiedConfigService', () => {
  it('loads a renderer-safe public snapshot from the unified config center', async () => {
    const service = createElectronUnifiedConfigService({
      prepareRuntimePaths: async () => createPreparedPaths('load-public-snapshot'),
    })

    const result = await service.loadPublicSnapshot()

    expect(result).toEqual({
      ok: true,
      snapshot: {
        version: 1,
        domains: {
          frontendPreferences: {
            theme: 'light',
          },
          assistantBehavior: {
            agentName: null,
          },
          hostConfig: {
            runtimeUrl: null,
          },
          backendExposed: {
            model: null,
          },
        },
      },
    })
  })

  it('applies a public patch and returns the latest public snapshot', async () => {
    const service = createElectronUnifiedConfigService({
      prepareRuntimePaths: async () => createPreparedPaths('apply-public-patch'),
    })

    const result = await service.applyPublicPatch({
      domains: {
        frontendPreferences: {
          theme: 'dark',
        },
        assistantBehavior: {
          agentName: '  planner  ',
        },
        hostConfig: {
          runtimeUrl: '  http://127.0.0.1:4400  ',
        },
        backendExposed: {
          model: '  qwen-plus  ',
        },
      },
    })

    expect(result).toEqual({
      ok: true,
      snapshot: {
        version: 1,
        domains: {
          frontendPreferences: {
            theme: 'dark',
          },
          assistantBehavior: {
            agentName: 'planner',
          },
          hostConfig: {
            runtimeUrl: 'http://127.0.0.1:4400',
          },
          backendExposed: {
            model: 'qwen-plus',
          },
        },
      },
    })
  })

  it('publishes a public snapshot update after a public patch succeeds', async () => {
    const publishPublicSnapshotUpdate = vi.fn()
    const service = createElectronUnifiedConfigService({
      prepareRuntimePaths: async () => createPreparedPaths('publish-public-snapshot-update'),
      publishPublicSnapshotUpdate,
    })

    const result = await service.applyPublicPatch({
      domains: {
        frontendPreferences: {
          theme: 'dark',
        },
        assistantBehavior: {
          agentName: '  planner  ',
        },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('Expected public patch application to succeed.')
    }

    expect(publishPublicSnapshotUpdate).toHaveBeenCalledOnce()
    expect(publishPublicSnapshotUpdate).toHaveBeenCalledWith(result.snapshot)
  })

  it('rejects invalid public patch payloads with a structured failure', async () => {
    const service = createElectronUnifiedConfigService({
      prepareRuntimePaths: async () => createPreparedPaths('reject-invalid-public-patch'),
    })

    const result = await service.applyPublicPatch({
      domains: {
        assistantBehavior: {
          agentName: 42 as never,
        },
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected public patch application to fail.')
    }

    expect(result.error).toContain('Failed to apply config center public patch:')
    expect(result.error).toContain('assistantBehavior.agentName')
  })
})
