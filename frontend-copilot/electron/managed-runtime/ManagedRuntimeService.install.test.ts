import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHostedRuntimePaths } from '../runtime/runtime-paths'
import { createManagedRuntimeService } from './ManagedRuntimeService'
import type { ManagedRuntimeFamilySnapshot } from './types'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })))
})

describe('ManagedRuntimeService install orchestration', () => {
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

    const installSpy = vi.spyOn(service, 'loadSnapshot')
    const first = service.installOrRepairAll('install')
    const second = service.installOrRepairAll('install')

    await Promise.resolve()
    deferred.resolve()

    await Promise.allSettled([first, second])

    expect(first).toBe(second)
    expect(installSpy).toHaveBeenCalled()
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
