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
})
