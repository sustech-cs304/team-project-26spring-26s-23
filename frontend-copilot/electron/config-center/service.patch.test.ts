/* eslint-disable max-lines-per-function */
import { describe, expect, it } from 'vitest'

import { createDefaultUnifiedConfigSnapshot } from './defaults'
import {
  createUnifiedConfigDomainDocument,
  UNIFIED_CONFIG_DOMAIN_KEYS,
} from './domain-schema'
import {
  projectConfigCenterPublicSnapshot,
  type ConfigCenterPublicSnapshot,
} from './public-snapshot'
import {
  readStoredDomainDocument,
  withConfigCenterFixture,
  writeRawDomainDocuments,
} from './test-support/ConfigCenterTestSupport'

function createExpectedPublicSnapshot(debugModeEnabled = false): ConfigCenterPublicSnapshot {
  return {
    version: 1,
    domains: {
      frontendPreferences: {
        theme: 'dark',
        animationsEnabled: false,
      },
      assistantBehavior: {
        agentName: 'planner',
        debugModeEnabled,
      },
      hostConfig: {
        runtimeUrl: 'http://localhost:4400',
      },
      backendExposed: {
        model: 'qwen-plus',
      },
      general: {
        language: 'zh-CN',
      },
    },
  }
}

describe('createUnifiedConfigCenter patching', () => {
  it('normalizes stored values and field patches back to the stable schema shape', async () => {
    await withConfigCenterFixture(async (fixture) => {
      await writeRawDomainDocuments(fixture, {
        [UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES]: {
          version: 7,
          domain: UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
          values: {
            theme: 'system',
          },
        },
        [UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]: {
          version: 99,
          domain: 'legacy-assistant',
          values: {
            agentName: '   ',
          },
        },
        [UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]: {
          version: 0,
          domain: UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
          values: {
            runtimeUrl: '  http://localhost:9000  ',
          },
        },
      })

      const loaded = await fixture.configCenter.loadSnapshot()

      expect(loaded.source).toBe('stored')
      expect(loaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES, {
          theme: 'light',
          animationsEnabled: true,
        }),
      )
      expect(loaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
          agentName: null,
          debugModeEnabled: false,
        }),
      )
      expect(loaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
          runtimeUrl: 'http://localhost:9000',
        }),
      )

      const updated = await fixture.configCenter.applyFieldPatch({
        theme: 'dark',
        animationsEnabled: false,
        agentName: 42,
        runtimeUrl: '  http://localhost:9100  ',
      })

      expect(updated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES, {
          theme: 'dark',
          animationsEnabled: false,
        }),
      )
      expect(updated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
          agentName: null,
          debugModeEnabled: false,
        }),
      )
      expect(updated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
          runtimeUrl: 'http://localhost:9100',
        }),
      )
      expect(
        await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES),
      ).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES, {
          theme: 'dark',
          animationsEnabled: false,
        }),
      )
      expect(
        await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR),
      ).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
          agentName: null,
          debugModeEnabled: false,
        }),
      )
      expect(await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG)).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
          runtimeUrl: 'http://localhost:9100',
        }),
      )
    })
  })

  it('applies a public patch, persists the change, and returns the latest public snapshot', async () => {
    await withConfigCenterFixture(async (fixture) => {
      const result = await fixture.configCenter.applyPublicPatch({
        domains: {
          frontendPreferences: {
            theme: 'dark',
            animationsEnabled: false,
          },
          assistantBehavior: {
            agentName: '  planner  ',
            debugModeEnabled: true,
          },
          hostConfig: {
            runtimeUrl: '  http://localhost:4400  ',
          },
          backendExposed: {
            model: '  qwen-plus  ',
          },
        },
      })

      const expectedSnapshot = createExpectedPublicSnapshot(true)

      expect(result.snapshot).toEqual(expectedSnapshot)
      expect(
        await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES),
      ).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES, {
          theme: 'dark',
          animationsEnabled: false,
        }),
      )
      expect(
        await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR),
      ).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
          agentName: 'planner',
          debugModeEnabled: true,
        }),
      )
      expect(await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG)).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
          runtimeUrl: 'http://localhost:4400',
        }),
      )
      expect(
        await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED),
      ).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED, {
          model: 'qwen-plus',
        }),
      )

      const reloaded = await fixture.configCenter.loadSnapshot()
      expect(projectConfigCenterPublicSnapshot(reloaded.snapshot)).toEqual(expectedSnapshot)
    })
  })

  it('rejects invalid public patch fields before writing persisted changes', async () => {
    await withConfigCenterFixture(async (fixture) => {
      await expect(
        fixture.configCenter.applyPublicPatch({
          domains: {
            assistantBehavior: {
              theme: 'dark',
            } as never,
          },
        }),
      ).rejects.toThrow('Unknown public config field: "assistantBehavior.theme".')

      const loaded = await fixture.configCenter.loadSnapshot()
      expect(loaded.snapshot).toEqual(createDefaultUnifiedConfigSnapshot())
    })
  })

  it('projects a renderer-safe public snapshot with only stable public domains', async () => {
    await withConfigCenterFixture(async (fixture) => {
      const updated = await fixture.configCenter.applyFieldPatch({
        theme: 'dark',
        animationsEnabled: false,
        runtimeUrl: '  http://localhost:4400  ',
        agentName: '  planner  ',
        debugModeEnabled: false,
        model: '  qwen-plus  ',
      })

      const publicSnapshot = projectConfigCenterPublicSnapshot(updated.snapshot)
      const expectedSnapshot = createExpectedPublicSnapshot()

      expect(publicSnapshot).toEqual(expectedSnapshot)
      expect(JSON.parse(JSON.stringify(publicSnapshot))).toEqual(expectedSnapshot)
      expect('frontendPreferences' in publicSnapshot.domains).toBe(true)
      expect('backendExposed' in publicSnapshot.domains).toBe(true)
      expect(JSON.stringify(publicSnapshot)).not.toContain('providerSecrets')
      expect(JSON.stringify(publicSnapshot)).not.toContain('apiKey')
    })
  })
})
