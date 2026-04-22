import { describe, expect, it } from 'vitest'
import {
  getManagedRuntimeFamilyManifest,
  getManagedRuntimeSourceChannel,
  resolveManagedRuntimeComponents,
} from './runtime-manifest'

describe('managed runtime manifest', () => {
  it('pins official Node and uv versions and resolves the supported Windows package set', () => {
    const nodeFamily = getManagedRuntimeFamilyManifest('node')
    const uvFamily = getManagedRuntimeFamilyManifest('uv')

    expect(nodeFamily.pinnedVersion).toBe('24.15.0')
    expect(uvFamily.pinnedVersion).toBe('python 3.12.10 + uv 0.11.7')

    const nodeComponents = resolveManagedRuntimeComponents('node', { platform: 'win32', arch: 'x64' })
    expect(nodeComponents).toHaveLength(1)
    expect(nodeComponents[0]?.distribution.fileName).toBe('node-v24.15.0-win-x64.zip')
    expect(nodeComponents[0]?.distribution.launcherRelativePaths).toEqual({
      node: 'node.exe',
      npm: 'npm.cmd',
      npx: 'npx.cmd',
    })

    const uvComponents = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'arm64' })
    expect(uvComponents.map((component) => component.component)).toEqual(['python', 'uv'])
    expect(uvComponents[0]?.distribution.fileName).toBe('python-3.12.10-embed-arm64.zip')
    expect(uvComponents[0]?.distribution.installStrategy).toBe('portable-archive')
    expect(uvComponents[1]?.distribution.fileName).toBe('uv-aarch64-pc-windows-msvc.zip')
  })

  it('keeps source channel metadata centralized and addressable by channel id', () => {
    expect(getManagedRuntimeSourceChannel('nodejs-dist')).toMatchObject({
      kind: 'official-dist',
      owner: 'node',
    })
    expect(getManagedRuntimeSourceChannel('uv-github-release')).toMatchObject({
      kind: 'github-release',
      owner: 'uv',
    })
  })
})
