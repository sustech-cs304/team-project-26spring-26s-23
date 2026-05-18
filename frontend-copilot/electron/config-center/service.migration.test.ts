/* eslint-disable max-lines-per-function */
import { describe, expect, it } from 'vitest'

import { createConfigCenterBootstrapService } from './bootstrap/ConfigCenterBootstrapService'
import {
  createDefaultUnifiedConfigDomainDocument,
  createDefaultUnifiedConfigSnapshot,
} from './defaults'
import { createUnifiedConfigDomainDocument, UNIFIED_CONFIG_DOMAIN_KEYS } from './domain-schema'
import type { ConfigCenterStore } from './persistence/ConfigCenterStore'
import {
  readStoredDomainDocument,
  withConfigCenterFixture,
  writeLegacyCopilotSettings,
  writeRawDomainDocuments,
} from './test-support/ConfigCenterTestSupport'

const LEGACY_RUNTIME_URL = 'http://127.0.0.1:4310'
const LEGACY_AGENT_NAME = 'planner'

describe('createUnifiedConfigCenter legacy migration', () => {
  it('migrates runtimeUrl and agentName from legacy CopilotSettings once', async () => {
    await withConfigCenterFixture(async (fixture) => {
      await writeLegacyCopilotSettings(fixture, {
        runtimeUrl: `  ${LEGACY_RUNTIME_URL}  `,
        agentName: `  ${LEGACY_AGENT_NAME}  `,
      })

      const migrated = await fixture.configCenter.loadSnapshot()

      expect(migrated.source).toBe('migrated-legacy')
      expect(migrated.migratedFrom).toBe(fixture.hostedPaths.copilotSettingsFile)
      expect(migrated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl).toBe(
        LEGACY_RUNTIME_URL,
      )
      expect(
        migrated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName,
      ).toBe(LEGACY_AGENT_NAME)
      expect(
        migrated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.debugModeEnabled,
      ).toBe(false)
      expect(await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG)).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
          runtimeUrl: LEGACY_RUNTIME_URL,
        }),
      )
      expect(
        await readStoredDomainDocument(fixture, UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR),
      ).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
          agentName: LEGACY_AGENT_NAME,
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
        LEGACY_RUNTIME_URL,
      )
      expect(
        reloaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName,
      ).toBe(LEGACY_AGENT_NAME)
    })
  })

  it('uses the injected store readFile implementation for legacy migration', async () => {
    await withConfigCenterFixture(async (fixture) => {
      const storedSnapshots: ReturnType<typeof createDefaultUnifiedConfigSnapshot>[] = []
      const store: ConfigCenterStore = {
        async loadStoredSnapshot() {
          return {
            snapshot: createDefaultUnifiedConfigSnapshot(),
            allMissing: true,
            dirty: false,
          }
        },
        async writeSnapshot(snapshot) {
          storedSnapshots.push(snapshot)
        },
        async readFile(filePath, encoding) {
          expect(encoding).toBe('utf8')
          if (filePath === fixture.hostedPaths.copilotSettingsFile) {
            return JSON.stringify({
              runtimeUrl: '  http://memory.example  ',
              agentName: '  memory-agent  ',
            })
          }

          const error = Object.assign(new Error(`ENOENT: no such file or directory, open '${filePath}'`), {
            code: 'ENOENT',
          }) as NodeJS.ErrnoException
          throw error
        },
      }

      const bootstrapService = createConfigCenterBootstrapService({
        paths: fixture.configCenterPaths,
        store,
      })
      const migrated = await bootstrapService.loadSnapshot()

      expect(migrated.source).toBe('migrated-legacy')
      expect(migrated.migratedFrom).toBe(fixture.hostedPaths.copilotSettingsFile)
      expect(migrated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl).toBe(
        'http://memory.example',
      )
      expect(
        migrated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName,
      ).toBe('memory-agent')
      expect(storedSnapshots).toHaveLength(1)
      expect(storedSnapshots[0]).toEqual(migrated.snapshot)
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
