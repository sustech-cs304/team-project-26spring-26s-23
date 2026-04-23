import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createHostedRuntimePaths } from '../runtime/runtime-paths'
import { createManagedRuntimeService, resolveManagedRuntimeTarget } from './ManagedRuntimeService'
import type { ManagedRuntimeFamilySnapshot } from './types'

function createFamilySnapshot(
  family: ManagedRuntimeFamilySnapshot['family'],
  snapshot: Omit<ManagedRuntimeFamilySnapshot, 'family'>,
): ManagedRuntimeFamilySnapshot {
  return {
    family,
    ...snapshot,
  }
}

describe('createManagedRuntimeService', () => {
  it('builds a missing snapshot rooted in the application private runtime directories', async () => {
    const hostedRuntimePaths = createHostedRuntimePaths(path.resolve('D:/workspace/candue-user-data'))
    const service = createManagedRuntimeService({
      userDataPath: hostedRuntimePaths.userDataDir,
      hostedRuntimePaths,
      processPlatform: 'win32',
      processArch: 'x64',
    })

    const result = await service.loadSnapshot()

    expect(result.overallStatus).toBe('missing')
    expect(result.rootDir).toBe(path.resolve('D:/workspace/candue-user-data/desktop-runtime/managed-runtime'))
    expect(result.families.node.status).toBe('missing')
    expect(result.families.uv.status).toBe('missing')
    expect(result.families.node.selectedComponents[0]?.distribution.fileName).toBe('node-v24.15.0-win-x64.zip')
  })

  it('rejects unsupported platform and architecture pairs early', () => {
    expect(() => resolveManagedRuntimeTarget({ platform: 'freebsd', arch: 'x64' })).toThrow(
      'Unsupported managed runtime target: freebsd/x64',
    )
    expect(resolveManagedRuntimeTarget({ platform: 'darwin', arch: 'arm64' })).toEqual({
      platform: 'darwin',
      arch: 'arm64',
    })
    expect(resolveManagedRuntimeTarget({ platform: 'linux', arch: 'x64' })).toEqual({
      platform: 'linux',
      arch: 'x64',
    })
  })

  it('initializes Linux and macOS services with missing snapshots instead of failing target resolution', async () => {
    const macHostedRuntimePaths = createHostedRuntimePaths(path.resolve('D:/workspace/candue-user-data-macos'))
    const macNodeLoadSnapshot = vi.fn(async () => ({
      family: 'node' as const,
      status: 'missing' as const,
      pinnedVersion: '24.15.0',
      activeVersion: null,
      installRootDir: 'node-install-root',
      stagingDir: 'node-staging',
      activeDir: 'node-active',
      selectedComponents: [],
      launcherPaths: {},
      lastInstalledAt: null,
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    }))
    const macUvLoadSnapshot = vi.fn(async () => ({
      family: 'uv' as const,
      status: 'missing' as const,
      pinnedVersion: 'python 3.12.13 + uv 0.11.7',
      activeVersion: null,
      installRootDir: 'uv-install-root',
      stagingDir: 'uv-staging',
      activeDir: 'uv-active',
      selectedComponents: [],
      launcherPaths: {},
      lastInstalledAt: null,
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    }))
    const macService = createManagedRuntimeService({
      userDataPath: macHostedRuntimePaths.userDataDir,
      hostedRuntimePaths: macHostedRuntimePaths,
      processPlatform: 'darwin',
      processArch: 'arm64',
      nodeManagerFactory: () => ({
        loadSnapshot: macNodeLoadSnapshot,
        installOrRepair: vi.fn(),
      }),
      uvManagerFactory: () => ({
        loadSnapshot: macUvLoadSnapshot,
        installOrRepair: vi.fn(),
      }),
    })

    const linuxHostedRuntimePaths = createHostedRuntimePaths(path.resolve('D:/workspace/candue-user-data-linux'))
    const linuxNodeLoadSnapshot = vi.fn(async () => ({
      family: 'node' as const,
      status: 'missing' as const,
      pinnedVersion: '24.15.0',
      activeVersion: null,
      installRootDir: 'node-install-root',
      stagingDir: 'node-staging',
      activeDir: 'node-active',
      selectedComponents: [],
      launcherPaths: {},
      lastInstalledAt: null,
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    }))
    const linuxUvLoadSnapshot = vi.fn(async () => ({
      family: 'uv' as const,
      status: 'missing' as const,
      pinnedVersion: 'python 3.12.13 + uv 0.11.7',
      activeVersion: null,
      installRootDir: 'uv-install-root',
      stagingDir: 'uv-staging',
      activeDir: 'uv-active',
      selectedComponents: [],
      launcherPaths: {},
      lastInstalledAt: null,
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    }))
    const linuxService = createManagedRuntimeService({
      userDataPath: linuxHostedRuntimePaths.userDataDir,
      hostedRuntimePaths: linuxHostedRuntimePaths,
      processPlatform: 'linux',
      processArch: 'x64',
      nodeManagerFactory: () => ({
        loadSnapshot: linuxNodeLoadSnapshot,
        installOrRepair: vi.fn(),
      }),
      uvManagerFactory: () => ({
        loadSnapshot: linuxUvLoadSnapshot,
        installOrRepair: vi.fn(),
      }),
    })

    await expect(macService.loadSnapshot()).resolves.toMatchObject({
      overallStatus: 'missing',
      target: { platform: 'darwin', arch: 'arm64' },
      families: {
        node: { status: 'missing' },
        uv: { status: 'missing' },
      },
    })
    await expect(linuxService.loadSnapshot()).resolves.toMatchObject({
      overallStatus: 'missing',
      target: { platform: 'linux', arch: 'x64' },
      families: {
        node: { status: 'missing' },
        uv: { status: 'missing' },
      },
    })
  })

  it('installs Node on macOS while leaving Python/uv missing until the runtime manager persists ready state', async () => {
    const hostedRuntimePaths = createHostedRuntimePaths(path.resolve('D:/workspace/candue-user-data-managed-node-only'))
    let nodeStatus: 'missing' | 'ready' = 'missing'
    const nodeInstall = vi.fn(async () => {
      nodeStatus = 'ready'
      return {
        family: 'node' as const,
        status: 'ready' as const,
        pinnedVersion: '24.15.0',
        activeVersion: '24.15.0',
        installRootDir: 'node-install-root',
        stagingDir: 'node-staging',
        activeDir: 'node-active',
        selectedComponents: [],
        launcherPaths: {
          npx: '/managed/node/bin/npx',
        },
        lastInstalledAt: '2026-04-22T18:00:00.000Z',
        lastRepairedAt: null,
        lastVerification: null,
        lastErrorSummary: null,
      }
    })
    const uvInstall = vi.fn(async () => {
      return {
        family: 'uv' as const,
        status: 'ready' as const,
        pinnedVersion: 'python 3.12.13 + uv 0.11.7',
        activeVersion: 'python 3.12.13 + uv 0.11.7',
        installRootDir: 'uv-install-root',
        stagingDir: 'uv-staging',
        activeDir: 'uv-active',
        selectedComponents: [],
        launcherPaths: {
          python: '/managed/uv/install/bin/python3',
          uv: '/managed/uv/uv',
          uvx: '/managed/uv/uvx',
        },
        lastInstalledAt: '2026-04-22T18:00:00.000Z',
        lastRepairedAt: null,
        lastVerification: null,
        lastErrorSummary: null,
      }
    })

    const service = createManagedRuntimeService({
      userDataPath: hostedRuntimePaths.userDataDir,
      hostedRuntimePaths,
      processPlatform: 'darwin',
      processArch: 'arm64',
      nodeManagerFactory: () => ({
        loadSnapshot: async () => ({
          family: 'node',
          status: nodeStatus,
          pinnedVersion: '24.15.0',
          activeVersion: nodeStatus === 'ready' ? '24.15.0' : null,
          installRootDir: 'node-install-root',
          stagingDir: 'node-staging',
          activeDir: 'node-active',
          selectedComponents: [],
          launcherPaths: nodeStatus === 'ready' ? { npx: '/managed/node/bin/npx' } : {},
          lastInstalledAt: null,
          lastRepairedAt: null,
          lastVerification: null,
          lastErrorSummary: null,
        }),
        installOrRepair: nodeInstall,
      }),
      uvManagerFactory: () => ({
        loadSnapshot: async () => ({
          family: 'uv',
          status: 'missing',
          pinnedVersion: 'python 3.12.13 + uv 0.11.7',
          activeVersion: null,
          installRootDir: 'uv-install-root',
          stagingDir: 'uv-staging',
          activeDir: 'uv-active',
          selectedComponents: [],
          launcherPaths: {},
          lastInstalledAt: null,
          lastRepairedAt: null,
          lastVerification: null,
          lastErrorSummary: null,
        }),
        installOrRepair: uvInstall,
      }),
    })

    const snapshot = await service.installOrRepairAll('install')

    expect(nodeInstall).toHaveBeenCalledWith('install')
    expect(uvInstall).toHaveBeenCalledWith('install')
    expect(snapshot.families.node.status).toBe('ready')
    expect(snapshot.families.uv.status).toBe('missing')
    expect(snapshot.overallStatus).toBe('missing')
  })

  it('returns the repaired uv snapshot immediately and keeps later loads consistent', async () => {
    const hostedRuntimePaths = createHostedRuntimePaths(path.resolve('D:/workspace/candue-user-data-uv-repair-refresh'))
    const repairedVersion = 'python 3.12.13 + uv 0.11.7'
    const outdatedVersion = 'python 3.12.10 + uv 0.11.7'
    const oldUvSnapshot = createFamilySnapshot('uv', {
      status: 'outdated',
      pinnedVersion: repairedVersion,
      activeVersion: outdatedVersion,
      installRootDir: 'uv-install-root',
      stagingDir: 'uv-staging',
      activeDir: 'uv-active',
      selectedComponents: [],
      launcherPaths: {
        uv: '/managed/uv/old/uv',
        uvx: '/managed/uv/old/uvx',
        python: '/managed/uv/old/python',
      },
      lastInstalledAt: '2026-04-22T08:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    })
    const repairedUvSnapshot = createFamilySnapshot('uv', {
      status: 'ready',
      pinnedVersion: repairedVersion,
      activeVersion: repairedVersion,
      installRootDir: 'uv-install-root',
      stagingDir: 'uv-staging',
      activeDir: 'uv-active',
      selectedComponents: [],
      launcherPaths: {
        uv: '/managed/uv/new/uv',
        uvx: '/managed/uv/new/uvx',
        python: '/managed/uv/new/python',
      },
      lastInstalledAt: '2026-04-22T08:00:00.000Z',
      lastRepairedAt: '2026-04-23T08:00:00.000Z',
      lastVerification: {
        verifiedAt: '2026-04-23T08:00:00.000Z',
        summary: 'uv repaired to target version',
        launchers: {
          uv: '/managed/uv/new/uv',
          uvx: '/managed/uv/new/uvx',
          python: '/managed/uv/new/python',
        },
      },
      lastErrorSummary: null,
    })
    const nodeSnapshot = createFamilySnapshot('node', {
      status: 'ready',
      pinnedVersion: '24.15.0',
      activeVersion: '24.15.0',
      installRootDir: 'node-install-root',
      stagingDir: 'node-staging',
      activeDir: 'node-active',
      selectedComponents: [],
      launcherPaths: {
        npx: '/managed/node/npx',
      },
      lastInstalledAt: '2026-04-22T08:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: {
        verifiedAt: '2026-04-22T08:00:00.000Z',
        summary: 'node ready',
        launchers: {
          npx: '/managed/node/npx',
        },
      },
      lastErrorSummary: null,
    })
    const nodeLoadSnapshot = vi.fn(async () => nodeSnapshot)
    const uvLoadSnapshot = vi.fn(async () => oldUvSnapshot)
    const uvInstallOrRepair = vi.fn(async () => repairedUvSnapshot)

    const service = createManagedRuntimeService({
      userDataPath: hostedRuntimePaths.userDataDir,
      hostedRuntimePaths,
      processPlatform: 'win32',
      processArch: 'x64',
      nodeManagerFactory: () => ({
        loadSnapshot: nodeLoadSnapshot,
        installOrRepair: vi.fn(async () => nodeSnapshot),
      }),
      uvManagerFactory: () => ({
        loadSnapshot: uvLoadSnapshot,
        installOrRepair: uvInstallOrRepair,
      }),
    })

    const repaired = await service.installOrRepairAll('repair')
    const reloaded = await service.loadSnapshot()

    expect(uvInstallOrRepair).toHaveBeenCalledWith('repair')
    expect(repaired.families.uv).toEqual(repairedUvSnapshot)
    expect(repaired.families.uv.activeVersion).toBe(repairedVersion)
    expect(repaired.overallStatus).toBe('ready')
    expect(reloaded.families.uv).toEqual(repairedUvSnapshot)
    expect(reloaded.families.uv.activeVersion).toBe(repairedVersion)
    expect(uvLoadSnapshot).toHaveBeenCalledTimes(3)
  })

  it('keeps the previous uv snapshot when repair fails', async () => {
    const hostedRuntimePaths = createHostedRuntimePaths(path.resolve('D:/workspace/candue-user-data-uv-repair-failed'))
    const oldUvSnapshot = createFamilySnapshot('uv', {
      status: 'outdated',
      pinnedVersion: 'python 3.12.13 + uv 0.11.7',
      activeVersion: 'python 3.12.10 + uv 0.11.7',
      installRootDir: 'uv-install-root',
      stagingDir: 'uv-staging',
      activeDir: 'uv-active',
      selectedComponents: [],
      launcherPaths: {
        uvx: '/managed/uv/old/uvx',
      },
      lastInstalledAt: '2026-04-22T08:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    })
    const failedUvSnapshot = createFamilySnapshot('uv', {
      ...oldUvSnapshot,
      status: 'broken',
      lastRepairedAt: '2026-04-23T08:00:00.000Z',
      lastErrorSummary: {
        code: 'verification_failed',
        message: 'repair failed',
        at: '2026-04-23T08:00:00.000Z',
      },
    })
    const nodeSnapshot = createFamilySnapshot('node', {
      status: 'ready',
      pinnedVersion: '24.15.0',
      activeVersion: '24.15.0',
      installRootDir: 'node-install-root',
      stagingDir: 'node-staging',
      activeDir: 'node-active',
      selectedComponents: [],
      launcherPaths: {
        npx: '/managed/node/npx',
      },
      lastInstalledAt: '2026-04-22T08:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: {
        verifiedAt: '2026-04-22T08:00:00.000Z',
        summary: 'node ready',
        launchers: {
          npx: '/managed/node/npx',
        },
      },
      lastErrorSummary: null,
    })

    const service = createManagedRuntimeService({
      userDataPath: hostedRuntimePaths.userDataDir,
      hostedRuntimePaths,
      processPlatform: 'win32',
      processArch: 'x64',
      nodeManagerFactory: () => ({
        loadSnapshot: vi.fn(async () => nodeSnapshot),
        installOrRepair: vi.fn(async () => nodeSnapshot),
      }),
      uvManagerFactory: () => ({
        loadSnapshot: vi.fn(async () => oldUvSnapshot),
        installOrRepair: vi.fn(async () => failedUvSnapshot),
      }),
    })

    const repaired = await service.installOrRepairAll('repair')

    expect(repaired.families.uv).toEqual(oldUvSnapshot)
    expect(repaired.families.uv.activeVersion).toBe('python 3.12.10 + uv 0.11.7')
    expect(repaired.overallStatus).toBe('outdated')
  })
})
