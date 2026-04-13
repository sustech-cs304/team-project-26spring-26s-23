import { mkdir, readFile, writeFile } from 'node:fs/promises'

import type { UnifiedConfigDomainKey } from '../domain-schema'
import {
  createConfigCenterFixture,
  destroyConfigCenterFixture,
  type ConfigCenterFixture,
  withConfigCenterFixture,
} from './config-center-test-fixtures'

export {
  createConfigCenterFixture,
  destroyConfigCenterFixture,
  type ConfigCenterFixture,
  withConfigCenterFixture,
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
