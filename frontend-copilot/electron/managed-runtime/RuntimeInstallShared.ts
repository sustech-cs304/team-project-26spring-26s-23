import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
  await rm(versionDir, { recursive: true, force: true })
  await mkdir(paths.versionsDir, { recursive: true })
  await mkdir(path.dirname(versionDir), { recursive: true })
  await rename(stagedVersionDir, versionDir)
  await writeJsonFile(paths.activePointerFile, { activeVersion: version } satisfies ManagedRuntimeActivePointer)
  return versionDir
}
