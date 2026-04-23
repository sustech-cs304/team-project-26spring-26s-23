import { describe, expect, it } from 'vitest'

import { resolveManagedRuntimeLauncher } from './command-resolution'
import type { ManagedRuntimeSnapshot } from './types'

const originalPlatform = process.platform

describe('resolveManagedRuntimeLauncher', () => {
  it('rewrites npx to the managed Node/npm launcher', () => {
    const snapshot = createSnapshot({
      node: { status: 'ready', launcherPaths: { npx: 'D:/managed/node/npx.cmd' } },
    })

    const result = resolveManagedRuntimeLauncher(snapshot, 'npx')

    expect(result).toMatchObject({
      ok: true,
      command: 'npx',
      normalizedCommand: 'npx',
      family: 'node',
      executablePath: 'D:/managed/node/npx.cmd',
    })
  })

  it('rewrites uvx to the managed Python/uv launcher', () => {
    const snapshot = createSnapshot({
      uv: { status: 'ready', launcherPaths: { uvx: 'D:/managed/uv/uvx.exe' } },
    })

    const result = resolveManagedRuntimeLauncher(snapshot, 'uvx')

    expect(result).toMatchObject({
      ok: true,
      command: 'uvx',
      normalizedCommand: 'uvx',
      family: 'uv',
      executablePath: 'D:/managed/uv/uvx.exe',
      windowsCommandChain: null,
    })
  })

  it('allows uvx when Python/uv is verified runnable but update is still recommended', () => {
    const snapshot = createSnapshot({
      uv: {
        status: 'outdated',
        activeVersion: '0.10.0',
        updateRecommended: true,
        launcherPaths: { uvx: 'D:/managed/uv/compat/uvx.exe' },
      },
    })

    const result = resolveManagedRuntimeLauncher(snapshot, 'uvx')

    expect(result).toMatchObject({
      ok: true,
      command: 'uvx',
      normalizedCommand: 'uvx',
      family: 'uv',
      executablePath: 'D:/managed/uv/compat/uvx.exe',
      windowsCommandChain: null,
    })
  })

  it('returns a managed runtime unavailable error when the required runtime is missing or broken', () => {
    const missingSnapshot = createSnapshot({
      node: { status: 'missing', launcherPaths: {} },
    })
    const brokenSnapshot = createSnapshot({
      uv: {
        status: 'broken',
        launcherPaths: {},
        lastErrorSummary: {
          code: 'verification_failed',
          message: 'uvx verification failed',
          at: '2026-04-22T10:00:00.000Z',
        },
      },
    })

    expect(resolveManagedRuntimeLauncher(missingSnapshot, 'npx')).toMatchObject({
      ok: false,
      reason: 'managed_runtime_unavailable',
      family: 'node',
      status: 'missing',
      message: expect.stringContaining('install is required'),
    })
    expect(resolveManagedRuntimeLauncher(brokenSnapshot, 'uvx')).toMatchObject({
      ok: false,
      reason: 'managed_runtime_unavailable',
      family: 'uv',
      status: 'broken',
      detail: 'uvx verification failed',
    })
  })

  it('keeps blocking managed launchers when the launcher path cannot be resolved', () => {
    const outdatedUvSnapshot = createSnapshot({
      uv: {
        status: 'outdated',
        activeVersion: '0.10.0',
        updateRecommended: true,
        launcherPaths: {},
      },
    })

    expect(resolveManagedRuntimeLauncher(outdatedUvSnapshot, 'uvx')).toMatchObject({
      ok: false,
      reason: 'managed_runtime_unavailable',
      command: 'uvx',
      normalizedCommand: 'uvx',
      family: 'uv',
      status: 'outdated',
    })
  })

  it('keeps absolute paths and unmanaged commands untouched', () => {
    const snapshot = createSnapshot({
      node: { status: 'missing', launcherPaths: {} },
    })

    expect(resolveManagedRuntimeLauncher(snapshot, 'C:/custom/tools/npx.exe')).toEqual({
      ok: false,
      reason: 'unmanaged_command',
      command: 'C:/custom/tools/npx.exe',
    })
    expect(resolveManagedRuntimeLauncher(snapshot, 'node')).toEqual({
      ok: false,
      reason: 'unmanaged_command',
      command: 'node',
    })
    expect(resolveManagedRuntimeLauncher(snapshot, 'npx')).toMatchObject({
      ok: false,
      reason: 'managed_runtime_unavailable',
      command: 'npx',
      normalizedCommand: 'npx',
      family: 'node',
      status: 'missing',
      message: expect.stringContaining('install is required'),
    })
  })

  it('uses a Windows cmd wrapper for managed .cmd launchers', () => {
    const snapshot = createSnapshot({
      node: { status: 'ready', launcherPaths: { npx: 'D:/managed/node/npx.cmd' } },
    })
    const originalComSpec = process.env.ComSpec
    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env.ComSpec = 'C:/Windows/System32/cmd.exe'

    const result = resolveManagedRuntimeLauncher(snapshot, 'npx')

    expect(result).toMatchObject({
      ok: true,
      windowsCommandChain: {
        command: 'C:/Windows/System32/cmd.exe',
        argsPrefix: ['/d', '/s', '/c', 'D:/managed/node/npx.cmd'],
      },
    })

    Object.defineProperty(process, 'platform', { value: originalPlatform })
    if (originalComSpec === undefined) {
      delete process.env.ComSpec
    } else {
      process.env.ComSpec = originalComSpec
    }
  })
})

function createSnapshot(overrides?: {
  node?: Partial<ManagedRuntimeSnapshot['families']['node']>
  uv?: Partial<ManagedRuntimeSnapshot['families']['uv']>
}): ManagedRuntimeSnapshot {
  return {
    manifestVersion: 1,
    overallStatus: 'ready',
    target: { platform: 'win32', arch: 'x64' },
    rootDir: 'D:/managed-runtime',
    hostedRuntimeRootDir: 'D:/desktop-runtime',
    families: {
      node: {
        family: 'node',
        status: 'ready',
        pinnedVersion: '24.15.0',
        activeVersion: '24.15.0',
        installRootDir: 'D:/managed-runtime/node/versions',
        stagingDir: 'D:/managed-runtime/node/staging',
        activeDir: 'D:/managed-runtime/node/active',
        selectedComponents: [],
        launcherPaths: {},
        lastInstalledAt: null,
        lastRepairedAt: null,
        lastVerification: null,
        lastErrorSummary: null,
        ...overrides?.node,
      },
      uv: {
        family: 'uv',
        status: 'ready',
        pinnedVersion: '0.11.7',
        activeVersion: '0.11.7',
        installRootDir: 'D:/managed-runtime/uv/versions',
        stagingDir: 'D:/managed-runtime/uv/staging',
        activeDir: 'D:/managed-runtime/uv/active',
        selectedComponents: [],
        launcherPaths: {},
        lastInstalledAt: null,
        lastRepairedAt: null,
        lastVerification: null,
        lastErrorSummary: null,
        ...overrides?.uv,
      },
    },
  }
}
