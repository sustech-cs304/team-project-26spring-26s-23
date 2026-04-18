import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../../runtime/runtime-paths'
import { createUnifiedConfigCenterPaths } from '../paths'
import { createUnifiedConfigCenter } from '../service'

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
