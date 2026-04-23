import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManagedRuntimeFamilyPaths } from '../ManagedRuntimePaths'
import { createVersionDirectoryName } from '../RuntimeInstallShared'
import { getManagedRuntimeFamilyManifest, resolveManagedRuntimeComponents } from '../runtime-manifest'
import { createRuntimeLauncherFiles } from '../test-support/runtime-install-fixtures'
import { UvRuntimeManager } from './UvRuntimeManager'

const FIXTURE_CONTENT = 'fixture'
const CHECKSUM = createHash('sha256').update(FIXTURE_CONTENT).digest('hex')

function createChecksumResponder(components: ReturnType<typeof resolveManagedRuntimeComponents>) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('SHA256SUMS')) {
      return components
        .map((component) => `${CHECKSUM}  ${component.distribution.fileName}`)
        .join('\n')
    }

    return `${CHECKSUM}  ${path.basename(url).replace(/\.sha256$/i, '')}`
  })
}

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })))
})

describe('UvRuntimeManager', () => {
  it('installs the staged python and uv toolchain and records verification output', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-uv-runtime-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      downloadClient: {
        downloadToFile: vi.fn(async (_url, destinationFile) => {
          await createRuntimeLauncherFiles(path.dirname(destinationFile), { artifact: path.basename(destinationFile) })
        }),
        downloadText: createChecksumResponder(components),
      },
      archiveExtractor: {
        extract: vi.fn(async (_archiveFile: string, destinationDir: string) => {
          const component = destinationDir.endsWith(`${path.sep}python`)
            ? components.find((entry) => entry.component === 'python')
            : components.find((entry) => entry.component === 'uv')
          await createRuntimeLauncherFiles(destinationDir, component?.distribution.launcherRelativePaths ?? {})
        }),
      },
      commandRunner: {
        run: vi.fn(async (command: string) => {
          if (command.endsWith('python.exe') || command.endsWith('python3')) return 'Python 3.12.13'
          if (command.endsWith('uv.exe')) return 'uv 0.11.7'
          return 'uvx 0.11.7 (9d177269e 2026-04-15 x86_64-pc-windows-msvc)'
        }),
      },
      clock: () => '2026-04-22T13:00:00.000Z',
    })

    const snapshot = await manager.installOrRepair('install')

    expect(snapshot.status).toBe('ready')
    expect(snapshot.activeVersion).toBe('python 3.12.13 + uv 0.11.7')
    expect(snapshot.launcherPaths.uv).toContain('uv.exe')
  })

  it('installs and verifies the portable Python/uv toolchain on linux without falling back to system binaries', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-uv-runtime-linux-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'linux', arch: 'x64' })
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      downloadClient: {
        downloadToFile: vi.fn(async (_url, destinationFile) => {
          await createRuntimeLauncherFiles(path.dirname(destinationFile), { artifact: path.basename(destinationFile) })
        }),
        downloadText: createChecksumResponder(components),
      },
      archiveExtractor: {
        extract: vi.fn(async (_archiveFile: string, destinationDir: string) => {
          const component = destinationDir.endsWith(`${path.sep}python`)
            ? components.find((entry) => entry.component === 'python')
            : components.find((entry) => entry.component === 'uv')
          await createRuntimeLauncherFiles(destinationDir, component?.distribution.launcherRelativePaths ?? {})
        }),
      },
      commandRunner: {
        run: vi.fn(async (command: string) => {
          if (command.endsWith(path.join('install', 'bin', 'python3'))) return 'Python 3.12.13'
          if (command.endsWith(path.join('uv', 'uv'))) return 'uv 0.11.7'
          return 'uvx 0.11.7 (9d177269e 2026-04-15 x86_64-unknown-linux-gnu)'
        }),
      },
      clock: () => '2026-04-22T13:15:00.000Z',
    })

    const snapshot = await manager.installOrRepair('install')

    expect(snapshot.status).toBe('ready')
    expect(snapshot.launcherPaths.python).toContain(path.join('install', 'bin', 'python3'))
    expect(snapshot.launcherPaths.uvx).toContain(path.join('uv', 'uvx'))
  })

  it('supports repair retry after a failed verification without losing the previous active version', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-uv-repair-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    let shouldFail = true
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      downloadClient: {
        downloadToFile: vi.fn(async (_url, destinationFile) => {
          await createRuntimeLauncherFiles(path.dirname(destinationFile), { artifact: path.basename(destinationFile) })
        }),
        downloadText: createChecksumResponder(components),
      },
      archiveExtractor: {
        extract: vi.fn(async (_archiveFile: string, destinationDir: string) => {
          const component = destinationDir.endsWith(`${path.sep}python`)
            ? components.find((entry) => entry.component === 'python')
            : components.find((entry) => entry.component === 'uv')
          await createRuntimeLauncherFiles(destinationDir, component?.distribution.launcherRelativePaths ?? {})
        }),
      },
      commandRunner: {
        run: vi.fn(async (command: string) => {
          if (shouldFail) {
            throw new Error('uvx verification failed')
          }
          if (command.endsWith('python.exe') || command.endsWith('python3')) return 'Python 3.12.13'
          if (command.endsWith('uv.exe')) return 'uv 0.11.7'
          return 'uvx 0.11.7 (9d177269e 2026-04-15 x86_64-pc-windows-msvc)'
        }),
      },
      clock: () => '2026-04-22T14:00:00.000Z',
    })

    await manager['writeState']({
      schemaVersion: 1,
      family: 'uv',
      pinnedVersion: manifest.pinnedVersion,
      status: 'ready',
      activeVersion: manifest.pinnedVersion,
      lastInstalledAt: '2026-04-22T09:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    })

    const failed = await manager.installOrRepair('repair')
    shouldFail = false
    const repaired = await manager.installOrRepair('repair')

    expect(failed.status).toBe('broken')
    expect(failed.activeVersion).toBe(manifest.pinnedVersion)
    expect(repaired.status).toBe('ready')
    expect(repaired.lastRepairedAt).toBe('2026-04-22T14:00:00.000Z')
  })

  it('switches an outdated install to the pinned version after a successful repair and subsequent load', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-uv-repair-writeback-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const oldVersion = 'python 3.12.10 + uv 0.11.7'
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const oldVersionDir = path.join(paths.versionsDir, createVersionDirectoryName(oldVersion))
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      downloadClient: {
        downloadToFile: vi.fn(async (_url, destinationFile) => {
          await createRuntimeLauncherFiles(path.dirname(destinationFile), { artifact: path.basename(destinationFile) })
        }),
        downloadText: createChecksumResponder(components),
      },
      archiveExtractor: {
        extract: vi.fn(async (_archiveFile: string, destinationDir: string) => {
          const component = destinationDir.endsWith(`${path.sep}python`)
            ? components.find((entry) => entry.component === 'python')
            : components.find((entry) => entry.component === 'uv')
          await createRuntimeLauncherFiles(destinationDir, component?.distribution.launcherRelativePaths ?? {})
        }),
      },
      commandRunner: {
        run: vi.fn(async (command: string) => {
          if (command.endsWith('python.exe') || command.endsWith('python3')) return 'Python 3.12.13'
          if (command.endsWith('uv.exe')) return 'uv 0.11.7'
          return 'uvx 0.11.7 (9d177269e 2026-04-15 x86_64-pc-windows-msvc)'
        }),
      },
      clock: () => '2026-04-23T08:00:00.000Z',
    })

    await manager['writeState']({
      schemaVersion: 1,
      family: 'uv',
      pinnedVersion: oldVersion,
      status: 'ready',
      activeVersion: oldVersion,
      lastInstalledAt: '2026-04-22T08:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: {
        verifiedAt: '2026-04-22T08:00:00.000Z',
        summary: 'old version still active',
        launchers: {
          python: path.join(oldVersionDir, 'python', 'install', 'python.exe'),
          uv: path.join(oldVersionDir, 'uv', 'uv.exe'),
          uvx: path.join(oldVersionDir, 'uv', 'uvx.exe'),
        },
      },
      lastErrorSummary: null,
    })
    await createRuntimeLauncherFiles(path.join(oldVersionDir, 'python'), { python: 'install/python.exe' })
    await createRuntimeLauncherFiles(path.join(oldVersionDir, 'uv'), { uv: 'uv.exe', uvx: 'uvx.exe' })
    const outdated = await manager.loadSnapshot()

    expect(outdated.status).toBe('ready')
    expect(outdated.activeVersion).toBe(oldVersion)
    expect(outdated.updateRecommended).toBe(true)

    const repaired = await manager.installOrRepair('repair')
    const reloaded = await manager.loadSnapshot()
    const activePointer = JSON.parse(await readFile(paths.activePointerFile, 'utf8')) as { activeVersion: string }
    const pinnedVersionDir = path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion))

    expect(repaired.status).toBe('ready')
    expect(repaired.activeVersion).toBe(manifest.pinnedVersion)
    expect(repaired.launcherPaths.python).toContain(createVersionDirectoryName(manifest.pinnedVersion))
    expect(activePointer.activeVersion).toBe(manifest.pinnedVersion)
    expect(reloaded.status).toBe('ready')
    expect(reloaded.activeVersion).toBe(manifest.pinnedVersion)
    expect(reloaded.updateRecommended).toBe(false)
    expect(reloaded.launcherPaths).toEqual({
      python: path.join(pinnedVersionDir, 'python', 'install', 'python.exe'),
      uv: path.join(pinnedVersionDir, 'uv', 'uv.exe'),
      uvx: path.join(pinnedVersionDir, 'uv', 'uvx.exe'),
    })
  })

  it('preserves the previous outdated snapshot when repair fails before activation', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-uv-repair-failure-preserve-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const oldVersion = 'python 3.12.10 + uv 0.11.7'
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const oldVersionDir = path.join(paths.versionsDir, createVersionDirectoryName(oldVersion))
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      downloadClient: {
        downloadToFile: vi.fn(async (_url, destinationFile) => {
          await createRuntimeLauncherFiles(path.dirname(destinationFile), { artifact: path.basename(destinationFile) })
        }),
        downloadText: createChecksumResponder(components),
      },
      archiveExtractor: {
        extract: vi.fn(async (_archiveFile: string, destinationDir: string) => {
          const component = destinationDir.endsWith(`${path.sep}python`)
            ? components.find((entry) => entry.component === 'python')
            : components.find((entry) => entry.component === 'uv')
          await createRuntimeLauncherFiles(destinationDir, component?.distribution.launcherRelativePaths ?? {})
        }),
      },
      commandRunner: {
        run: vi.fn(async () => {
          throw new Error('uvx verification failed before activation')
        }),
      },
      clock: () => '2026-04-23T08:15:00.000Z',
    })

    await manager['writeState']({
      schemaVersion: 1,
      family: 'uv',
      pinnedVersion: oldVersion,
      status: 'ready',
      activeVersion: oldVersion,
      lastInstalledAt: '2026-04-22T08:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: {
        verifiedAt: '2026-04-22T08:00:00.000Z',
        summary: 'old version still active',
        launchers: {
          python: path.join(oldVersionDir, 'python', 'install', 'python.exe'),
          uv: path.join(oldVersionDir, 'uv', 'uv.exe'),
          uvx: path.join(oldVersionDir, 'uv', 'uvx.exe'),
        },
      },
      lastErrorSummary: null,
    })
    await createRuntimeLauncherFiles(path.join(oldVersionDir, 'python'), { python: 'install/python.exe' })
    await createRuntimeLauncherFiles(path.join(oldVersionDir, 'uv'), { uv: 'uv.exe', uvx: 'uvx.exe' })
    await manager.loadSnapshot()

    const failed = await manager.installOrRepair('repair')
    const reloaded = await manager.loadSnapshot()

    expect(failed.status).toBe('broken')
    expect(failed.activeVersion).toBe(oldVersion)
    expect(failed.lastErrorSummary?.code).toBe('verification_failed')
    expect(reloaded.status).toBe('broken')
    expect(reloaded.activeVersion).toBe(oldVersion)
    expect(reloaded.updateRecommended).toBe(true)
  })

  it('treats a verified non-pinned active version as runnable while still recommending an update', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-uv-verified-old-version-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const oldVersion = 'python 3.12.10 + uv 0.11.7'
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const oldVersionDir = path.join(paths.versionsDir, createVersionDirectoryName(oldVersion))
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      commandRunner: {
        run: vi.fn(async (command: string) => {
          if (command.endsWith('python.exe') || command.endsWith('python3')) return 'Python 3.12.13'
          if (command.endsWith('uv.exe')) return 'uv 0.11.7'
          return 'uvx 0.11.7 (9d177269e 2026-04-15 x86_64-pc-windows-msvc)'
        }),
      },
      clock: () => '2026-04-23T09:00:00.000Z',
    })

    await manager['writeState']({
      schemaVersion: 1,
      family: 'uv',
      pinnedVersion: oldVersion,
      status: 'ready',
      activeVersion: oldVersion,
      lastInstalledAt: '2026-04-22T08:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    })
    await createRuntimeLauncherFiles(path.join(oldVersionDir, 'python'), { python: 'install/python.exe' })
    await createRuntimeLauncherFiles(path.join(oldVersionDir, 'uv'), { uv: 'uv.exe', uvx: 'uvx.exe' })

    const snapshot = await manager.loadSnapshot()

    expect(snapshot.status).toBe('ready')
    expect(snapshot.activeVersion).toBe(oldVersion)
    expect(snapshot.updateRecommended).toBe(true)
    expect(snapshot.lastVerification?.summary).toContain('Python 3.12.13')
    expect(snapshot.launcherPaths).toEqual({
      python: path.join(oldVersionDir, 'python', 'install', 'python.exe'),
      uv: path.join(oldVersionDir, 'uv', 'uv.exe'),
      uvx: path.join(oldVersionDir, 'uv', 'uvx.exe'),
    })
  })

  it('keeps a non-pinned active version broken when verification fails', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-uv-broken-old-version-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const oldVersion = 'python 3.12.10 + uv 0.11.7'
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const oldVersionDir = path.join(paths.versionsDir, createVersionDirectoryName(oldVersion))
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      commandRunner: {
        run: vi.fn(async () => {
          throw new Error('uvx verification failed')
        }),
      },
      clock: () => '2026-04-23T09:15:00.000Z',
    })

    await manager['writeState']({
      schemaVersion: 1,
      family: 'uv',
      pinnedVersion: oldVersion,
      status: 'ready',
      activeVersion: oldVersion,
      lastInstalledAt: '2026-04-22T08:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    })
    await createRuntimeLauncherFiles(path.join(oldVersionDir, 'python'), { python: 'install/python.exe' })
    await createRuntimeLauncherFiles(path.join(oldVersionDir, 'uv'), { uv: 'uv.exe', uvx: 'uvx.exe' })

    const snapshot = await manager.loadSnapshot()

    expect(snapshot.status).toBe('broken')
    expect(snapshot.activeVersion).toBe(oldVersion)
    expect(snapshot.updateRecommended).toBe(true)
    expect(snapshot.lastErrorSummary?.code).toBe('verification_failed')
  })

  it('keeps an already installed runtime ready while snapshot verification succeeds offline', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-uv-offline-ready-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      commandRunner: {
        run: vi.fn(async (command: string) => {
          if (command.endsWith('python.exe') || command.endsWith('python3')) return 'Python 3.12.13'
          if (command.endsWith('uv.exe')) return 'uv 0.11.7'
          return 'uvx 0.11.7 (9d177269e 2026-04-15 x86_64-pc-windows-msvc)'
        }),
      },
      clock: () => '2026-04-22T17:00:00.000Z',
    })

    await manager['writeState']({
      schemaVersion: 1,
      family: 'uv',
      pinnedVersion: manifest.pinnedVersion,
      status: 'ready',
      activeVersion: manifest.pinnedVersion,
      lastInstalledAt: '2026-04-22T09:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: {
        verifiedAt: '2026-04-22T09:00:00.000Z',
        summary: 'offline active verification',
        launchers: {
          python: path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion), 'python', 'install', 'python.exe'),
          uv: path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion), 'uv', 'uv.exe'),
          uvx: path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion), 'uv', 'uvx.exe'),
        },
      },
      lastErrorSummary: null,
    })
    await createRuntimeLauncherFiles(path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion), 'python'), { python: 'install/python.exe' })
    await createRuntimeLauncherFiles(path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion), 'uv'), { uv: 'uv.exe', uvx: 'uvx.exe' })

    const snapshot = await manager.loadSnapshot()

    expect(snapshot.status).toBe('ready')
    expect(snapshot.activeVersion).toBe(manifest.pinnedVersion)
    expect(snapshot.lastVerification?.summary).toContain('Python 3.12.13')
  })

  it('recovers a broken snapshot back to ready when uvx banner verification succeeds', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-uv-broken-recovery-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      commandRunner: {
        run: vi.fn(async (command: string) => {
          if (command.endsWith('python.exe') || command.endsWith('python3')) return 'Python 3.12.13'
          if (command.endsWith('uv.exe')) return 'uv 0.11.7'
          return 'uvx 0.11.7 (9d177269e 2026-04-15 x86_64-pc-windows-msvc)'
        }),
      },
      clock: () => '2026-04-22T17:30:00.000Z',
    })

    await manager['writeState']({
      schemaVersion: 1,
      family: 'uv',
      pinnedVersion: manifest.pinnedVersion,
      status: 'broken',
      activeVersion: manifest.pinnedVersion,
      lastInstalledAt: '2026-04-22T09:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: {
        code: 'verification_failed',
        message: 'Launcher uvx returned malformed version output: uvx 0.11.7 (...)',
        at: '2026-04-22T09:30:00.000Z',
      },
    })
    await createRuntimeLauncherFiles(path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion), 'python'), { python: 'install/python.exe' })
    await createRuntimeLauncherFiles(path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion), 'uv'), { uv: 'uv.exe', uvx: 'uvx.exe' })

    const snapshot = await manager.loadSnapshot()

    expect(snapshot.status).toBe('ready')
    expect(snapshot.lastErrorSummary).toBeNull()
    expect(snapshot.lastVerification?.summary).toContain('uvx 0.11.7')
  })

  it('verifies and exposes launcher paths from the sanitized version directory', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-uv-sanitized-version-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const versionDir = path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion))
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      commandRunner: {
        run: vi.fn(async (command: string) => {
          if (command.endsWith('python.exe') || command.endsWith('python3')) return 'Python 3.12.13'
          if (command.endsWith('uv.exe')) return 'uv 0.11.7'
          return 'uvx 0.11.7 (9d177269e 2026-04-15 x86_64-pc-windows-msvc)'
        }),
      },
      clock: () => '2026-04-22T18:30:00.000Z',
    })

    await manager['writeState']({
      schemaVersion: 1,
      family: 'uv',
      pinnedVersion: manifest.pinnedVersion,
      status: 'ready',
      activeVersion: manifest.pinnedVersion,
      lastInstalledAt: '2026-04-22T18:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    })
    await createRuntimeLauncherFiles(path.join(versionDir, 'python'), { python: 'install/python.exe' })
    await createRuntimeLauncherFiles(path.join(versionDir, 'uv'), { uv: 'uv.exe', uvx: 'uvx.exe' })

    const snapshot = await manager.loadSnapshot()

    expect(snapshot.status).toBe('ready')
    expect(snapshot.lastVerification?.launchers).toEqual({
      python: path.join(versionDir, 'python', 'install', 'python.exe'),
      uv: path.join(versionDir, 'uv', 'uv.exe'),
      uvx: path.join(versionDir, 'uv', 'uvx.exe'),
    })
    expect(snapshot.launcherPaths).toEqual({
      python: path.join(versionDir, 'python', 'install', 'python.exe'),
      uv: path.join(versionDir, 'uv', 'uv.exe'),
      uvx: path.join(versionDir, 'uv', 'uvx.exe'),
    })
  })

  it('cleans staging on verification failure so no uvx launcher appears in the active directory', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-uv-staging-clean-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      downloadClient: {
        downloadToFile: vi.fn(async (_url, destinationFile) => {
          await createRuntimeLauncherFiles(path.dirname(destinationFile), { artifact: path.basename(destinationFile) })
        }),
        downloadText: createChecksumResponder(components),
      },
      archiveExtractor: {
        extract: vi.fn(async (_archiveFile: string, destinationDir: string) => {
          const component = destinationDir.endsWith(`${path.sep}python`)
            ? components.find((entry) => entry.component === 'python')
            : components.find((entry) => entry.component === 'uv')
          await createRuntimeLauncherFiles(destinationDir, component?.distribution.launcherRelativePaths ?? {})
        }),
      },
      commandRunner: {
        run: vi.fn(async () => {
          throw new Error('uvx verification failed before activation')
        }),
      },
      clock: () => '2026-04-22T18:00:00.000Z',
    })

    const snapshot = await manager.installOrRepair('install')

    expect(snapshot.status).toBe('broken')
    expect(snapshot.activeVersion).toBeNull()
    expect(snapshot.lastErrorSummary?.code).toBe('verification_failed')
    await expect(access(path.join(paths.activeDir, 'uvx.exe'))).rejects.toThrow()
  })
})
