import { createHostedRuntimePaths, type HostedRuntimePaths } from '../runtime/runtime-paths'
import { resolveManagedRuntimeLauncher } from './command-resolution'
import { createManagedRuntimePaths, ensureManagedRuntimeDirectories } from './ManagedRuntimePaths'
import { NodeRuntimeManager } from './node/NodeRuntimeManager'
import {
  getManagedRuntimeManifest,
  getManagedRuntimeFamilyManifest,
  isManagedRuntimeActionSupported,
  resolveManagedRuntimeComponentSelection,
} from './runtime-manifest'
import type {
  ManagedRuntimeActionReason,
  ManagedRuntimeLauncherResolution,
  ManagedRuntimeOverallStatus,
  ManagedRuntimeSnapshot,
  ManagedRuntimeTarget,
} from './types'
import { UvRuntimeManager } from './uv/UvRuntimeManager'

export interface CreateManagedRuntimeServiceOptions {
  userDataPath: string
  hostedRuntimePaths?: HostedRuntimePaths
  processPlatform?: NodeJS.Platform
  processArch?: string
  nodeManagerFactory?: (context: {
    pinnedVersion: string
    selectedComponents: ReturnType<typeof resolveManagedRuntimeComponentSelection>['resolvedComponents']
    target: ManagedRuntimeTarget
    managedRuntimePaths: ReturnType<typeof createManagedRuntimePaths>
  }) => Pick<NodeRuntimeManager, 'loadSnapshot' | 'installOrRepair'>
  uvManagerFactory?: (context: {
    pinnedVersion: string
    selectedComponents: ReturnType<typeof resolveManagedRuntimeComponentSelection>['resolvedComponents']
    target: ManagedRuntimeTarget
    managedRuntimePaths: ReturnType<typeof createManagedRuntimePaths>
  }) => Pick<UvRuntimeManager, 'loadSnapshot' | 'installOrRepair'>
}

export interface ManagedRuntimeService {
  loadSnapshot: () => Promise<ManagedRuntimeSnapshot>
  installOrRepairAll: (reason?: ManagedRuntimeActionReason) => Promise<ManagedRuntimeSnapshot>
  resolveLauncher: (command: string) => Promise<ManagedRuntimeLauncherResolution>
}

export function createManagedRuntimeService(options: CreateManagedRuntimeServiceOptions): ManagedRuntimeService {
  const hostedRuntimePaths = options.hostedRuntimePaths ?? createHostedRuntimePaths(options.userDataPath)
  const managedRuntimePaths = createManagedRuntimePaths(hostedRuntimePaths)
  const target = resolveManagedRuntimeTarget({
    platform: options.processPlatform ?? process.platform,
    arch: options.processArch ?? process.arch,
  })
  const nodePinnedVersion = getManagedRuntimeFamilyManifest('node').pinnedVersion
  const uvPinnedVersion = getManagedRuntimeFamilyManifest('uv').pinnedVersion
  const nodeSelectedComponents = resolveManagedRuntimeComponentSelection('node', target).resolvedComponents
  const uvSelectedComponents = resolveManagedRuntimeComponentSelection('uv', target).resolvedComponents
  const nodeManager = options.nodeManagerFactory?.({
    pinnedVersion: nodePinnedVersion,
    selectedComponents: nodeSelectedComponents,
    target,
    managedRuntimePaths,
  }) ?? new NodeRuntimeManager({
    paths: managedRuntimePaths.families.node,
    pinnedVersion: nodePinnedVersion,
    selectedComponents: nodeSelectedComponents,
    ensureRootDirectories: async () => await ensureManagedRuntimeDirectories(managedRuntimePaths),
  })
  const uvManager = options.uvManagerFactory?.({
    pinnedVersion: uvPinnedVersion,
    selectedComponents: uvSelectedComponents,
    target,
    managedRuntimePaths,
  }) ?? new UvRuntimeManager({
    paths: managedRuntimePaths.families.uv,
    pinnedVersion: uvPinnedVersion,
    selectedComponents: uvSelectedComponents,
  })
  let installationTask: Promise<ManagedRuntimeSnapshot> | null = null
  let cachedSnapshot: ManagedRuntimeSnapshot | null = null

  const createSnapshot = (
    nodeSnapshot: ManagedRuntimeSnapshot['families']['node'],
    uvSnapshot: ManagedRuntimeSnapshot['families']['uv'],
  ): ManagedRuntimeSnapshot => ({
    manifestVersion: getManagedRuntimeManifest().manifestVersion,
    overallStatus: resolveOverallStatus(nodeSnapshot.status, uvSnapshot.status),
    target,
    rootDir: managedRuntimePaths.rootDir,
    hostedRuntimeRootDir: hostedRuntimePaths.runtimeRootDir,
    families: {
      node: nodeSnapshot,
      uv: uvSnapshot,
    },
  })

  const loadSnapshot = async (): Promise<ManagedRuntimeSnapshot> => {
    await ensureManagedRuntimeDirectories(managedRuntimePaths)
    const nodeSnapshot = await nodeManager.loadSnapshot()
    const uvSnapshot = await uvManager.loadSnapshot()
    const nextSnapshot = createSnapshot(nodeSnapshot, uvSnapshot)
    const resolvedSnapshot = cachedSnapshot === null
      ? nextSnapshot
      : createSnapshot(
          preferCachedFamilySnapshot(cachedSnapshot.families.node, nextSnapshot.families.node),
          preferCachedFamilySnapshot(cachedSnapshot.families.uv, nextSnapshot.families.uv),
        )

    cachedSnapshot = resolvedSnapshot
    return resolvedSnapshot
  }

  return {
    async loadSnapshot() {
      return await loadSnapshot()
    },
    async resolveLauncher(command) {
      const snapshot = await this.loadSnapshot()
      return resolveManagedRuntimeLauncher(snapshot, command)
    },
    installOrRepairAll(reason = 'install') {
      if (installationTask !== null) {
        return installationTask
      }

      installationTask = (async () => {
        const before = await loadSnapshot()
        let nextNodeSnapshot = before.families.node
        let nextUvSnapshot = before.families.uv
        const nodeActionSupported = isManagedRuntimeActionSupported('node', target)
        const uvActionSupported = isManagedRuntimeActionSupported('uv', target)
        if (!nodeActionSupported && !uvActionSupported) {
          throw new Error(`Managed runtime install/repair is not supported for target ${target.platform}/${target.arch}.`)
        }
        if (nodeActionSupported) {
          const nodeResult = await nodeManager.installOrRepair(reason)
          if (shouldUseImmediateInstallResult(before.families.node.status, nodeResult.status)) {
            nextNodeSnapshot = nodeResult
          }
        }
        if (uvActionSupported) {
          const uvResult = await uvManager.installOrRepair(reason)
          if (shouldUseImmediateInstallResult(before.families.uv.status, uvResult.status)) {
            nextUvSnapshot = uvResult
          }
        }
        const refreshed = await loadSnapshot()
        const result = createSnapshot(
          nextNodeSnapshot.status === 'ready' ? nextNodeSnapshot : refreshed.families.node,
          nextUvSnapshot.status === 'ready' ? nextUvSnapshot : refreshed.families.uv,
        )
        cachedSnapshot = result
        return result
      })().finally(() => {
        installationTask = null
      })

      return installationTask
    },
  }
}

export function resolveManagedRuntimeTarget(input: { platform: NodeJS.Platform; arch: string }): ManagedRuntimeTarget {
  if ((input.platform === 'win32' || input.platform === 'darwin' || input.platform === 'linux')
    && (input.arch === 'x64' || input.arch === 'arm64')) {
    return {
      platform: input.platform as ManagedRuntimeTarget['platform'],
      arch: input.arch as ManagedRuntimeTarget['arch'],
    }
  }

  throw new Error(`Unsupported managed runtime target: ${input.platform}/${input.arch}`)
}

function resolveOverallStatus(...statuses: ManagedRuntimeOverallStatus[]): ManagedRuntimeOverallStatus {
  if (statuses.includes('broken')) {
    return 'broken'
  }
  if (statuses.includes('installing')) {
    return 'installing'
  }
  if (statuses.includes('outdated')) {
    return 'outdated'
  }
  if (statuses.includes('missing')) {
    return 'missing'
  }
  return 'ready'
}

function shouldUseImmediateInstallResult(previousStatus: ManagedRuntimeOverallStatus, nextStatus: ManagedRuntimeOverallStatus): boolean {
  return nextStatus === 'ready' && (previousStatus === 'outdated' || previousStatus === 'broken')
}

function preferCachedFamilySnapshot(
  cachedFamily: ManagedRuntimeSnapshot['families']['node'] | ManagedRuntimeSnapshot['families']['uv'],
  nextFamily: ManagedRuntimeSnapshot['families']['node'] | ManagedRuntimeSnapshot['families']['uv'],
) {
  if (cachedFamily.status === 'ready'
    && !cachedFamily.updateRecommended
    && cachedFamily.activeVersion === cachedFamily.pinnedVersion
    && nextFamily.activeVersion !== nextFamily.pinnedVersion) {
    return cachedFamily
  }

  return nextFamily
}
