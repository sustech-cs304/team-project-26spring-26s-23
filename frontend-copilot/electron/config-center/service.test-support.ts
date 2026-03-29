import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import type { UnifiedConfigDomainKey } from './domain-schema'
import { createUnifiedConfigCenterPaths } from './paths'
import { createUnifiedConfigCenter } from './service'

export interface ConfigCenterFixture {
  tempRoot: string
  hostedPaths: ReturnType<typeof createHostedRuntimePaths>
  configCenterPaths: ReturnType<typeof createUnifiedConfigCenterPaths>
  configCenter: ReturnType<typeof createUnifiedConfigCenter>
}

export async function createConfigCenterFixture(): Promise<ConfigCenterFixture> {
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

export async function destroyConfigCenterFixture(fixture: ConfigCenterFixture): Promise<void> {
  await rm(fixture.tempRoot, { recursive: true, force: true })
}

export async function withConfigCenterFixture(
  run: (fixture: ConfigCenterFixture) => Promise<void>,
): Promise<void> {
  const fixture = await createConfigCenterFixture()

  try {
    await run(fixture)
  } finally {
    await destroyConfigCenterFixture(fixture)
  }
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown
}

export async function readStoredDomainDocument(
  fixture: ConfigCenterFixture,
  domain: UnifiedConfigDomainKey,
): Promise<unknown> {
  return readJsonFile(fixture.configCenterPaths.documents[domain])
}

export async function writeRawDomainDocuments(
  fixture: ConfigCenterFixture,
  documents: Partial<Record<UnifiedConfigDomainKey, unknown>>,
): Promise<void> {
  await mkdir(fixture.configCenterPaths.rootDir, { recursive: true })

  await Promise.all(
    (Object.entries(documents) as [UnifiedConfigDomainKey, unknown][]).map(async ([domain, document]) => {
      if (document === undefined) {
        return
      }

      await writeFile(
        fixture.configCenterPaths.documents[domain],
        `${JSON.stringify(document, null, 2)}\n`,
        'utf8',
      )
    }),
  )
}

export async function writeLegacyCopilotSettings(
  fixture: ConfigCenterFixture,
  settings: unknown,
): Promise<void> {
  await writeFile(
    fixture.hostedPaths.copilotSettingsFile,
    `${JSON.stringify(settings, null, 2)}\n`,
    'utf8',
  )
}
