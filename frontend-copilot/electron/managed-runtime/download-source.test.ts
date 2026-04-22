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
})
