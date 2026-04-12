import { describe, expect, it } from 'vitest'
import { createDefaultUnifiedConfigDomainDocument } from './defaults'
import { createUnifiedConfigDomainDocument, UNIFIED_CONFIG_DOMAIN_KEYS } from './domain-schema'
import {
  readStoredDomainDocument,
  withConfigCenterFixture,
  writeLegacyCopilotSettings,
  writeRawDomainDocuments,
} from './service.test-support'

describe('createUnifiedConfigCenter legacy migration', () => {
  it('migrates runtimeUrl and agentName from legacy CopilotSettings once', async () => {
    await withConfigCenterFixture(async (fixture) => {
      await writeLegacyCopilotSettings(fixture, {
        runtimeUrl: '  http://127.0.0.1:4310  ',
        agentName: '  planner  ',
      })

      const migrated = await fixture.configCenter.loadSnapshot()

      expect(migrated.source).toBe('migrated-legacy')
      expect(migrated.migratedFrom).toBe(fixture.hostedPaths.copilotSettingsFile)
      expect(migrated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl).toBe(
        'http://127.0.0.1:4310',
      )
      expect(
        migrated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName,
      ).toBe('planner')
      expect(
        migrated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.debugModeEnabled,
      ).toBe(false)
      expect(await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG)).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
          runtimeUrl: 'http://127.0.0.1:4310',
        }),
      )
      expect(
        await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR),
      ).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
          agentName: 'planner',
          debugModeEnabled: false,
        }),
      )

      await writeLegacyCopilotSettings(fixture, {
        runtimeUrl: 'http://ignored.example',
        agentName: 'ignored',
      })

      const reloaded = await fixture.configCenter.loadSnapshot()

      expect(reloaded.source).toBe('stored')
      expect(reloaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl).toBe(
        'http://127.0.0.1:4310',
      )
      expect(
        reloaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName,
      ).toBe('planner')
    })
  })

  it('only triggers legacy migration when the new config center is entirely absent', async () => {
    await withConfigCenterFixture(async (fixture) => {
      await writeLegacyCopilotSettings(fixture, {
        runtimeUrl: 'http://legacy.example',
        agentName: 'legacy-agent',
      })
      await writeRawDomainDocuments(fixture, {
        [UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]: createUnifiedConfigDomainDocument(
          UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
          {
            runtimeUrl: 'http://existing.example',
          },
        ),
      })

      const loaded = await fixture.configCenter.loadSnapshot()

      expect(loaded.source).toBe('stored')
      expect(loaded.migratedFrom).toBeNull()
      expect(loaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
          runtimeUrl: 'http://existing.example',
        }),
      )
      expect(loaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]).toEqual(
        createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR),
      )
      expect(
        await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR),
      ).toEqual(createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR))
    })
  })
})
