import { describe, expect, it } from 'vitest'
import { resolveManagedRuntimeDownloadSource } from './download-source'
import { resolveManagedRuntimeComponents } from './runtime-manifest'

describe('resolveManagedRuntimeDownloadSource', () => {
  it('normalizes channel and artifact data for later installers', () => {
    const [nodeComponent] = resolveManagedRuntimeComponents('node', { platform: 'win32', arch: 'x64' })
    const uvComponents = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'arm64' })
    const uvComponent = uvComponents.find((entry) => entry.component === 'uv')

    expect(resolveManagedRuntimeDownloadSource(nodeComponent!)).toMatchObject({
      component: 'node',
      fileName: 'node-v24.15.0-win-x64.zip',
      archiveFormat: 'zip',
      installStrategy: 'portable-archive',
      channel: {
        channelId: 'nodejs-dist',
      },
    })

    expect(resolveManagedRuntimeDownloadSource(uvComponent!)).toMatchObject({
      component: 'uv',
      fileName: 'uv-aarch64-pc-windows-msvc.zip',
      archiveFormat: 'zip',
      checksumUrl: 'https://github.com/astral-sh/uv/releases/download/0.11.7/uv-aarch64-pc-windows-msvc.zip.sha256',
    })
  })

  it('preserves manifest-declared planned assets for unsupported follow-up install actions', () => {
    const uvComponents = resolveManagedRuntimeComponents('uv', { platform: 'darwin', arch: 'arm64' })
    const pythonComponent = uvComponents.find((entry) => entry.component === 'python')

    expect(resolveManagedRuntimeDownloadSource(pythonComponent!)).toMatchObject({
      component: 'python',
      fileName: 'python-3.12.10-macos-arm64.pkg',
      archiveFormat: 'pkg',
      installStrategy: 'planned',
      url: null,
    })
  })

  it('resolves darwin and linux node artifacts from the managed manifest without falling back to system node', () => {
    const [darwinNode] = resolveManagedRuntimeComponents('node', { platform: 'darwin', arch: 'arm64' })
    const [linuxNode] = resolveManagedRuntimeComponents('node', { platform: 'linux', arch: 'x64' })

    expect(resolveManagedRuntimeDownloadSource(darwinNode!)).toMatchObject({
      component: 'node',
      target: { platform: 'darwin', arch: 'arm64' },
      fileName: 'node-v24.15.0-darwin-arm64.tar.gz',
      archiveFormat: 'tar.gz',
      url: 'https://nodejs.org/dist/v24.15.0/node-v24.15.0-darwin-arm64.tar.gz',
      checksumUrl: 'https://nodejs.org/dist/v24.15.0/SHASUMS256.txt',
    })

    expect(resolveManagedRuntimeDownloadSource(linuxNode!)).toMatchObject({
      component: 'node',
      target: { platform: 'linux', arch: 'x64' },
      fileName: 'node-v24.15.0-linux-x64.tar.xz',
      archiveFormat: 'tar.xz',
      url: 'https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.xz',
      checksumUrl: 'https://nodejs.org/dist/v24.15.0/SHASUMS256.txt',
    })
  })
})
