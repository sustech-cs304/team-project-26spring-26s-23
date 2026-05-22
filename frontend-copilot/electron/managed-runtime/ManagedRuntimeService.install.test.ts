import path from 'node:path'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHostedRuntimePaths } from '../runtime/runtime-paths'
import { createVersionDirectoryName } from './RuntimeInstallShared'
import { createManagedRuntimeService } from './ManagedRuntimeService'
import type { ManagedRuntimeFamilySnapshot, ManagedRuntimePaths } from './types'

const TEMP_PREFIX = 'candue-managed-runtime-'
const LAUNCHER_NPX = 'npx.cmd'
const LAUNCHER_NPM = 'npm.cmd'
const LAUNCHER_NODE = 'node.exe'
const LAUNCHER_UVX = 'uvx.exe'
const LAUNCHER_UV = 'uv.exe'
const LAUNCHER_PYTHON = 'python.exe'
const TS_INSTALL = '2026-04-22T10:00:00.000Z'
const TS_OLD = '2026-04-22T08:00:00.000Z'
const TS_REPAIRED = '2026-04-22T11:00:00.000Z'
const SUMMARY_NODE = 'node/npm/npx verified'
const SUMMARY_UV = 'python/uv/uvx verified'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })))
})

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

function createFamilySnapshot(
  family: ManagedRuntimeFamilySnapshot['family'],
  snapshot: Omit<ManagedRuntimeFamilySnapshot, 'family' | 'updateRecommended'>
    & Partial<Pick<ManagedRuntimeFamilySnapshot, 'updateRecommended'>>,
): ManagedRuntimeFamilySnapshot {
  return {
    family,
    ...snapshot,
    updateRecommended: snapshot.updateRecommended
      ?? (snapshot.activeVersion !== null && snapshot.activeVersion !== snapshot.pinnedVersion),
  }
}

function getManagedNodeLauncherPath(versionsDir: string, version: string, launcher: string): string {
  return path.join(versionsDir, createVersionDirectoryName(version), 'node', launcher)
}

function getManagedUvLauncherPath(versionsDir: string, version: string, launcher: string): string {
  const component = launcher === LAUNCHER_PYTHON ? 'python' : 'uv'
  return path.join(versionsDir, createVersionDirectoryName(version), component, launcher)
}

function makeNodeLauncherPaths(
  versionsDir: string,
  version: string,
): Record<string, string> {
  return {
    node: getManagedNodeLauncherPath(versionsDir, version, LAUNCHER_NODE),
    npm: getManagedNodeLauncherPath(versionsDir, version, LAUNCHER_NPM),
    npx: getManagedNodeLauncherPath(versionsDir, version, LAUNCHER_NPX),
  }
}

function makeUvLauncherPaths(
  versionsDir: string,
  version: string,
): Record<string, string> {
  return {
    python: getManagedUvLauncherPath(versionsDir, version, LAUNCHER_PYTHON),
    uv: getManagedUvLauncherPath(versionsDir, version, LAUNCHER_UV),
    uvx: getManagedUvLauncherPath(versionsDir, version, LAUNCHER_UVX),
  }
}

type ManagerFactoryParams = {
  pinnedVersion: string
  selectedComponents: ManagedRuntimeFamilySnapshot['selectedComponents']
  managedRuntimePaths: ManagedRuntimePaths
}

function buildNodeManagerFactory(
  loadSnapshotOverride?: (params: ManagerFactoryParams) => ManagedRuntimeFamilySnapshot,
  installOrRepairOverride?: (params: ManagerFactoryParams) => ManagedRuntimeFamilySnapshot | Promise<ManagedRuntimeFamilySnapshot>,
) {
  return ({ pinnedVersion, selectedComponents, managedRuntimePaths }: ManagerFactoryParams) => {
    const dirs = managedRuntimePaths.families.node
    const defaultLoadSnapshot = (): ManagedRuntimeFamilySnapshot => createFamilySnapshot('node', {
      status: 'ready',
      pinnedVersion,
      activeVersion: pinnedVersion,
      installRootDir: dirs.versionsDir,
      stagingDir: dirs.stagingDir,
      activeDir: dirs.activeDir,
      selectedComponents,
      launcherPaths: makeNodeLauncherPaths(dirs.versionsDir, pinnedVersion),
      lastInstalledAt: TS_INSTALL,
      lastRepairedAt: null,
      lastVerification: {
        verifiedAt: TS_INSTALL,
        summary: SUMMARY_NODE,
        launchers: makeNodeLauncherPaths(dirs.versionsDir, pinnedVersion),
      },
      lastErrorSummary: null,
    })
    return {
      loadSnapshot: vi.fn(async () => loadSnapshotOverride
        ? loadSnapshotOverride({ pinnedVersion, selectedComponents, managedRuntimePaths })
        : defaultLoadSnapshot()),
      installOrRepair: installOrRepairOverride
        ? vi.fn(async () => installOrRepairOverride({ pinnedVersion, selectedComponents, managedRuntimePaths }))
        : vi.fn(),
    }
  }
}

function buildUvManagerFactory(
  loadSnapshotOverride?: (params: ManagerFactoryParams) => ManagedRuntimeFamilySnapshot,
  installOrRepairOverride?: (params: ManagerFactoryParams) => ManagedRuntimeFamilySnapshot | Promise<ManagedRuntimeFamilySnapshot>,
) {
  return ({ pinnedVersion, selectedComponents, managedRuntimePaths }: ManagerFactoryParams) => {
    const dirs = managedRuntimePaths.families.uv
    const defaultLoadSnapshot = (): ManagedRuntimeFamilySnapshot => createFamilySnapshot('uv', {
      status: 'ready',
      pinnedVersion,
      activeVersion: pinnedVersion,
      installRootDir: dirs.versionsDir,
      stagingDir: dirs.stagingDir,
      activeDir: dirs.activeDir,
      selectedComponents,
      launcherPaths: makeUvLauncherPaths(dirs.versionsDir, pinnedVersion),
      lastInstalledAt: TS_INSTALL,
      lastRepairedAt: null,
      lastVerification: {
        verifiedAt: TS_INSTALL,
        summary: SUMMARY_UV,
        launchers: makeUvLauncherPaths(dirs.versionsDir, pinnedVersion),
      },
      lastErrorSummary: null,
    })
    return {
      loadSnapshot: vi.fn(async () => loadSnapshotOverride
        ? loadSnapshotOverride({ pinnedVersion, selectedComponents, managedRuntimePaths })
        : defaultLoadSnapshot()),
      installOrRepair: installOrRepairOverride
        ? vi.fn(async () => installOrRepairOverride({ pinnedVersion, selectedComponents, managedRuntimePaths }))
        : vi.fn(),
    }
  }
}

// eslint-disable-next-line max-lines-per-function -- This describe groups the full install-orchestration suite; each sub-describe already isolates a phase, and splitting further would duplicate test-root setup.
describe('ManagedRuntimeService install orchestration', () => {
  describe('fresh install', () => {
    it('returns a ready snapshot with launcher paths after first install on an empty machine', async () => {
      const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}first-install-`))
      tempRoots.push(tempRoot)
      const hostedRuntimePaths = createHostedRuntimePaths(tempRoot)
      let nodeInstalled = false
      let uvInstalled = false
      const service = createManagedRuntimeService({
        userDataPath: hostedRuntimePaths.userDataDir,
        hostedRuntimePaths,
        processPlatform: 'win32',
        processArch: 'x64',
        nodeManagerFactory: buildNodeManagerFactory(
          ({ pinnedVersion, managedRuntimePaths }) => {
            const dirs = managedRuntimePaths.families.node
            return createFamilySnapshot('node', {
              status: nodeInstalled ? 'ready' : 'missing',
              pinnedVersion,
              activeVersion: nodeInstalled ? pinnedVersion : null,
              installRootDir: dirs.versionsDir,
              stagingDir: dirs.stagingDir,
              activeDir: dirs.activeDir,
              selectedComponents: [],
              launcherPaths: nodeInstalled ? makeNodeLauncherPaths(dirs.versionsDir, pinnedVersion) : {},
              lastInstalledAt: nodeInstalled ? TS_INSTALL : null,
              lastRepairedAt: null,
              lastVerification: nodeInstalled
                ? { verifiedAt: TS_INSTALL, summary: SUMMARY_NODE, launchers: makeNodeLauncherPaths(dirs.versionsDir, pinnedVersion) }
                : null,
              lastErrorSummary: null,
            })
          },
          ({ pinnedVersion, managedRuntimePaths }) => {
            nodeInstalled = true
            const dirs = managedRuntimePaths.families.node
            return createFamilySnapshot('node', {
              status: 'ready',
              pinnedVersion,
              activeVersion: pinnedVersion,
              installRootDir: dirs.versionsDir,
              stagingDir: dirs.stagingDir,
              activeDir: dirs.activeDir,
              selectedComponents: [],
              launcherPaths: makeNodeLauncherPaths(dirs.versionsDir, pinnedVersion),
              lastInstalledAt: TS_INSTALL,
              lastRepairedAt: null,
              lastVerification: { verifiedAt: TS_INSTALL, summary: SUMMARY_NODE, launchers: makeNodeLauncherPaths(dirs.versionsDir, pinnedVersion) },
              lastErrorSummary: null,
            })
          },
        ),
        uvManagerFactory: buildUvManagerFactory(
          ({ pinnedVersion, managedRuntimePaths }) => {
            const dirs = managedRuntimePaths.families.uv
            return createFamilySnapshot('uv', {
              status: uvInstalled ? 'ready' : 'missing',
              pinnedVersion,
              activeVersion: uvInstalled ? pinnedVersion : null,
              installRootDir: dirs.versionsDir,
              stagingDir: dirs.stagingDir,
              activeDir: dirs.activeDir,
              selectedComponents: [],
              launcherPaths: uvInstalled ? makeUvLauncherPaths(dirs.versionsDir, pinnedVersion) : {},
              lastInstalledAt: uvInstalled ? TS_INSTALL : null,
              lastRepairedAt: null,
              lastVerification: uvInstalled
                ? { verifiedAt: TS_INSTALL, summary: SUMMARY_UV, launchers: makeUvLauncherPaths(dirs.versionsDir, pinnedVersion) }
                : null,
              lastErrorSummary: null,
            })
          },
          ({ pinnedVersion, managedRuntimePaths }) => {
            uvInstalled = true
            const dirs = managedRuntimePaths.families.uv
            return createFamilySnapshot('uv', {
              status: 'ready',
              pinnedVersion,
              activeVersion: pinnedVersion,
              installRootDir: dirs.versionsDir,
              stagingDir: dirs.stagingDir,
              activeDir: dirs.activeDir,
              selectedComponents: [],
              launcherPaths: makeUvLauncherPaths(dirs.versionsDir, pinnedVersion),
              lastInstalledAt: TS_INSTALL,
              lastRepairedAt: null,
              lastVerification: { verifiedAt: TS_INSTALL, summary: SUMMARY_UV, launchers: makeUvLauncherPaths(dirs.versionsDir, pinnedVersion) },
              lastErrorSummary: null,
            })
          },
        ),
      })

      const snapshot = await service.installOrRepairAll('install')

      expect(snapshot.overallStatus).toBe('ready')
      expect(snapshot.families.node.status).toBe('ready')
      expect(snapshot.families.uv.status).toBe('ready')
      expect(snapshot.families.node.lastVerification?.launchers.npx).toContain(LAUNCHER_NPX)
      expect(snapshot.families.uv.lastVerification?.launchers.uvx).toContain(LAUNCHER_UVX)
    })
  })

  describe('deduplication', () => {
    it('returns the same in-flight promise when install is triggered repeatedly', async () => {
      const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}service-`))
      tempRoots.push(tempRoot)
      const hostedRuntimePaths = createHostedRuntimePaths(tempRoot)
      const deferred = createDeferred<void>()
      const service = createManagedRuntimeService({
        userDataPath: hostedRuntimePaths.userDataDir,
        hostedRuntimePaths,
        processPlatform: 'win32',
        processArch: 'x64',
        nodeManagerFactory: ({ pinnedVersion, selectedComponents, managedRuntimePaths }) => {
          const defaultPaths = { node: LAUNCHER_NODE, npm: LAUNCHER_NPM, npx: LAUNCHER_NPX }
          const snapshot: ManagedRuntimeFamilySnapshot = {
            family: 'node',
            status: 'ready',
            pinnedVersion,
            activeVersion: pinnedVersion,
            updateRecommended: false,
            installRootDir: managedRuntimePaths.families.node.versionsDir,
            stagingDir: managedRuntimePaths.families.node.stagingDir,
            activeDir: managedRuntimePaths.families.node.activeDir,
            selectedComponents,
            launcherPaths: defaultPaths,
            lastInstalledAt: TS_INSTALL,
            lastRepairedAt: null,
            lastVerification: null,
            lastErrorSummary: null,
          }
          return {
            loadSnapshot: vi.fn(async () => snapshot),
            installOrRepair: vi.fn(async () => {
              await deferred.promise
              return snapshot
            }),
          }
        },
        uvManagerFactory: ({ pinnedVersion, selectedComponents, managedRuntimePaths }) => {
          const defaultPaths = { python: LAUNCHER_PYTHON, uv: LAUNCHER_UV, uvx: LAUNCHER_UVX }
          const snapshot = createFamilySnapshot('uv', {
            status: 'ready',
            pinnedVersion,
            activeVersion: pinnedVersion,
            installRootDir: managedRuntimePaths.families.uv.versionsDir,
            stagingDir: managedRuntimePaths.families.uv.stagingDir,
            activeDir: managedRuntimePaths.families.uv.activeDir,
            selectedComponents,
            launcherPaths: defaultPaths,
            lastInstalledAt: TS_INSTALL,
            lastRepairedAt: null,
            lastVerification: null,
            lastErrorSummary: null,
          })
          return {
            loadSnapshot: vi.fn(async () => snapshot),
            installOrRepair: vi.fn(async () => snapshot),
          }
        },
      })

      const first = service.installOrRepairAll('install')
      const second = service.installOrRepairAll('install')

      await Promise.resolve()
      deferred.resolve()

      await Promise.allSettled([first, second])

      expect(first).toBe(second)
    })
  })

  describe('repair', () => {
    it('returns to ready after repairing broken and outdated families', async () => {
      const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}repair-`))
      tempRoots.push(tempRoot)
      const hostedRuntimePaths = createHostedRuntimePaths(tempRoot)
      let nodePhase: 'broken' | 'ready' = 'broken'
      let uvPhase: 'outdated' | 'ready' = 'outdated'
      const service = createManagedRuntimeService({
        userDataPath: hostedRuntimePaths.userDataDir,
        hostedRuntimePaths,
        processPlatform: 'win32',
        processArch: 'x64',
        nodeManagerFactory: ({ pinnedVersion, selectedComponents, managedRuntimePaths }) => ({
          loadSnapshot: vi.fn(async () => createFamilySnapshot('node', {
            status: nodePhase,
            pinnedVersion,
            activeVersion: pinnedVersion,
            installRootDir: managedRuntimePaths.families.node.versionsDir,
            stagingDir: managedRuntimePaths.families.node.stagingDir,
            activeDir: managedRuntimePaths.families.node.activeDir,
            selectedComponents,
            launcherPaths: nodePhase === 'ready' ? { npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, LAUNCHER_NPX) } : {},
            lastInstalledAt: TS_OLD,
            lastRepairedAt: nodePhase === 'ready' ? TS_REPAIRED : null,
            lastVerification: nodePhase === 'ready'
              ? {
                  verifiedAt: TS_REPAIRED,
                  summary: 'node repaired',
                  launchers: { npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, LAUNCHER_NPX) },
                }
              : null,
            lastErrorSummary: nodePhase === 'broken'
              ? { code: 'verification_failed', message: 'missing npx', at: TS_INSTALL }
              : null,
          })),
          installOrRepair: vi.fn(async () => {
            nodePhase = 'ready'
            return createFamilySnapshot('node', {
              status: 'ready',
              pinnedVersion,
              activeVersion: pinnedVersion,
              installRootDir: managedRuntimePaths.families.node.versionsDir,
              stagingDir: managedRuntimePaths.families.node.stagingDir,
              activeDir: managedRuntimePaths.families.node.activeDir,
              selectedComponents,
              launcherPaths: { npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, LAUNCHER_NPX) },
              lastInstalledAt: TS_OLD,
              lastRepairedAt: TS_REPAIRED,
              lastVerification: {
                verifiedAt: TS_REPAIRED,
                summary: 'node repaired',
                launchers: { npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, LAUNCHER_NPX) },
              },
              lastErrorSummary: null,
            })
          }),
        }),
        uvManagerFactory: ({ pinnedVersion, selectedComponents, managedRuntimePaths }) => ({
          loadSnapshot: vi.fn(async () => createFamilySnapshot('uv', {
            status: uvPhase,
            pinnedVersion,
            activeVersion: uvPhase === 'ready' ? pinnedVersion : 'python 3.12.9 + uv 0.11.6',
            installRootDir: managedRuntimePaths.families.uv.versionsDir,
            stagingDir: managedRuntimePaths.families.uv.stagingDir,
            activeDir: managedRuntimePaths.families.uv.activeDir,
            selectedComponents,
            launcherPaths: uvPhase === 'ready' ? { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, LAUNCHER_UVX) } : {},
            lastInstalledAt: TS_OLD,
            lastRepairedAt: uvPhase === 'ready' ? TS_REPAIRED : null,
            lastVerification: uvPhase === 'ready'
              ? {
                  verifiedAt: TS_REPAIRED,
                  summary: 'uv repaired',
                  launchers: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, LAUNCHER_UVX) },
                }
              : null,
            lastErrorSummary: null,
          })),
          installOrRepair: vi.fn(async () => {
            uvPhase = 'ready'
            return createFamilySnapshot('uv', {
              status: 'ready',
              pinnedVersion,
              activeVersion: pinnedVersion,
              installRootDir: managedRuntimePaths.families.uv.versionsDir,
              stagingDir: managedRuntimePaths.families.uv.stagingDir,
              activeDir: managedRuntimePaths.families.uv.activeDir,
              selectedComponents,
              launcherPaths: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, LAUNCHER_UVX) },
              lastInstalledAt: TS_OLD,
              lastRepairedAt: TS_REPAIRED,
              lastVerification: {
                verifiedAt: TS_REPAIRED,
                summary: 'uv repaired',
                launchers: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, LAUNCHER_UVX) },
              },
              lastErrorSummary: null,
            })
          }),
        }),
      })

      const before = await service.loadSnapshot()
      const after = await service.installOrRepairAll('repair')

      expect(before.overallStatus).toBe('broken')
      expect(before.families.node.status).toBe('broken')
      expect(before.families.uv.status).toBe('outdated')
      expect(after.overallStatus).toBe('ready')
      expect(after.families.node.lastRepairedAt).toBe(TS_REPAIRED)
      expect(after.families.uv.lastRepairedAt).toBe(TS_REPAIRED)
    })
  })

  // eslint-disable-next-line max-lines-per-function -- This describe groups offline/error-handling tests that share manager factories; splitting would duplicate factory and tempRoot setup.
  describe('offline and error handling', () => {
    it('keeps an existing active runtime usable while offline and still reports missing when never installed', async () => {
      const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}offline-`))
      tempRoots.push(tempRoot)
      const hostedRuntimePaths = createHostedRuntimePaths(tempRoot)

      const readyService = createManagedRuntimeService({
        userDataPath: hostedRuntimePaths.userDataDir,
        hostedRuntimePaths,
        processPlatform: 'win32',
        processArch: 'x64',
        nodeManagerFactory: buildNodeManagerFactory(
          ({ pinnedVersion, managedRuntimePaths }) => {
            const dirs = managedRuntimePaths.families.node
            return createFamilySnapshot('node', {
              status: 'ready',
              pinnedVersion,
              activeVersion: pinnedVersion,
              installRootDir: dirs.versionsDir,
              stagingDir: dirs.stagingDir,
              activeDir: dirs.activeDir,
              selectedComponents: [],
              launcherPaths: { npx: getManagedNodeLauncherPath(dirs.versionsDir, pinnedVersion, LAUNCHER_NPX) },
              lastInstalledAt: TS_OLD,
              lastRepairedAt: null,
              lastVerification: {
                verifiedAt: TS_OLD,
                summary: 'offline but active runtime is still usable',
                launchers: { npx: getManagedNodeLauncherPath(dirs.versionsDir, pinnedVersion, LAUNCHER_NPX) },
              },
              lastErrorSummary: null,
            })
          },
          async () => {
            throw new Error('should not install during offline ready snapshot check')
          },
        ),
        uvManagerFactory: buildUvManagerFactory(
          ({ pinnedVersion, managedRuntimePaths }) => {
            const dirs = managedRuntimePaths.families.uv
            return createFamilySnapshot('uv', {
              status: 'ready',
              pinnedVersion,
              activeVersion: pinnedVersion,
              installRootDir: dirs.versionsDir,
              stagingDir: dirs.stagingDir,
              activeDir: dirs.activeDir,
              selectedComponents: [],
              launcherPaths: { uvx: getManagedUvLauncherPath(dirs.versionsDir, pinnedVersion, LAUNCHER_UVX) },
              lastInstalledAt: TS_OLD,
              lastRepairedAt: null,
              lastVerification: {
                verifiedAt: TS_OLD,
                summary: 'offline but active runtime is still usable',
                launchers: { uvx: getManagedUvLauncherPath(dirs.versionsDir, pinnedVersion, LAUNCHER_UVX) },
              },
              lastErrorSummary: null,
            })
          },
          async () => {
            throw new Error('should not install during offline ready snapshot check')
          },
        ),
      })

      const missingService = createManagedRuntimeService({
        userDataPath: hostedRuntimePaths.userDataDir,
        hostedRuntimePaths,
        processPlatform: 'win32',
        processArch: 'x64',
      })

      const readySnapshot = await readyService.loadSnapshot()
      const missingSnapshot = await missingService.loadSnapshot()

      expect(readySnapshot.overallStatus).toBe('ready')
      expect(readySnapshot.families.node.lastVerification?.summary).toContain('offline')
      expect(missingSnapshot.overallStatus).toBe('missing')
      expect(missingSnapshot.families.node.activeVersion).toBeNull()
      expect(missingSnapshot.families.uv.activeVersion).toBeNull()
    })

    it('does not let a failed install pollute the active runtime directories', async () => {
      const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}active-guard-`))
      tempRoots.push(tempRoot)
      const hostedRuntimePaths = createHostedRuntimePaths(tempRoot)
      const nodeActiveSentinel = path.join(hostedRuntimePaths.runtimeRootDir, 'managed-runtime/node/active/sentinel.txt')
      const service = createManagedRuntimeService({
        userDataPath: hostedRuntimePaths.userDataDir,
        hostedRuntimePaths,
        processPlatform: 'win32',
        processArch: 'x64',
        nodeManagerFactory: ({ pinnedVersion, selectedComponents, managedRuntimePaths }) => ({
          loadSnapshot: vi.fn(async () => createFamilySnapshot('node', {
            status: 'broken',
            pinnedVersion,
            activeVersion: pinnedVersion,
            installRootDir: managedRuntimePaths.families.node.versionsDir,
            stagingDir: managedRuntimePaths.families.node.stagingDir,
            activeDir: managedRuntimePaths.families.node.activeDir,
            selectedComponents,
            launcherPaths: { npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, LAUNCHER_NPX) },
            lastInstalledAt: TS_OLD,
            lastRepairedAt: null,
            lastVerification: null,
            lastErrorSummary: { code: 'verification_failed', message: 'broken runtime', at: TS_INSTALL },
          })),
          installOrRepair: vi.fn(async () => {
            await mkdir(managedRuntimePaths.families.node.activeDir, { recursive: true })
            await writeFile(nodeActiveSentinel, 'active-node')
            throw new Error('download checksum failed')
          }),
        }),
        uvManagerFactory: ({ pinnedVersion, selectedComponents, managedRuntimePaths }) => ({
          loadSnapshot: vi.fn(async () => createFamilySnapshot('uv', {
            status: 'ready',
            pinnedVersion,
            activeVersion: pinnedVersion,
            installRootDir: managedRuntimePaths.families.uv.versionsDir,
            stagingDir: managedRuntimePaths.families.uv.stagingDir,
            activeDir: managedRuntimePaths.families.uv.activeDir,
            selectedComponents,
            launcherPaths: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, LAUNCHER_UVX) },
            lastInstalledAt: TS_OLD,
            lastRepairedAt: null,
            lastVerification: {
              verifiedAt: TS_OLD,
              summary: 'uv already ready',
              launchers: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, LAUNCHER_UVX) },
            },
            lastErrorSummary: null,
          })),
          installOrRepair: vi.fn(async () => createFamilySnapshot('uv', {
            status: 'ready',
            pinnedVersion,
            activeVersion: pinnedVersion,
            installRootDir: managedRuntimePaths.families.uv.versionsDir,
            stagingDir: managedRuntimePaths.families.uv.stagingDir,
            activeDir: managedRuntimePaths.families.uv.activeDir,
            selectedComponents,
            launcherPaths: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, LAUNCHER_UVX) },
            lastInstalledAt: TS_OLD,
            lastRepairedAt: null,
            lastVerification: {
              verifiedAt: TS_OLD,
              summary: 'uv already ready',
              launchers: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, LAUNCHER_UVX) },
            },
            lastErrorSummary: null,
          })),
        }),
      })

      await expect(service.installOrRepairAll('repair')).rejects.toThrow('download checksum failed')
      await expect(access(nodeActiveSentinel)).resolves.toBeUndefined()
    })
  })
})
