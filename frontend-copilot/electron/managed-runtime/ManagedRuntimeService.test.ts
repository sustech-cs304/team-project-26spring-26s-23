import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createHostedRuntimePaths } from '../runtime/runtime-paths'
import { createManagedRuntimeService, resolveManagedRuntimeTarget } from './ManagedRuntimeService'
import type { ManagedRuntimeFamilySnapshot } from './types'

const STATUS_MISSING = 'missing' as const
const STATUS_READY = 'ready' as const
const STATUS_OUTDATED = 'outdated' as const
const STATUS_BROKEN = 'broken' as const
const FAMILY_NODE = 'node' as const
const FAMILY_UV = 'uv' as const
const PINNED_NODE = '24.15.0'
const PINNED_UV = 'python 3.12.13 + uv 0.11.7'
const INSTALL_ROOT_NODE = 'node-install-root'
const INSTALL_ROOT_UV = 'uv-install-root'
const STAGING_NODE = 'node-staging'
const STAGING_UV = 'uv-staging'
const ACTIVE_NODE = 'node-active'
const ACTIVE_UV = 'uv-active'
const NPX_PATH = '/managed/node/npx'
const UV_PATH = '/managed/uv/uv'
const UVX_PATH = '/managed/uv/uvx'
const PYTHON_PATH = '/managed/uv/python'

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

function makeMissingNodeFields() {
  return {
    pinnedVersion: PINNED_NODE,
    activeVersion: null,
    updateRecommended: false,
    installRootDir: INSTALL_ROOT_NODE,
    stagingDir: STAGING_NODE,
    activeDir: ACTIVE_NODE,
    selectedComponents: [] as ManagedRuntimeFamilySnapshot['selectedComponents'],
    launcherPaths: {} as Record<string, string>,
    lastInstalledAt: null,
    lastRepairedAt: null,
    lastVerification: null,
    lastErrorSummary: null,
  }
}

function makeMissingUvFields() {
  return {
    pinnedVersion: PINNED_UV,
    activeVersion: null,
    updateRecommended: false,
    installRootDir: INSTALL_ROOT_UV,
    stagingDir: STAGING_UV,
    activeDir: ACTIVE_UV,
    selectedComponents: [] as ManagedRuntimeFamilySnapshot['selectedComponents'],
    launcherPaths: {} as Record<string, string>,
    lastInstalledAt: null,
    lastRepairedAt: null,
    lastVerification: null,
    lastErrorSummary: null,
  }
}

/* eslint-disable sonarjs/no-duplicate-string -- Timestamp and path constants like "2026-04-22T08:00:00.000Z" and "/managed/uv/old/uvx" are expected repetitions in independent test cases that each set up a distinct runtime snapshot scenario. */
// eslint-disable-next-line max-lines-per-function -- This describe groups ManagedRuntimeService tests that share fixture builders; splitting would scatter helper factories across sub-describes.
describe('createManagedRuntimeService', () => {
  describe('loadSnapshot', () => {
    it('builds a missing snapshot rooted in the application private runtime directories', async () => {
      const hostedRuntimePaths = createHostedRuntimePaths(path.resolve('D:/workspace/candue-user-data'))
      const service = createManagedRuntimeService({
        userDataPath: hostedRuntimePaths.userDataDir,
        hostedRuntimePaths,
        processPlatform: 'win32',
        processArch: 'x64',
      })

      const result = await service.loadSnapshot()

      expect(result.overallStatus).toBe(STATUS_MISSING)
      expect(result.rootDir).toBe(path.resolve('D:/workspace/candue-user-data/desktop-runtime/managed-runtime'))
      expect(result.families.node.status).toBe(STATUS_MISSING)
      expect(result.families.uv.status).toBe(STATUS_MISSING)
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
        family: FAMILY_NODE,
        status: STATUS_MISSING,
        ...makeMissingNodeFields(),
      }))
      const macUvLoadSnapshot = vi.fn(async () => ({
        family: FAMILY_UV,
        status: STATUS_MISSING,
        ...makeMissingUvFields(),
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
        family: FAMILY_NODE,
        status: STATUS_MISSING,
        ...makeMissingNodeFields(),
      }))
      const linuxUvLoadSnapshot = vi.fn(async () => ({
        family: FAMILY_UV,
        status: STATUS_MISSING,
        ...makeMissingUvFields(),
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
        overallStatus: STATUS_MISSING,
        target: { platform: 'darwin', arch: 'arm64' },
        families: {
          node: { status: STATUS_MISSING },
          uv: { status: STATUS_MISSING },
        },
      })
      await expect(linuxService.loadSnapshot()).resolves.toMatchObject({
        overallStatus: STATUS_MISSING,
        target: { platform: 'linux', arch: 'x64' },
        families: {
          node: { status: STATUS_MISSING },
          uv: { status: STATUS_MISSING },
        },
      })
    })
  })

  // eslint-disable-next-line max-lines-per-function -- This describe groups install/repair orchestration tests around shared manager factories; splitting would duplicate factory setup.
  describe('installOrRepairAll', () => {
    it('installs Node on macOS while leaving Python/uv missing until the runtime manager persists ready state', async () => {
      const hostedRuntimePaths = createHostedRuntimePaths(path.resolve('D:/workspace/candue-user-data-managed-node-only'))
      let nodeStatus: 'missing' | 'ready' = STATUS_MISSING
      const nodeInstall = vi.fn(async () => {
        nodeStatus = STATUS_READY
        return {
          family: FAMILY_NODE,
          status: STATUS_READY,
          pinnedVersion: PINNED_NODE,
          activeVersion: PINNED_NODE,
          updateRecommended: false,
          installRootDir: INSTALL_ROOT_NODE,
          stagingDir: STAGING_NODE,
          activeDir: ACTIVE_NODE,
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
      const uvInstall = vi.fn(async () => ({
        family: FAMILY_UV,
        status: STATUS_READY,
        pinnedVersion: PINNED_UV,
        activeVersion: PINNED_UV,
        updateRecommended: false,
        installRootDir: INSTALL_ROOT_UV,
        stagingDir: STAGING_UV,
        activeDir: ACTIVE_UV,
        selectedComponents: [],
        launcherPaths: {
          python: PYTHON_PATH,
          uv: UV_PATH,
          uvx: UVX_PATH,
        },
        lastInstalledAt: '2026-04-22T18:00:00.000Z',
        lastRepairedAt: null,
        lastVerification: null,
        lastErrorSummary: null,
      }))

      const service = createManagedRuntimeService({
        userDataPath: hostedRuntimePaths.userDataDir,
        hostedRuntimePaths,
        processPlatform: 'darwin',
        processArch: 'arm64',
        nodeManagerFactory: () => ({
          loadSnapshot: async () => ({
            family: FAMILY_NODE,
            status: nodeStatus,
            pinnedVersion: PINNED_NODE,
            activeVersion: nodeStatus === STATUS_READY ? PINNED_NODE : null,
            updateRecommended: false,
            installRootDir: INSTALL_ROOT_NODE,
            stagingDir: STAGING_NODE,
            activeDir: ACTIVE_NODE,
            selectedComponents: [],
            launcherPaths: nodeStatus === STATUS_READY ? { npx: '/managed/node/bin/npx' } : {},
            lastInstalledAt: null,
            lastRepairedAt: null,
            lastVerification: null,
            lastErrorSummary: null,
          }),
          installOrRepair: nodeInstall,
        }),
        uvManagerFactory: () => ({
          loadSnapshot: async () => ({
            family: FAMILY_UV,
            status: STATUS_MISSING,
            pinnedVersion: PINNED_UV,
            activeVersion: null,
            updateRecommended: false,
            installRootDir: INSTALL_ROOT_UV,
            stagingDir: STAGING_UV,
            activeDir: ACTIVE_UV,
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
      expect(snapshot.families.node.status).toBe(STATUS_READY)
      expect(snapshot.families.uv.status).toBe(STATUS_MISSING)
      expect(snapshot.overallStatus).toBe(STATUS_MISSING)
    })

    it('returns the repaired uv snapshot immediately and keeps later loads consistent', async () => {
      const hostedRuntimePaths = createHostedRuntimePaths(path.resolve('D:/workspace/candue-user-data-uv-repair-refresh'))
      const repairedVersion = PINNED_UV
      const outdatedVersion = 'python 3.12.10 + uv 0.11.7'
      const oldUvSnapshot = createFamilySnapshot(FAMILY_UV, {
        status: STATUS_OUTDATED,
        pinnedVersion: repairedVersion,
        activeVersion: outdatedVersion,
        installRootDir: INSTALL_ROOT_UV,
        stagingDir: STAGING_UV,
        activeDir: ACTIVE_UV,
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
      const repairedUvSnapshot = createFamilySnapshot(FAMILY_UV, {
        status: STATUS_READY,
        pinnedVersion: repairedVersion,
        activeVersion: repairedVersion,
        installRootDir: INSTALL_ROOT_UV,
        stagingDir: STAGING_UV,
        activeDir: ACTIVE_UV,
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
      const nodeSnapshot = createFamilySnapshot(FAMILY_NODE, {
        status: STATUS_READY,
        pinnedVersion: PINNED_NODE,
        activeVersion: PINNED_NODE,
        installRootDir: INSTALL_ROOT_NODE,
        stagingDir: STAGING_NODE,
        activeDir: ACTIVE_NODE,
        selectedComponents: [],
        launcherPaths: {
          npx: NPX_PATH,
        },
        lastInstalledAt: '2026-04-22T08:00:00.000Z',
        lastRepairedAt: null,
        lastVerification: {
          verifiedAt: '2026-04-22T08:00:00.000Z',
          summary: 'node ready',
          launchers: {
            npx: NPX_PATH,
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
      expect(repaired.overallStatus).toBe(STATUS_READY)
      expect(reloaded.families.uv).toEqual(repairedUvSnapshot)
      expect(reloaded.families.uv.activeVersion).toBe(repairedVersion)
      expect(uvLoadSnapshot).toHaveBeenCalledTimes(3)
    })

    it('keeps the previous uv snapshot when repair fails', async () => {
      const hostedRuntimePaths = createHostedRuntimePaths(path.resolve('D:/workspace/candue-user-data-uv-repair-failed'))
      const oldUvSnapshot = createFamilySnapshot(FAMILY_UV, {
        status: STATUS_OUTDATED,
        pinnedVersion: PINNED_UV,
        activeVersion: 'python 3.12.10 + uv 0.11.7',
        installRootDir: INSTALL_ROOT_UV,
        stagingDir: STAGING_UV,
        activeDir: ACTIVE_UV,
        selectedComponents: [],
        launcherPaths: {
          uvx: '/managed/uv/old/uvx',
        },
        lastInstalledAt: '2026-04-22T08:00:00.000Z',
        lastRepairedAt: null,
        lastVerification: null,
        lastErrorSummary: null,
      })
      const failedUvSnapshot = createFamilySnapshot(FAMILY_UV, {
        ...oldUvSnapshot,
        status: STATUS_BROKEN,
        lastRepairedAt: '2026-04-23T08:00:00.000Z',
        lastErrorSummary: {
          code: 'verification_failed',
          message: 'repair failed',
          at: '2026-04-23T08:00:00.000Z',
        },
      })
      const nodeSnapshot = createFamilySnapshot(FAMILY_NODE, {
        status: STATUS_READY,
        pinnedVersion: PINNED_NODE,
        activeVersion: PINNED_NODE,
        installRootDir: INSTALL_ROOT_NODE,
        stagingDir: STAGING_NODE,
        activeDir: ACTIVE_NODE,
        selectedComponents: [],
        launcherPaths: {
          npx: NPX_PATH,
        },
        lastInstalledAt: '2026-04-22T08:00:00.000Z',
        lastRepairedAt: null,
        lastVerification: {
          verifiedAt: '2026-04-22T08:00:00.000Z',
          summary: 'node ready',
          launchers: {
            npx: NPX_PATH,
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
      expect(repaired.overallStatus).toBe(STATUS_OUTDATED)
    })
  })
})
