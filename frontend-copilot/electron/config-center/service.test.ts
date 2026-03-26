import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createUnifiedConfigCenterPaths } from './paths'
import { createUnifiedConfigCenter } from './service'
import {
  UNIFIED_CONFIG_DOMAIN_KEYS,
  createDefaultUnifiedConfigDomainDocument,
  createDefaultUnifiedConfigSnapshot,
  createUnifiedConfigDomainDocument,
} from './schema'

interface ConfigCenterFixture {
  tempRoot: string
  hostedPaths: ReturnType<typeof createHostedRuntimePaths>
  configCenterPaths: ReturnType<typeof createUnifiedConfigCenterPaths>
  configCenter: ReturnType<typeof createUnifiedConfigCenter>
}

async function createConfigCenterFixture(): Promise<ConfigCenterFixture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-config-center-'))
  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)
  const configCenterPaths = createUnifiedConfigCenterPaths(hostedPaths)

  return {
    tempRoot,
    hostedPaths,
    configCenterPaths,
    configCenter: createUnifiedConfigCenter({ paths: configCenterPaths }),
  }
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown
}

describe('createUnifiedConfigCenter', () => {
  it('initializes versioned domain documents with defaults when storage is empty', async () => {
    const fixture = await createConfigCenterFixture()

    try {
      const loadResult = await fixture.configCenter.loadSnapshot()

      expect(loadResult.source).toBe('initialized-defaults')
      expect(loadResult.migratedFrom).toBeNull()
      expect(loadResult.snapshot).toEqual(createDefaultUnifiedConfigSnapshot())
      expect(
        await readJsonFile(
          fixture.configCenterPaths.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES],
        ),
      ).toEqual(createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES))
      expect(
        await readJsonFile(
          fixture.configCenterPaths.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR],
        ),
      ).toEqual(createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR))
      expect(
        await readJsonFile(
          fixture.configCenterPaths.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG],
        ),
      ).toEqual(createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG))
      expect(
        await readJsonFile(
          fixture.configCenterPaths.documents[UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED],
        ),
      ).toEqual(createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED))
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('migrates runtimeUrl and agentName from legacy CopilotSettings once', async () => {
    const fixture = await createConfigCenterFixture()

    try {
      await writeFile(
        fixture.hostedPaths.copilotSettingsFile,
        `${JSON.stringify({
          runtimeUrl: '  http://127.0.0.1:4310  ',
          agentName: '  planner  ',
        }, null, 2)}\n`,
        'utf8',
      )

      const migrated = await fixture.configCenter.loadSnapshot()

      expect(migrated.source).toBe('migrated-legacy')
      expect(migrated.migratedFrom).toBe(fixture.hostedPaths.copilotSettingsFile)
      expect(migrated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl).toBe('http://127.0.0.1:4310')
      expect(migrated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName).toBe('planner')
      expect(
        await readJsonFile(
          fixture.configCenterPaths.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG],
        ),
      ).toEqual(createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
        runtimeUrl: 'http://127.0.0.1:4310',
      }))
      expect(
        await readJsonFile(
          fixture.configCenterPaths.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR],
        ),
      ).toEqual(createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
        agentName: 'planner',
      }))

      await writeFile(
        fixture.hostedPaths.copilotSettingsFile,
        `${JSON.stringify({ runtimeUrl: 'http://ignored.example', agentName: 'ignored' }, null, 2)}\n`,
        'utf8',
      )

      const reloaded = await fixture.configCenter.loadSnapshot()

      expect(reloaded.source).toBe('stored')
      expect(reloaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl).toBe('http://127.0.0.1:4310')
      expect(reloaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName).toBe('planner')
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('normalizes stored values and field patches back to the stable schema shape', async () => {
    const fixture = await createConfigCenterFixture()

    try {
      await mkdir(fixture.configCenterPaths.rootDir, { recursive: true })

      await writeFile(
        fixture.configCenterPaths.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR],
        `${JSON.stringify({
          version: 99,
          domain: 'legacy-assistant',
          values: {
            agentName: '   ',
          },
        }, null, 2)}\n`,
        'utf8',
      )
      await writeFile(
        fixture.configCenterPaths.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG],
        `${JSON.stringify({
          version: 0,
          domain: UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
          values: {
            runtimeUrl: '  http://localhost:9000  ',
          },
        }, null, 2)}\n`,
        'utf8',
      )

      const loaded = await fixture.configCenter.loadSnapshot()

      expect(loaded.source).toBe('stored')
      expect(loaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
          agentName: null,
        }),
      )
      expect(loaded.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
          runtimeUrl: 'http://localhost:9000',
        }),
      )

      const updated = await fixture.configCenter.applyFieldPatch({
        agentName: 42,
        runtimeUrl: '  http://localhost:9100  ',
      })

      expect(updated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
          agentName: null,
        }),
      )
      expect(updated.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
          runtimeUrl: 'http://localhost:9100',
        }),
      )
      expect(
        await readJsonFile(
          fixture.configCenterPaths.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR],
        ),
      ).toEqual(createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
        agentName: null,
      }))
      expect(
        await readJsonFile(
          fixture.configCenterPaths.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG],
        ),
      ).toEqual(createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
        runtimeUrl: 'http://localhost:9100',
      }))
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})
