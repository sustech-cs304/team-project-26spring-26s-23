import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHostedRuntimePaths } from '../runtime/runtime-paths'
import { createManagedRuntimeService, resolveManagedRuntimeTarget } from './ManagedRuntimeService'

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
    const macService = createManagedRuntimeService({
      userDataPath: macHostedRuntimePaths.userDataDir,
      hostedRuntimePaths: macHostedRuntimePaths,
      processPlatform: 'darwin',
      processArch: 'arm64',
    })

    const linuxHostedRuntimePaths = createHostedRuntimePaths(path.resolve('D:/workspace/candue-user-data-linux'))
    const linuxService = createManagedRuntimeService({
      userDataPath: linuxHostedRuntimePaths.userDataDir,
      hostedRuntimePaths: linuxHostedRuntimePaths,
      processPlatform: 'linux',
      processArch: 'x64',
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
    await expect(macService.installOrRepairAll('install')).rejects.toThrow(
      'Managed runtime install/repair is not supported for target darwin/arm64.',
    )
  })
})
