import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../../runtime/runtime-paths'
import { createSettingsWorkspacePaths } from '../paths'
import { createSettingsWorkspaceStorage } from '../service'

export interface SettingsWorkspaceFixture {
  tempRoot: string
  hostedPaths: ReturnType<typeof createHostedRuntimePaths>
  storage: ReturnType<typeof createSettingsWorkspaceStorage>
  paths: ReturnType<typeof createSettingsWorkspacePaths>
}

export interface PreparedHostedPathsFixture {
  tempRoot: string
  hostedPaths: ReturnType<typeof createHostedRuntimePaths>
}

export async function createSettingsWorkspaceFixture(): Promise<SettingsWorkspaceFixture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-settings-workspace-'))
  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)
  const paths = createSettingsWorkspacePaths(hostedPaths)

  return {
    tempRoot,
    hostedPaths,
    paths,
    storage: createSettingsWorkspaceStorage({ paths }),
  }
}

export async function createPreparedPaths(testName: string): Promise<PreparedHostedPathsFixture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-settings-main-${testName}-`))
  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)

  return {
    tempRoot,
    hostedPaths,
  }
}

export async function destroyWorkspaceTempRoot(tempRoot: string): Promise<void> {
  await rm(tempRoot, { recursive: true, force: true })
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown
}
