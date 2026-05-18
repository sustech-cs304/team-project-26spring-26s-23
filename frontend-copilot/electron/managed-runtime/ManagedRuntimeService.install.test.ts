import path from 'node:path'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHostedRuntimePaths } from '../runtime/runtime-paths'
import { createVersionDirectoryName } from './RuntimeInstallShared'
import { createManagedRuntimeService } from './ManagedRuntimeService'
import type { ManagedRuntimeFamilySnapshot } from './types'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })))
})

describe('ManagedRuntimeService install orchestration', () => {
  it('returns a ready snapshot with launcher paths after first install on an empty machine', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-managed-runtime-first-install-'))
    tempRoots.push(tempRoot)
    const hostedRuntimePaths = createHostedRuntimePaths(tempRoot)
    let nodeInstalled = false
    let uvInstalled = false
    const service = createManagedRuntimeService({
      userDataPath: hostedRuntimePaths.userDataDir,
      hostedRuntimePaths,
      processPlatform: 'win32',
      processArch: 'x64',
      nodeManagerFactory: ({ pinnedVersion, selectedComponents, managedRuntimePaths }) => ({
        loadSnapshot: vi.fn(async () => createFamilySnapshot('node', {
          status: nodeInstalled ? 'ready' : 'missing',
          pinnedVersion,
          activeVersion: nodeInstalled ? pinnedVersion : null,
          installRootDir: managedRuntimePaths.families.node.versionsDir,
          stagingDir: managedRuntimePaths.families.node.stagingDir,
          activeDir: managedRuntimePaths.families.node.activeDir,
          selectedComponents,
          launcherPaths: nodeInstalled
            ? {
                node: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'node.exe'),
                npm: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npm.cmd'),
                npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npx.cmd'),
              }
            : {},
          lastInstalledAt: nodeInstalled ? '2026-04-22T10:00:00.000Z' : null,
          lastRepairedAt: null,
          lastVerification: nodeInstalled
            ? {
              verifiedAt: '2026-04-22T10:00:00.000Z',
              summary: 'node/npm/npx verified',
              launchers: {
                  node: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'node.exe'),
                  npm: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npm.cmd'),
                  npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npx.cmd'),
                },
              }
            : null,
          lastErrorSummary: null,
        })),
        installOrRepair: vi.fn(async () => {
          nodeInstalled = true
          return createFamilySnapshot('node', {
          status: 'ready',
          pinnedVersion,
          activeVersion: pinnedVersion,
          installRootDir: managedRuntimePaths.families.node.versionsDir,
          stagingDir: managedRuntimePaths.families.node.stagingDir,
          activeDir: managedRuntimePaths.families.node.activeDir,
          selectedComponents,
          launcherPaths: {
            node: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'node.exe'),
            npm: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npm.cmd'),
            npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npx.cmd'),
          },
          lastInstalledAt: '2026-04-22T10:00:00.000Z',
          lastRepairedAt: null,
          lastVerification: {
            verifiedAt: '2026-04-22T10:00:00.000Z',
            summary: 'node/npm/npx verified',
            launchers: {
              node: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'node.exe'),
              npm: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npm.cmd'),
              npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npx.cmd'),
            },
          },
          lastErrorSummary: null,
          })
        }),
      }),
      uvManagerFactory: ({ pinnedVersion, selectedComponents, managedRuntimePaths }) => ({
        loadSnapshot: vi.fn(async () => createFamilySnapshot('uv', {
          status: uvInstalled ? 'ready' : 'missing',
          pinnedVersion,
          activeVersion: uvInstalled ? pinnedVersion : null,
          installRootDir: managedRuntimePaths.families.uv.versionsDir,
          stagingDir: managedRuntimePaths.families.uv.stagingDir,
          activeDir: managedRuntimePaths.families.uv.activeDir,
          selectedComponents,
          launcherPaths: uvInstalled
            ? {
                python: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'python.exe'),
                uv: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uv.exe'),
                uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe'),
              }
            : {},
          lastInstalledAt: uvInstalled ? '2026-04-22T10:00:00.000Z' : null,
          lastRepairedAt: null,
          lastVerification: uvInstalled
            ? {
              verifiedAt: '2026-04-22T10:00:00.000Z',
              summary: 'python/uv/uvx verified',
              launchers: {
                  python: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'python.exe'),
                  uv: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uv.exe'),
                  uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe'),
                },
              }
            : null,
          lastErrorSummary: null,
        })),
        installOrRepair: vi.fn(async () => {
          uvInstalled = true
          return createFamilySnapshot('uv', {
          status: 'ready',
          pinnedVersion,
          activeVersion: pinnedVersion,
          installRootDir: managedRuntimePaths.families.uv.versionsDir,
          stagingDir: managedRuntimePaths.families.uv.stagingDir,
          activeDir: managedRuntimePaths.families.uv.activeDir,
          selectedComponents,
          launcherPaths: {
            python: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'python.exe'),
            uv: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uv.exe'),
            uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe'),
          },
          lastInstalledAt: '2026-04-22T10:00:00.000Z',
          lastRepairedAt: null,
          lastVerification: {
            verifiedAt: '2026-04-22T10:00:00.000Z',
            summary: 'python/uv/uvx verified',
            launchers: {
              python: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'python.exe'),
              uv: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uv.exe'),
              uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe'),
            },
          },
          lastErrorSummary: null,
          })
        }),
      }),
    })

    const snapshot = await service.installOrRepairAll('install')

    expect(snapshot.overallStatus).toBe('ready')
    expect(snapshot.families.node.status).toBe('ready')
    expect(snapshot.families.uv.status).toBe('ready')
    expect(snapshot.families.node.lastVerification?.launchers.npx).toContain('npx.cmd')
    expect(snapshot.families.uv.lastVerification?.launchers.uvx).toContain('uvx.exe')
  })

  it('returns the same in-flight promise when install is triggered repeatedly', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-managed-runtime-service-'))
    tempRoots.push(tempRoot)
    const hostedRuntimePaths = createHostedRuntimePaths(tempRoot)
    const deferred = createDeferred<void>()
    const createUvSnapshot = (
      pinnedVersion: string,
      selectedComponents: ManagedRuntimeFamilySnapshot['selectedComponents'],
      directories: { versionsDir: string; stagingDir: string; activeDir: string },
    ): ManagedRuntimeFamilySnapshot => ({
      family: 'uv',
      status: 'ready',
      pinnedVersion,
      activeVersion: pinnedVersion,
      updateRecommended: false,
      installRootDir: directories.versionsDir,
      stagingDir: directories.stagingDir,
      activeDir: directories.activeDir,
      selectedComponents,
      launcherPaths: { python: 'python.exe', uv: 'uv.exe', uvx: 'uvx.exe' },
      lastInstalledAt: '2026-04-22T10:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    })
    const service = createManagedRuntimeService({
      userDataPath: hostedRuntimePaths.userDataDir,
      hostedRuntimePaths,
      processPlatform: 'win32',
      processArch: 'x64',
      nodeManagerFactory: ({ pinnedVersion, selectedComponents, managedRuntimePaths }) => {
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
          launcherPaths: { node: 'node.exe', npm: 'npm.cmd', npx: 'npx.cmd' },
          lastInstalledAt: '2026-04-22T10:00:00.000Z',
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
        const snapshot = createUvSnapshot(pinnedVersion, selectedComponents, managedRuntimePaths.families.uv)
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

  it('returns to ready after repairing broken and outdated families', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-managed-runtime-repair-'))
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
          launcherPaths: nodePhase === 'ready' ? { npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npx.cmd') } : {},
          lastInstalledAt: '2026-04-22T08:00:00.000Z',
          lastRepairedAt: nodePhase === 'ready' ? '2026-04-22T11:00:00.000Z' : null,
          lastVerification: nodePhase === 'ready'
            ? {
                verifiedAt: '2026-04-22T11:00:00.000Z',
                summary: 'node repaired',
                launchers: { npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npx.cmd') },
              }
            : null,
          lastErrorSummary: nodePhase === 'broken'
            ? { code: 'verification_failed', message: 'missing npx', at: '2026-04-22T10:00:00.000Z' }
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
            launcherPaths: { npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npx.cmd') },
            lastInstalledAt: '2026-04-22T08:00:00.000Z',
            lastRepairedAt: '2026-04-22T11:00:00.000Z',
            lastVerification: {
              verifiedAt: '2026-04-22T11:00:00.000Z',
              summary: 'node repaired',
              launchers: { npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npx.cmd') },
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
          launcherPaths: uvPhase === 'ready' ? { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe') } : {},
          lastInstalledAt: '2026-04-22T08:00:00.000Z',
          lastRepairedAt: uvPhase === 'ready' ? '2026-04-22T11:00:00.000Z' : null,
          lastVerification: uvPhase === 'ready'
            ? {
                verifiedAt: '2026-04-22T11:00:00.000Z',
                summary: 'uv repaired',
                launchers: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe') },
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
            launcherPaths: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe') },
            lastInstalledAt: '2026-04-22T08:00:00.000Z',
            lastRepairedAt: '2026-04-22T11:00:00.000Z',
            lastVerification: {
              verifiedAt: '2026-04-22T11:00:00.000Z',
              summary: 'uv repaired',
              launchers: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe') },
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
    expect(after.families.node.lastRepairedAt).toBe('2026-04-22T11:00:00.000Z')
    expect(after.families.uv.lastRepairedAt).toBe('2026-04-22T11:00:00.000Z')
  })

  it('keeps an existing active runtime usable while offline and still reports missing when never installed', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-managed-runtime-offline-'))
    tempRoots.push(tempRoot)
    const hostedRuntimePaths = createHostedRuntimePaths(tempRoot)

    const readyService = createManagedRuntimeService({
      userDataPath: hostedRuntimePaths.userDataDir,
      hostedRuntimePaths,
      processPlatform: 'win32',
      processArch: 'x64',
      nodeManagerFactory: ({ pinnedVersion, selectedComponents, managedRuntimePaths }) => ({
        loadSnapshot: vi.fn(async () => createFamilySnapshot('node', {
          status: 'ready',
          pinnedVersion,
          activeVersion: pinnedVersion,
          installRootDir: managedRuntimePaths.families.node.versionsDir,
          stagingDir: managedRuntimePaths.families.node.stagingDir,
          activeDir: managedRuntimePaths.families.node.activeDir,
          selectedComponents,
          launcherPaths: { npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npx.cmd') },
          lastInstalledAt: '2026-04-22T08:00:00.000Z',
          lastRepairedAt: null,
          lastVerification: {
            verifiedAt: '2026-04-22T08:00:00.000Z',
            summary: 'offline but active runtime is still usable',
            launchers: { npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npx.cmd') },
          },
          lastErrorSummary: null,
        })),
        installOrRepair: vi.fn(async () => {
          throw new Error('should not install during offline ready snapshot check')
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
          launcherPaths: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe') },
          lastInstalledAt: '2026-04-22T08:00:00.000Z',
          lastRepairedAt: null,
          lastVerification: {
            verifiedAt: '2026-04-22T08:00:00.000Z',
            summary: 'offline but active runtime is still usable',
            launchers: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe') },
          },
          lastErrorSummary: null,
        })),
        installOrRepair: vi.fn(async () => {
          throw new Error('should not install during offline ready snapshot check')
        }),
      }),
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
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-managed-runtime-active-guard-'))
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
          launcherPaths: { npx: getManagedNodeLauncherPath(managedRuntimePaths.families.node.versionsDir, pinnedVersion, 'npx.cmd') },
          lastInstalledAt: '2026-04-22T08:00:00.000Z',
          lastRepairedAt: null,
          lastVerification: null,
          lastErrorSummary: { code: 'verification_failed', message: 'broken runtime', at: '2026-04-22T10:00:00.000Z' },
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
          launcherPaths: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe') },
          lastInstalledAt: '2026-04-22T08:00:00.000Z',
          lastRepairedAt: null,
          lastVerification: {
            verifiedAt: '2026-04-22T08:00:00.000Z',
            summary: 'uv already ready',
            launchers: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe') },
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
          launcherPaths: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe') },
          lastInstalledAt: '2026-04-22T08:00:00.000Z',
          lastRepairedAt: null,
          lastVerification: {
            verifiedAt: '2026-04-22T08:00:00.000Z',
            summary: 'uv already ready',
            launchers: { uvx: getManagedUvLauncherPath(managedRuntimePaths.families.uv.versionsDir, pinnedVersion, 'uvx.exe') },
          },
          lastErrorSummary: null,
        })),
      }),
    })

    await expect(service.installOrRepairAll('repair')).rejects.toThrow('download checksum failed')
    await expect(access(nodeActiveSentinel)).resolves.toBeUndefined()
  })
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

function getManagedNodeLauncherPath(versionsDir: string, version: string, launcher: 'node.exe' | 'npm.cmd' | 'npx.cmd'): string {
  return path.join(versionsDir, createVersionDirectoryName(version), 'node', launcher)
}

function getManagedUvLauncherPath(versionsDir: string, version: string, launcher: 'python.exe' | 'uv.exe' | 'uvx.exe'): string {
  const component = launcher === 'python.exe' ? 'python' : 'uv'
  return path.join(versionsDir, createVersionDirectoryName(version), component, launcher)
}
