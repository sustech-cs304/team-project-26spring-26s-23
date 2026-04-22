import { access, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManagedRuntimeFamilyPaths } from '../ManagedRuntimePaths'
import { getManagedRuntimeFamilyManifest, resolveManagedRuntimeComponents } from '../runtime-manifest'
import { createRuntimeLauncherFiles } from '../test-support/runtime-install-fixtures'
import { UvRuntimeManager } from './UvRuntimeManager'

const FIXTURE_CONTENT = 'fixture'
const CHECKSUM = createHash('sha256').update(FIXTURE_CONTENT).digest('hex')

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
        downloadText: vi.fn(async (url: string) => `${CHECKSUM}  ${path.basename(url).replace(/\.sha256$/i, '')}`),
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
          if (command.endsWith('python.exe')) return 'Python 3.12.10'
          if (command.endsWith('uv.exe')) return 'uv 0.11.7'
          return '0.11.7'
        }),
      },
      clock: () => '2026-04-22T13:00:00.000Z',
    })

    const snapshot = await manager.installOrRepair('install')

    expect(snapshot.status).toBe('ready')
    expect(snapshot.activeVersion).toBe('python 3.12.10 + uv 0.11.7')
    expect(snapshot.launcherPaths.uv).toContain('uv.exe')
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
        downloadText: vi.fn(async (url: string) => `${CHECKSUM}  ${path.basename(url).replace(/\.sha256$/i, '')}`),
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
          if (command.endsWith('python.exe')) return 'Python 3.12.10'
          if (command.endsWith('uv.exe')) return 'uv 0.11.7'
          return '0.11.7'
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
          if (command.endsWith('python.exe')) return 'Python 3.12.10'
          if (command.endsWith('uv.exe')) return 'uv 0.11.7'
          return '0.11.7'
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
          python: path.join(paths.versionsDir, manifest.pinnedVersion, 'python', 'python.exe'),
          uv: path.join(paths.versionsDir, manifest.pinnedVersion, 'uv', 'uv.exe'),
          uvx: path.join(paths.versionsDir, manifest.pinnedVersion, 'uv', 'uvx.exe'),
        },
      },
      lastErrorSummary: null,
    })
    await createRuntimeLauncherFiles(path.join(paths.versionsDir, manifest.pinnedVersion, 'python'), { python: 'python.exe' })
    await createRuntimeLauncherFiles(path.join(paths.versionsDir, manifest.pinnedVersion, 'uv'), { uv: 'uv.exe', uvx: 'uvx.exe' })

    const snapshot = await manager.loadSnapshot()

    expect(snapshot.status).toBe('ready')
    expect(snapshot.activeVersion).toBe(manifest.pinnedVersion)
    expect(snapshot.lastVerification?.summary).toContain('Python 3.12.10')
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
        downloadText: vi.fn(async (url: string) => `${CHECKSUM}  ${path.basename(url).replace(/\.sha256$/i, '')}`),
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
    await expect(access(path.join(paths.activeDir, 'uvx.exe'))).rejects.toThrow()
  })
})
