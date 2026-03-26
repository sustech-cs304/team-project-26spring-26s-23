import { describe, expect, it } from 'vitest'
import { createElectronUnifiedConfigService } from './main-process'

const preparedPaths = {
  configDir: '/mock/user-data/desktop-runtime/config',
  copilotSettingsFile: '/mock/user-data/desktop-runtime/config/copilot-settings.json',
  legacyCopilotSettingsFile: '/mock/user-data/copilot-settings.json',
} as const

describe('createElectronUnifiedConfigService', () => {
  it('loads a renderer-safe public snapshot from the unified config center', async () => {
    const service = createElectronUnifiedConfigService({
      prepareRuntimePaths: async () => preparedPaths,
    })

    const result = await service.loadPublicSnapshot()

    expect(result).toEqual({
      ok: true,
      snapshot: {
        version: 1,
        domains: {
          assistantBehavior: {
            agentName: null,
          },
          hostConfig: {
            runtimeUrl: null,
          },
        },
      },
    })
  })

  it('applies a public patch and returns the latest public snapshot', async () => {
    const service = createElectronUnifiedConfigService({
      prepareRuntimePaths: async () => preparedPaths,
    })

    const result = await service.applyPublicPatch({
      domains: {
        assistantBehavior: {
          agentName: '  planner  ',
        },
        hostConfig: {
          runtimeUrl: '  http://127.0.0.1:4400  ',
        },
      },
    })

    expect(result).toEqual({
      ok: true,
      snapshot: {
        version: 1,
        domains: {
          assistantBehavior: {
            agentName: 'planner',
          },
          hostConfig: {
            runtimeUrl: 'http://127.0.0.1:4400',
          },
        },
      },
    })
  })

  it('rejects invalid public patch payloads with a structured failure', async () => {
    const service = createElectronUnifiedConfigService({
      prepareRuntimePaths: async () => preparedPaths,
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
