import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ManagedRuntimeFamilyPaths } from './types'

export interface ManagedRuntimeActivePointer {
  activeVersion: string
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value, null, 2))
}

export function createVersionDirectoryName(version: string): string {
  return version.replace(/[^a-zA-Z0-9._-]+/g, '-')
}

export async function prepareCleanStagingDirectory(paths: ManagedRuntimeFamilyPaths, version: string): Promise<string> {
  const stagingDir = path.join(paths.stagingDir, `${createVersionDirectoryName(version)}-${Date.now()}`)
  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })
  return stagingDir
}

export async function activateManagedRuntimeVersion(
  paths: ManagedRuntimeFamilyPaths,
  version: string,
  stagedVersionDir: string,
): Promise<string> {
  const versionDir = path.join(paths.versionsDir, createVersionDirectoryName(version))
  await mkdir(paths.versionsDir, { recursive: true })
  await mkdir(path.dirname(versionDir), { recursive: true })
  const backupVersionDir = path.join(
    paths.versionsDir,
    `${createVersionDirectoryName(version)}.backup-${Date.now()}`,
  )
  const hadExistingVersion = await pathExists(versionDir)
  let stagedActivated = false

  try {
    if (hadExistingVersion) {
      await rename(versionDir, backupVersionDir)
    }

    await rename(stagedVersionDir, versionDir)
    stagedActivated = true
    await writeJsonFile(paths.activePointerFile, { activeVersion: version } satisfies ManagedRuntimeActivePointer)

    if (hadExistingVersion) {
      await rm(backupVersionDir, { recursive: true, force: true })
    }

    return versionDir
  } catch (error) {
    if (hadExistingVersion) {
      await rollbackManagedRuntimeActivation(versionDir, backupVersionDir, stagedActivated)
    }
    throw error
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function rollbackManagedRuntimeActivation(
  versionDir: string,
  backupVersionDir: string,
  stagedActivated: boolean,
): Promise<void> {
  if (!(await pathExists(backupVersionDir))) {
    return
  }

  if (stagedActivated && (await pathExists(versionDir))) {
    await rm(versionDir, { recursive: true, force: true })
  }

  if (!(await pathExists(versionDir))) {
    await rename(backupVersionDir, versionDir)
  }
}
