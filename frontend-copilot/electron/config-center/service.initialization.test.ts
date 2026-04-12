import { describe, expect, it } from 'vitest'

import {
  createDefaultUnifiedConfigDomainDocument,
  createDefaultUnifiedConfigSnapshot,
} from './defaults'
import {
  createUnifiedConfigDomainDocument,
  UNIFIED_CONFIG_DOMAIN_KEYS,
  UNIFIED_CONFIG_DOMAIN_LIST,
} from './domain-schema'
import {
  readStoredDomainDocument,
  withConfigCenterFixture,
  writeRawDomainDocuments,
} from './test-support/ConfigCenterTestSupport'

describe('createUnifiedConfigCenter initialization', () => {
  it('initializes versioned domain documents with defaults when storage is empty', async () => {
    await withConfigCenterFixture(async (fixture) => {
      const loadResult = await fixture.configCenter.loadSnapshot()

      expect(loadResult.source).toBe('initialized-defaults')
      expect(loadResult.migratedFrom).toBeNull()
      expect(loadResult.snapshot).toEqual(createDefaultUnifiedConfigSnapshot())

      for (const domain of UNIFIED_CONFIG_DOMAIN_LIST) {
        expect(await readStoredDomainDocument(fixture, domain)).toEqual(
          createDefaultUnifiedConfigDomainDocument(domain),
        )
      }
    })
  })

  it('backfills missing domain documents with defaults without switching to legacy migration', async () => {
    await withConfigCenterFixture(async (fixture) => {
      await writeRawDomainDocuments(fixture, {
        [UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES]: createUnifiedConfigDomainDocument(
          UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
          {
            theme: 'dark',
            animationsEnabled: false,
          },
        ),
        [UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]: createUnifiedConfigDomainDocument(
          UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
          {
            agentName: 'planner',
            debugModeEnabled: false,
          },
        ),
      })

      const loaded = await fixture.configCenter.loadSnapshot()

      expect(loaded.source).toBe('stored')
      expect(loaded.migratedFrom).toBeNull()
      expect(loaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES, {
          theme: 'dark',
          animationsEnabled: false,
        }),
      )
      expect(loaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
          agentName: 'planner',
          debugModeEnabled: false,
        }),
      )
      expect(loaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]).toEqual(
        createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG),
      )
      expect(loaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED]).toEqual(
        createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED),
      )
      expect(await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG)).toEqual(
        createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG),
      )
      expect(
        await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED),
      ).toEqual(createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED))
    })
  })
})
