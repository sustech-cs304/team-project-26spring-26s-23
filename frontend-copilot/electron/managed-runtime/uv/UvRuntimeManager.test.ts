import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
const PYTHON_EXE = 'python.exe'
const UV_EXE = 'uv.exe'
const UVX_EXE = 'uvx.exe'
const PYTHON_VER_OUTPUT = 'Python 3.12.13'
const UV_VER_OUTPUT = 'uv 0.11.7'
const UVX_VER_OUTPUT = 'uvx 0.11.7 (9d177269e 2026-04-15 x86_64-pc-windows-msvc)'
const UVX_LINUX_OUTPUT = 'uvx 0.11.7 (9d177269e 2026-04-15 x86_64-unknown-linux-gnu)'
const TEMP_PREFIX = 'candue-uv-'
const WRITE_STATE = 'writeState' as const

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

function makeDefaultCommandRunner() {
  return {
    run: vi.fn(async (command: string) => {
      if (command.endsWith(PYTHON_EXE) || command.endsWith('python3')) return PYTHON_VER_OUTPUT
      if (command.endsWith(UV_EXE)) return UV_VER_OUTPUT
      return UVX_VER_OUTPUT
    }),
  }
}

function makeDefaultArchiveExtractor(components: ReturnType<typeof resolveManagedRuntimeComponents>) {
  return {
    extract: vi.fn(async (_archiveFile: string, destinationDir: string) => {
      const component = destinationDir.endsWith(`${path.sep}python`)
        ? components.find((entry) => entry.component === 'python')
        : components.find((entry) => entry.component === 'uv')
      await createRuntimeLauncherFiles(destinationDir, component?.distribution.launcherRelativePaths ?? {})
    }),
  }
}

function makeDefaultDownloadClient(components: ReturnType<typeof resolveManagedRuntimeComponents>) {
  return {
    downloadToFile: vi.fn(async (_url: string, destinationFile: string) => {
      await createRuntimeLauncherFiles(path.dirname(destinationFile), { artifact: path.basename(destinationFile) })
    }),
    downloadText: createChecksumResponder(components),
  }
}

function makeLauncherPaths(versionDir: string) {
  return {
    python: path.join(versionDir, 'python', PYTHON_EXE),
    uv: path.join(versionDir, 'uv', UV_EXE),
    uvx: path.join(versionDir, 'uv', UVX_EXE),
  }
}

async function writeLauncherFixtures(versionDir: string) {
  await createRuntimeLauncherFiles(path.join(versionDir, 'python'), { python: PYTHON_EXE })
  await createRuntimeLauncherFiles(path.join(versionDir, 'uv'), { uv: UV_EXE, uvx: UVX_EXE })
}

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })))
})

describe('UvRuntimeManager - fresh install', () => {
  it('installs the staged python and uv toolchain and records verification output', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}runtime-`))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      downloadClient: makeDefaultDownloadClient(components),
      archiveExtractor: makeDefaultArchiveExtractor(components),
      commandRunner: makeDefaultCommandRunner(),
      clock: () => '2026-04-22T13:00:00.000Z',
    })

    const snapshot = await manager.installOrRepair('install')

    expect(snapshot.status).toBe('ready')
    expect(snapshot.activeVersion).toBe('python 3.12.13 + uv 0.11.7')
    expect(snapshot.launcherPaths.uv).toContain(UV_EXE)
  })

  it('installs and verifies the portable Python/uv toolchain on linux without falling back to system binaries', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}runtime-linux-`))
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
          if (command.endsWith(path.join('install', 'bin', 'python3'))) return PYTHON_VER_OUTPUT
          if (command.endsWith(path.join('uv', 'uv'))) return UV_VER_OUTPUT
          return UVX_LINUX_OUTPUT
        }),
      },
      clock: () => '2026-04-22T13:15:00.000Z',
    })

    const snapshot = await manager.installOrRepair('install')

    expect(snapshot.status).toBe('ready')
    expect(snapshot.launcherPaths.python).toContain(path.join('install', 'bin', 'python3'))
    expect(snapshot.launcherPaths.uvx).toContain(path.join('uv', 'uvx'))
  })
})

describe('UvRuntimeManager - repair', () => {
  it('supports repair retry after a failed verification without losing the previous active version', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}repair-`))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    let shouldFail = true
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      downloadClient: makeDefaultDownloadClient(components),
      archiveExtractor: makeDefaultArchiveExtractor(components),
      commandRunner: {
        run: vi.fn(async (command: string) => {
          if (shouldFail) {
            throw new Error('uvx verification failed')
          }
          if (command.endsWith(PYTHON_EXE) || command.endsWith('python3')) return PYTHON_VER_OUTPUT
          if (command.endsWith(UV_EXE)) return UV_VER_OUTPUT
          return UVX_VER_OUTPUT
        }),
      },
      clock: () => '2026-04-22T14:00:00.000Z',
    })

    await manager[WRITE_STATE]({
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
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}repair-writeback-`))
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
      downloadClient: makeDefaultDownloadClient(components),
      archiveExtractor: makeDefaultArchiveExtractor(components),
      commandRunner: makeDefaultCommandRunner(),
      clock: () => '2026-04-23T08:00:00.000Z',
    })

    await manager[WRITE_STATE]({
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
        launchers: makeLauncherPaths(oldVersionDir),
      },
      lastErrorSummary: null,
    })
    await writeLauncherFixtures(oldVersionDir)
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
    expect(reloaded.launcherPaths).toEqual(makeLauncherPaths(pinnedVersionDir))
  })

  it('preserves the previous outdated snapshot when repair fails before activation', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}repair-failure-preserve-`))
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
      downloadClient: makeDefaultDownloadClient(components),
      archiveExtractor: makeDefaultArchiveExtractor(components),
      commandRunner: {
        run: vi.fn(async () => {
          throw new Error('uvx verification failed before activation')
        }),
      },
      clock: () => '2026-04-23T08:15:00.000Z',
    })

    await manager[WRITE_STATE]({
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
        launchers: makeLauncherPaths(oldVersionDir),
      },
      lastErrorSummary: null,
    })
    await writeLauncherFixtures(oldVersionDir)
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
})

describe('UvRuntimeManager - version verification', () => {
  it('treats a verified non-pinned active version as runnable while still recommending an update', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}verified-old-version-`))
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
      commandRunner: makeDefaultCommandRunner(),
      clock: () => '2026-04-23T09:00:00.000Z',
    })

    await manager[WRITE_STATE]({
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
    await writeLauncherFixtures(oldVersionDir)

    const snapshot = await manager.loadSnapshot()

    expect(snapshot.status).toBe('ready')
    expect(snapshot.activeVersion).toBe(oldVersion)
    expect(snapshot.updateRecommended).toBe(true)
    expect(snapshot.lastVerification?.summary).toContain(PYTHON_VER_OUTPUT)
    expect(snapshot.launcherPaths).toEqual(makeLauncherPaths(oldVersionDir))
  })

  it('keeps a non-pinned active version broken when verification fails', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}broken-old-version-`))
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

    await manager[WRITE_STATE]({
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
    await writeLauncherFixtures(oldVersionDir)

    const snapshot = await manager.loadSnapshot()

    expect(snapshot.status).toBe('broken')
    expect(snapshot.activeVersion).toBe(oldVersion)
    expect(snapshot.updateRecommended).toBe(true)
    expect(snapshot.lastErrorSummary?.code).toBe('verification_failed')
  })
})

describe('UvRuntimeManager - incomplete directory handling', () => {
  it('marks an active version broken when the pinned version directory is incomplete', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}broken-active-`))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const versionDir = path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion))
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      commandRunner: makeDefaultCommandRunner(),
      clock: () => '2026-04-23T10:30:00.000Z',
    })

    await manager[WRITE_STATE]({
      schemaVersion: 1,
      family: 'uv',
      pinnedVersion: manifest.pinnedVersion,
      status: 'ready',
      activeVersion: manifest.pinnedVersion,
      lastInstalledAt: '2026-04-22T09:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: {
        verifiedAt: '2026-04-22T09:00:00.000Z',
        summary: 'previously verified',
        launchers: makeLauncherPaths(versionDir),
      },
      lastErrorSummary: null,
    })
    await createRuntimeLauncherFiles(path.join(versionDir, 'python'), { python: PYTHON_EXE })
    await writeFile(paths.activePointerFile, JSON.stringify({ activeVersion: manifest.pinnedVersion }, null, 2))

    const snapshot = await manager.loadSnapshot()

    expect(snapshot.status).toBe('broken')
    expect(snapshot.activeVersion).toBe(manifest.pinnedVersion)
    expect(snapshot.lastErrorSummary?.code).toBe('verification_failed')
    expect(snapshot.lastErrorSummary?.message).toContain(UV_EXE)
    expect(snapshot.lastVerification?.summary).toBe('previously verified')
  })

  it('repairs an incomplete pinned version directory in a single repair run', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}self-heal-`))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const versionDir = path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion))
    const markerFile = path.join(versionDir, 'uv', 'stale.txt')
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      downloadClient: makeDefaultDownloadClient(components),
      archiveExtractor: makeDefaultArchiveExtractor(components),
      commandRunner: makeDefaultCommandRunner(),
      clock: () => '2026-04-23T10:45:00.000Z',
    })

    await manager[WRITE_STATE]({
      schemaVersion: 1,
      family: 'uv',
      pinnedVersion: manifest.pinnedVersion,
      status: 'broken',
      activeVersion: manifest.pinnedVersion,
      lastInstalledAt: '2026-04-22T09:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: { code: 'verification_failed', message: `missing ${UV_EXE}`, at: '2026-04-23T10:30:00.000Z' },
    })
    await createRuntimeLauncherFiles(path.join(versionDir, 'python'), { python: PYTHON_EXE })
    await createRuntimeLauncherFiles(path.join(versionDir, 'uv'), { uv: UV_EXE })
    await writeFile(markerFile, 'stale')

    const repaired = await manager.installOrRepair('repair')
    const activePointer = JSON.parse(await readFile(paths.activePointerFile, 'utf8')) as { activeVersion: string }

    expect(repaired.status).toBe('ready')
    expect(repaired.activeVersion).toBe(manifest.pinnedVersion)
    expect(repaired.lastRepairedAt).toBe('2026-04-23T10:45:00.000Z')
    expect(activePointer.activeVersion).toBe(manifest.pinnedVersion)
    await expect(access(path.join(versionDir, 'uv', UV_EXE))).resolves.toBeUndefined()
    await expect(access(path.join(versionDir, 'uv', UVX_EXE))).resolves.toBeUndefined()
    await expect(access(path.join(versionDir, 'python', PYTHON_EXE))).resolves.toBeUndefined()
    await expect(access(markerFile)).rejects.toThrow()
  })
})

describe('UvRuntimeManager - recovery', () => {
  it('keeps an already installed runtime ready while snapshot verification succeeds offline', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}offline-ready-`))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const versionDir = path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion))
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      commandRunner: makeDefaultCommandRunner(),
      clock: () => '2026-04-22T17:00:00.000Z',
    })

    await manager[WRITE_STATE]({
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
        launchers: makeLauncherPaths(versionDir),
      },
      lastErrorSummary: null,
    })
    await writeLauncherFixtures(versionDir)

    const snapshot = await manager.loadSnapshot()

    expect(snapshot.status).toBe('ready')
    expect(snapshot.activeVersion).toBe(manifest.pinnedVersion)
    expect(snapshot.lastVerification?.summary).toContain(PYTHON_VER_OUTPUT)
  })

  it('recovers a broken snapshot back to ready when uvx banner verification succeeds', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}broken-recovery-`))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const versionDir = path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion))
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      commandRunner: makeDefaultCommandRunner(),
      clock: () => '2026-04-22T17:30:00.000Z',
    })

    await manager[WRITE_STATE]({
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
    await writeLauncherFixtures(versionDir)

    const snapshot = await manager.loadSnapshot()

    expect(snapshot.status).toBe('ready')
    expect(snapshot.lastErrorSummary).toBeNull()
    expect(snapshot.lastVerification?.summary).toContain('uvx 0.11.7')
  })
})

describe('UvRuntimeManager - launcher paths and staging', () => {
  it('verifies and exposes launcher paths from the sanitized version directory', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}sanitized-version-`))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const versionDir = path.join(paths.versionsDir, createVersionDirectoryName(manifest.pinnedVersion))
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      commandRunner: makeDefaultCommandRunner(),
      clock: () => '2026-04-22T18:30:00.000Z',
    })

    await manager[WRITE_STATE]({
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
    await writeLauncherFixtures(versionDir)

    const snapshot = await manager.loadSnapshot()

    const expectedPaths = makeLauncherPaths(versionDir)
    expect(snapshot.status).toBe('ready')
    expect(snapshot.lastVerification?.launchers).toEqual(expectedPaths)
    expect(snapshot.launcherPaths).toEqual(expectedPaths)
  })

  it('cleans staging on verification failure so no uvx launcher appears in the active directory', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}staging-clean-`))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const manifest = getManagedRuntimeFamilyManifest('uv')
    const components = resolveManagedRuntimeComponents('uv', { platform: 'win32', arch: 'x64' })
    const manager = new UvRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      downloadClient: makeDefaultDownloadClient(components),
      archiveExtractor: makeDefaultArchiveExtractor(components),
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
    await expect(access(path.join(paths.activeDir, UVX_EXE))).rejects.toThrow()
  })
})
