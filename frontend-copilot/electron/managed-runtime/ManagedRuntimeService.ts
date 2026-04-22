import { createHostedRuntimePaths, type HostedRuntimePaths } from '../runtime/runtime-paths'
import { createManagedRuntimePaths, ensureManagedRuntimeDirectories } from './ManagedRuntimePaths'
import { getManagedRuntimeManifest, getManagedRuntimeFamilyManifest, resolveManagedRuntimeComponents } from './runtime-manifest'
import type { ManagedRuntimeFamily, ManagedRuntimeSnapshot, ManagedRuntimeTarget } from './types'

export interface CreateManagedRuntimeServiceOptions {
  userDataPath: string
  hostedRuntimePaths?: HostedRuntimePaths
  processPlatform?: NodeJS.Platform
  processArch?: string
}

export interface ManagedRuntimeService {
  loadSnapshot: () => Promise<ManagedRuntimeSnapshot>
}

export function createManagedRuntimeService(options: CreateManagedRuntimeServiceOptions): ManagedRuntimeService {
  const hostedRuntimePaths = options.hostedRuntimePaths ?? createHostedRuntimePaths(options.userDataPath)
  const managedRuntimePaths = createManagedRuntimePaths(hostedRuntimePaths)
  const target = resolveManagedRuntimeTarget({
    platform: options.processPlatform ?? process.platform,
    arch: options.processArch ?? process.arch,
  })

  return {
    async loadSnapshot() {
      await ensureManagedRuntimeDirectories(managedRuntimePaths)

      return {
        manifestVersion: getManagedRuntimeManifest().manifestVersion,
        overallStatus: 'missing',
        target,
        rootDir: managedRuntimePaths.rootDir,
        hostedRuntimeRootDir: hostedRuntimePaths.runtimeRootDir,
        families: {
          node: createManagedRuntimeFamilySnapshot('node', managedRuntimePaths, target),
          uv: createManagedRuntimeFamilySnapshot('uv', managedRuntimePaths, target),
        },
      }
    },
  }
}

export function resolveManagedRuntimeTarget(input: { platform: NodeJS.Platform; arch: string }): ManagedRuntimeTarget {
  if ((input.platform === 'win32' || input.platform === 'darwin' || input.platform === 'linux')
    && (input.arch === 'x64' || input.arch === 'arm64')) {
    return {
      platform: input.platform,
      arch: input.arch,
    }
  }

  throw new Error(`Unsupported managed runtime target: ${input.platform}/${input.arch}`)
}

function createManagedRuntimeFamilySnapshot(
  family: ManagedRuntimeFamily,
  managedRuntimePaths: ReturnType<typeof createManagedRuntimePaths>,
  target: ManagedRuntimeTarget,
) {
  const familyManifest = getManagedRuntimeFamilyManifest(family)
  const familyPaths = managedRuntimePaths.families[family]

  return {
    family,
    status: 'missing' as const,
    pinnedVersion: familyManifest.pinnedVersion,
    activeVersion: null,
    installRootDir: familyPaths.versionsDir,
    stagingDir: familyPaths.stagingDir,
    activeDir: familyPaths.activeDir,
    selectedComponents: resolveManagedRuntimeComponents(family, target),
  }
}

