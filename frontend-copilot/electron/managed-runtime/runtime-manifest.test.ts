import { describe, expect, it } from 'vitest'
import {
  getManagedRuntimeFamilyManifest,
  getManagedRuntimeSourceChannel,
  isManagedRuntimeActionSupported,
  resolveManagedRuntimeComponentSelection,
  resolveManagedRuntimeComponents,
} from './runtime-manifest'

describe('managed runtime manifest', () => {
  it('pins official Node and uv versions and resolves the supported Windows package set', () => {
    const nodeFamily = getManagedRuntimeFamilyManifest('node')
    const uvFamily = getManagedRuntimeFamilyManifest('uv')

    expect(nodeFamily.pinnedVersion).toBe('24.15.0')
    expect(uvFamily.pinnedVersion).toBe('python 3.12.13 + uv 0.11.7')

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
    expect(uvComponents[0]?.distribution.fileName).toBe('cpython-3.12.13+20260414-aarch64-pc-windows-msvc-install_only_stripped.tar.gz')
    expect(uvComponents[0]?.distribution.installStrategy).toBe('portable-archive')
    expect(uvComponents[0]?.distribution.launcherRelativePaths).toEqual({
      python: 'python.exe',
    })
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
    expect(getManagedRuntimeSourceChannel('python-build-standalone')).toMatchObject({
      kind: 'github-release',
      owner: 'python',
    })
  })

  it('exports cross-platform target matrices while keeping unsupported actions manifest-driven', () => {
    const nodeFamily = getManagedRuntimeFamilyManifest('node')
    expect(nodeFamily.components[0]?.distributions).toHaveLength(6)

    const darwinNode = resolveManagedRuntimeComponents('node', { platform: 'darwin', arch: 'arm64' })
    expect(darwinNode[0]?.distribution.fileName).toBe('node-v24.15.0-darwin-arm64.tar.gz')
    expect(darwinNode[0]?.distribution.archiveFormat).toBe('tar.gz')
    expect(darwinNode[0]?.distribution.launcherRelativePaths).toEqual({
      node: 'bin/node',
      npm: 'bin/npm',
      npx: 'bin/npx',
    })

    const linuxNode = resolveManagedRuntimeComponents('node', { platform: 'linux', arch: 'x64' })
    expect(linuxNode[0]?.distribution.fileName).toBe('node-v24.15.0-linux-x64.tar.xz')
    expect(linuxNode[0]?.distribution.archiveFormat).toBe('tar.xz')
    expect(linuxNode[0]?.distribution.checksumUrl).toBe('https://nodejs.org/dist/v24.15.0/SHASUMS256.txt')

    const linuxUvSelection = resolveManagedRuntimeComponentSelection('uv', { platform: 'linux', arch: 'x64' })
    expect(linuxUvSelection.resolvedComponents.map((component) => component.component)).toEqual(['python', 'uv'])
    expect(linuxUvSelection.resolvedComponents[0]?.distribution.installStrategy).toBe('portable-archive')
    expect(linuxUvSelection.resolvedComponents[0]?.distribution.fileName).toBe('cpython-3.12.13+20260414-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz')
    expect(linuxUvSelection.resolvedComponents[1]?.distribution.fileName).toBe('uv-x86_64-unknown-linux-gnu.tar.gz')
    expect(isManagedRuntimeActionSupported('node', { platform: 'darwin', arch: 'arm64' })).toBe(true)
    expect(isManagedRuntimeActionSupported('node', { platform: 'linux', arch: 'x64' })).toBe(true)
    expect(isManagedRuntimeActionSupported('uv', { platform: 'linux', arch: 'x64' })).toBe(true)
  })
})
