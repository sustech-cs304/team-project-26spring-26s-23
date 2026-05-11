import { describe, expect, it } from 'vitest'

import { resolveManagedRuntimeLauncher } from './command-resolution'
import type { ManagedRuntimeSnapshot } from './types'

const originalPlatform = process.platform
const absoluteUnmanagedCommand = process.platform === 'win32'
  ? 'C:/custom/tools/npx.exe'
  : '/custom/tools/npx'

const NPX_LAUNCHER_PATH = 'D:/managed/node/npx.cmd'
const UVX_LAUNCHER_PATH = 'D:/managed/uv/uvx.exe'

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
        updateRecommended: false,
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
        updateRecommended: false,
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

describe('resolveManagedRuntimeLauncher - successful rewrites', () => {
  it('rewrites npx to the managed Node/npm launcher', () => {
    const snapshot = createSnapshot({
      node: { status: 'ready', launcherPaths: { npx: NPX_LAUNCHER_PATH } },
    })

    const result = resolveManagedRuntimeLauncher(snapshot, 'npx')

    expect(result).toMatchObject({
      ok: true,
      command: 'npx',
      normalizedCommand: 'npx',
      family: 'node',
      executablePath: NPX_LAUNCHER_PATH,
    })
  })

  it('rewrites uvx to the managed Python/uv launcher', () => {
    const snapshot = createSnapshot({
      uv: { status: 'ready', launcherPaths: { uvx: UVX_LAUNCHER_PATH } },
    })

    const result = resolveManagedRuntimeLauncher(snapshot, 'uvx')

    expect(result).toMatchObject({
      ok: true,
      command: 'uvx',
      normalizedCommand: 'uvx',
      family: 'uv',
      executablePath: UVX_LAUNCHER_PATH,
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
})

describe('resolveManagedRuntimeLauncher - managed runtime unavailable', () => {
  it('returns error when the required runtime is missing or broken', () => {
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

  it('blocks managed launchers when the launcher path cannot be resolved', () => {
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
})

describe('resolveManagedRuntimeLauncher - unmanaged commands', () => {
  it('keeps absolute paths untouched', () => {
    const snapshot = createSnapshot({
      node: { status: 'missing', launcherPaths: {} },
    })

    expect(resolveManagedRuntimeLauncher(snapshot, absoluteUnmanagedCommand)).toEqual({
      ok: false,
      reason: 'unmanaged_command',
      command: absoluteUnmanagedCommand,
    })
  })

  it('keeps unmanaged commands as unmanaged while surfacing managed runtime failures', () => {
    const snapshot = createSnapshot({
      node: { status: 'missing', launcherPaths: {} },
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
      detail: 'Managed runtime family node is not ready for launcher npx.',
    })
  })

  it.each([
    './npx',
    'tools/uvx',
    '..\\scripts\\npx.cmd',
    'bin/uvx',
  ])('treats commands with explicit path separators as unmanaged: %s', (command) => {
    const snapshot = createSnapshot({
      node: { status: 'ready', launcherPaths: { npx: NPX_LAUNCHER_PATH } },
      uv: { status: 'ready', launcherPaths: { uvx: UVX_LAUNCHER_PATH } },
    })

    expect(resolveManagedRuntimeLauncher(snapshot, command)).toEqual({
      ok: false,
      reason: 'unmanaged_command',
      command,
    })
  })
})

describe('resolveManagedRuntimeLauncher - Windows cmd wrapper', () => {
  it('uses a Windows cmd wrapper for managed .cmd launchers', () => {
    const snapshot = createSnapshot({
      node: { status: 'ready', launcherPaths: { npx: NPX_LAUNCHER_PATH } },
    })
    const originalComSpec = process.env.ComSpec
    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env.ComSpec = 'C:/Windows/System32/cmd.exe'

    const result = resolveManagedRuntimeLauncher(snapshot, 'npx')

    expect(result).toMatchObject({
      ok: true,
      windowsCommandChain: {
        command: 'C:/Windows/System32/cmd.exe',
        argsPrefix: ['/d', '/s', '/c', NPX_LAUNCHER_PATH],
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
