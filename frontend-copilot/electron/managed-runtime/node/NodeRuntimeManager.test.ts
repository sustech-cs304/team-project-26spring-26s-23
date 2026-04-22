import { mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManagedRuntimeFamilyPaths } from '../ManagedRuntimePaths'
import { getManagedRuntimeFamilyManifest, resolveManagedRuntimeComponents } from '../runtime-manifest'
import { createRuntimeLauncherFiles } from '../test-support/runtime-install-fixtures'
import { NodeRuntimeManager } from './NodeRuntimeManager'

const FIXTURE_CONTENT = 'fixture'
const CHECKSUM = createHash('sha256').update(FIXTURE_CONTENT).digest('hex')

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })))
})

describe('NodeRuntimeManager', () => {
  it('activates a staged runtime only after verification succeeds', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-node-runtime-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'node')
    const manifest = getManagedRuntimeFamilyManifest('node')
    const components = resolveManagedRuntimeComponents('node', { platform: 'win32', arch: 'x64' })
    const archiveExtractor = {
      extract: vi.fn(async (_artifact: string, destinationDir: string) => {
        await createRuntimeLauncherFiles(destinationDir, components[0]!.distribution.launcherRelativePaths)
      }),
    }
    const commandRunner = {
      run: vi.fn(async (command: string) => {
        if (command.endsWith('node.exe')) return 'v24.15.0'
        return '11.0.0'
      }),
    }
    const manager = new NodeRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      ensureRootDirectories: async () => undefined,
      downloadClient: {
        downloadToFile: vi.fn(async (_unusedUrl: string, destinationFile) => {
          await createRuntimeLauncherFiles(path.dirname(destinationFile), { artifact: path.basename(destinationFile) })
        }),
        downloadText: vi.fn(async () => `${CHECKSUM}  node-v24.15.0-win-x64.zip`),
      },
      archiveExtractor,
      commandRunner,
      clock: () => '2026-04-22T10:00:00.000Z',
    })

    const snapshot = await manager.installOrRepair('install')

    expect(snapshot.status).toBe('ready')
    expect(snapshot.activeVersion).toBe('24.15.0')
    expect(snapshot.lastVerification?.summary).toContain('node: v24.15.0')
    expect(archiveExtractor.extract).toHaveBeenCalledTimes(1)
  })

  it('keeps the current active version when download fails during repair', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-node-runtime-fail-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'node')
    const manifest = getManagedRuntimeFamilyManifest('node')
    const components = resolveManagedRuntimeComponents('node', { platform: 'win32', arch: 'x64' })
    const manager = new NodeRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      ensureRootDirectories: async () => undefined,
      downloadClient: {
        downloadToFile: vi.fn(async () => {
          throw new Error('network offline')
        }),
        downloadText: vi.fn(async () => `${CHECKSUM}  node-v24.15.0-win-x64.zip`),
      },
      archiveExtractor: { extract: vi.fn() },
      commandRunner: {
        run: vi.fn(async (command: string) => command.endsWith('node.exe') ? 'v24.15.0' : '11.0.0'),
      },
      clock: () => '2026-04-22T11:00:00.000Z',
    })

    await manager['writeState']({
      schemaVersion: 1,
      family: 'node',
      pinnedVersion: manifest.pinnedVersion,
      status: 'ready',
      activeVersion: manifest.pinnedVersion,
      lastInstalledAt: '2026-04-22T09:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    })

    const snapshot = await manager.installOrRepair('repair')

    expect(snapshot.status).toBe('broken')
    expect(snapshot.activeVersion).toBe(manifest.pinnedVersion)
    expect(snapshot.lastErrorSummary?.message).toContain('network offline')
  })

  it('marks the runtime broken when staged verification fails before activation', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-node-runtime-verify-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'node')
    const manifest = getManagedRuntimeFamilyManifest('node')
    const components = resolveManagedRuntimeComponents('node', { platform: 'win32', arch: 'x64' })
    const manager = new NodeRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      ensureRootDirectories: async () => undefined,
      downloadClient: {
        downloadToFile: vi.fn(async (_unusedUrl: string, destinationFile) => {
          await createRuntimeLauncherFiles(path.dirname(destinationFile), { artifact: path.basename(destinationFile) })
        }),
        downloadText: vi.fn(async () => `${CHECKSUM}  node-v24.15.0-win-x64.zip`),
      },
      archiveExtractor: {
        extract: vi.fn(async (artifactFile: string, destinationDir: string) => {
          await createRuntimeLauncherFiles(destinationDir, components[0]!.distribution.launcherRelativePaths)
          if (artifactFile) {
            // noop to silence lint about unused args in test fixture paths
          }
        }),
      },
      commandRunner: {
        run: vi.fn(async () => {
          throw new Error('spawn failed')
        }),
      },
      clock: () => '2026-04-22T12:00:00.000Z',
    })

    const snapshot = await manager.installOrRepair('install')

    expect(snapshot.status).toBe('broken')
    expect(snapshot.activeVersion).toBeNull()
    expect(snapshot.lastErrorSummary?.message).toContain('spawn failed')
  })
})
