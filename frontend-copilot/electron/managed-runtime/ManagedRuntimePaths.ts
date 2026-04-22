import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { HostedRuntimePaths } from '../runtime/runtime-paths'
import type { ManagedRuntimeFamily, ManagedRuntimeFamilyPaths, ManagedRuntimePaths } from './types'

export const MANAGED_RUNTIME_ROOT_DIR_NAME = 'managed-runtime'
export const MANAGED_RUNTIME_MANIFESTS_DIR_NAME = 'manifests'
export const MANAGED_RUNTIME_DIAGNOSTICS_DIR_NAME = 'diagnostics'

export function createManagedRuntimePaths(
  hostedRuntimePaths: Pick<HostedRuntimePaths, 'runtimeRootDir'>,
): ManagedRuntimePaths {
  const rootDir = path.join(hostedRuntimePaths.runtimeRootDir, MANAGED_RUNTIME_ROOT_DIR_NAME)
  const manifestsDir = path.join(rootDir, MANAGED_RUNTIME_MANIFESTS_DIR_NAME)
  const diagnosticsDir = path.join(rootDir, MANAGED_RUNTIME_DIAGNOSTICS_DIR_NAME)

  return {
    rootDir,
    manifestsDir,
    diagnosticsDir,
    families: {
      node: createManagedRuntimeFamilyPaths(rootDir, 'node'),
      uv: createManagedRuntimeFamilyPaths(rootDir, 'uv'),
    },
  }
}

export function createManagedRuntimeFamilyPaths(rootDir: string, family: ManagedRuntimeFamily): ManagedRuntimeFamilyPaths {
  const familyRootDir = path.join(rootDir, family)
  return {
    family,
    rootDir: familyRootDir,
    cacheDir: path.join(familyRootDir, 'cache'),
    stagingDir: path.join(familyRootDir, 'staging'),
    versionsDir: path.join(familyRootDir, 'versions'),
    activeDir: path.join(familyRootDir, 'active'),
    activePointerFile: path.join(familyRootDir, 'active.json'),
    diagnosticsDir: path.join(familyRootDir, 'diagnostics'),
  }
}

export function listManagedRuntimeDirectories(paths: ManagedRuntimePaths): string[] {
  return [
    paths.rootDir,
    paths.manifestsDir,
    paths.diagnosticsDir,
    ...Object.values(paths.families).flatMap((familyPaths) => [
      familyPaths.rootDir,
      familyPaths.cacheDir,
      familyPaths.stagingDir,
      familyPaths.versionsDir,
      familyPaths.activeDir,
      familyPaths.diagnosticsDir,
    ]),
  ]
}

export async function ensureManagedRuntimeDirectories(paths: ManagedRuntimePaths): Promise<void> {
  await Promise.all(listManagedRuntimeDirectories(paths).map((directoryPath) => mkdir(directoryPath, { recursive: true })))
}

