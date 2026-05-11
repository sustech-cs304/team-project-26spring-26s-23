import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManagedRuntimeFamilyPaths } from '../ManagedRuntimePaths'
import { getManagedRuntimeFamilyManifest, resolveManagedRuntimeComponents } from '../runtime-manifest'
import { createNodeRuntimeFixture, createRuntimeLauncherFiles } from '../test-support/runtime-install-fixtures'
import { NodeRuntimeManager } from './NodeRuntimeManager'

const FIXTURE_CONTENT = 'fixture'
const CHECKSUM = createHash('sha256').update(FIXTURE_CONTENT).digest('hex')
const NPX_CMD = 'npx.cmd'
const NPM_CMD = 'npm.cmd'
const NODE_EXE = 'node.exe'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })))
})

describe('NodeRuntimeManager - install cross-platform', () => {
  it.each([
    {
      platform: 'win32' as const,
      arch: 'x64' as const,
      nodeLauncher: NODE_EXE,
      npmLauncher: NPM_CMD,
      npxLauncher: NPX_CMD,
    },
    {
      platform: 'darwin' as const,
      arch: 'arm64' as const,
      nodeLauncher: path.join('bin', 'node'),
      npmLauncher: path.join('bin', 'npm'),
      npxLauncher: path.join('bin', 'npx'),
    },
    {
      platform: 'linux' as const,
      arch: 'x64' as const,
      nodeLauncher: path.join('bin', 'node'),
      npmLauncher: path.join('bin', 'npm'),
      npxLauncher: path.join('bin', 'npx'),
    },
  ])('installs and verifies managed node launchers on $platform/$arch', async ({
    platform,
    arch,
    nodeLauncher,
    npmLauncher,
    npxLauncher,
  }) => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-node-runtime-${platform}-`))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'node')
    const manifest = getManagedRuntimeFamilyManifest('node')
    const components = resolveManagedRuntimeComponents('node', { platform, arch })
    const commandRunner = {
      run: vi.fn(async (command: string) => {
        const normalized = command.replace(/\\/g, '/')
        if (normalized.endsWith(nodeLauncher.replace(/\\/g, '/'))) return 'v24.15.0'
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
        downloadText: vi.fn(async () => `${CHECKSUM}  ${components[0]!.distribution.fileName}`),
      },
      archiveExtractor: {
        extract: vi.fn(async (_artifactFile: string, destinationDir: string) => {
          await createNodeRuntimeFixture(destinationDir, components[0]!.distribution.launcherRelativePaths)
        }),
      },
      commandRunner,
      clock: () => '2026-04-22T10:00:00.000Z',
    })

    const snapshot = await manager.installOrRepair('install')

    expect(snapshot.status).toBe('ready')
    expect(snapshot.launcherPaths.node).toBe(path.join(paths.versionsDir, manifest.pinnedVersion, 'node', nodeLauncher))
    expect(snapshot.launcherPaths.npm).toBe(path.join(paths.versionsDir, manifest.pinnedVersion, 'node', npmLauncher))
    expect(snapshot.launcherPaths.npx).toBe(path.join(paths.versionsDir, manifest.pinnedVersion, 'node', npxLauncher))
    const verifiedPaths = commandRunner.run.mock.calls.map(([command]) => String(command))
    expect(verifiedPaths).toHaveLength(3)
    expect(verifiedPaths[0]).toContain(path.join('node', 'staging', `${manifest.pinnedVersion}-`))
    expect(verifiedPaths[0].endsWith(path.join('version', 'node', nodeLauncher))).toBe(true)
    expect(verifiedPaths[1]).toContain(path.join('node', 'staging', `${manifest.pinnedVersion}-`))
    expect(verifiedPaths[1].endsWith(path.join('version', 'node', npmLauncher))).toBe(true)
    expect(verifiedPaths[2]).toContain(path.join('node', 'staging', `${manifest.pinnedVersion}-`))
    expect(verifiedPaths[2].endsWith(path.join('version', 'node', npxLauncher))).toBe(true)
  })
})

describe('NodeRuntimeManager - staged activation', () => {
  it('activates a staged runtime only after verification succeeds', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-node-runtime-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'node')
    const manifest = getManagedRuntimeFamilyManifest('node')
    const components = resolveManagedRuntimeComponents('node', { platform: 'win32', arch: 'x64' })
    const archiveExtractor = {
      extract: vi.fn(async (_artifact: string, destinationDir: string) => {
        await createNodeRuntimeFixture(destinationDir, components[0]!.distribution.launcherRelativePaths)
      }),
    }
    const commandRunner = {
      run: vi.fn(async (command: string) => {
        if (command.endsWith(NODE_EXE)) return 'v24.15.0'
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
})

describe('NodeRuntimeManager - repair and error handling', () => {
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
        downloadToFile: vi.fn(async () => { throw new Error('network offline') }),
        downloadText: vi.fn(async () => `${CHECKSUM}  node-v24.15.0-win-x64.zip`),
      },
      archiveExtractor: { extract: vi.fn() },
      commandRunner: {
        run: vi.fn(async (command: string) => command.endsWith(NODE_EXE) ? 'v24.15.0' : '11.0.0'),
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
          await createNodeRuntimeFixture(destinationDir, components[0]!.distribution.launcherRelativePaths)
          if (artifactFile) { /* noop */ }
        }),
      },
      commandRunner: {
        run: vi.fn(async () => { throw new Error('spawn failed') }),
      },
      clock: () => '2026-04-22T12:00:00.000Z',
    })

    const snapshot = await manager.installOrRepair('install')

    expect(snapshot.status).toBe('broken')
    expect(snapshot.activeVersion).toBeNull()
    expect(snapshot.lastErrorSummary?.code).toBe('verification_failed')
    expect(snapshot.lastErrorSummary?.message).toContain('spawn failed')
  })

  it('restores broken state back to ready on a successful repair while preserving the active version directory', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-node-runtime-repair-ready-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'node')
    const manifest = getManagedRuntimeFamilyManifest('node')
    const components = resolveManagedRuntimeComponents('node', { platform: 'win32', arch: 'x64' })
    let shouldFail = true
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
        extract: vi.fn(async (_artifactFile: string, destinationDir: string) => {
          await createNodeRuntimeFixture(destinationDir, components[0]!.distribution.launcherRelativePaths)
        }),
      },
      commandRunner: {
        run: vi.fn(async (command: string) => {
          if (shouldFail) { throw new Error('npx verification failed') }
          if (command.endsWith(NODE_EXE)) return 'v24.15.0'
          return '11.0.0'
        }),
      },
      clock: () => '2026-04-22T15:00:00.000Z',
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

    const failed = await manager.installOrRepair('repair')
    shouldFail = false
    const repaired = await manager.installOrRepair('repair')

    expect(failed.status).toBe('broken')
    expect(failed.activeVersion).toBe(manifest.pinnedVersion)
    expect(repaired.status).toBe('ready')
    expect(repaired.activeVersion).toBe(manifest.pinnedVersion)
    expect(repaired.lastRepairedAt).toBe('2026-04-22T15:00:00.000Z')
    await expect(access(path.join(paths.versionsDir, manifest.pinnedVersion, 'node', NPX_CMD))).resolves.toBeUndefined()
  })
})

describe('NodeRuntimeManager - directory integrity', () => {
  it('marks an active version broken when the version directory is incomplete', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-node-runtime-broken-active-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'node')
    const manifest = getManagedRuntimeFamilyManifest('node')
    const components = resolveManagedRuntimeComponents('node', { platform: 'win32', arch: 'x64' })
    const versionDir = path.join(paths.versionsDir, manifest.pinnedVersion)
    const manager = new NodeRuntimeManager({
      paths,
      pinnedVersion: manifest.pinnedVersion,
      selectedComponents: components,
      ensureRootDirectories: async () => undefined,
      commandRunner: {
        run: vi.fn(async (command: string) => command.endsWith(NODE_EXE) ? 'v24.15.0' : '11.0.0'),
      },
      clock: () => '2026-04-23T10:00:00.000Z',
    })

    await manager['writeState']({
      schemaVersion: 1,
      family: 'node',
      pinnedVersion: manifest.pinnedVersion,
      status: 'ready',
      activeVersion: manifest.pinnedVersion,
      lastInstalledAt: '2026-04-22T09:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: {
        verifiedAt: '2026-04-22T09:00:00.000Z',
        summary: 'previously verified',
        launchers: {
          node: path.join(versionDir, 'node', NODE_EXE),
          npm: path.join(versionDir, 'node', NPM_CMD),
          npx: path.join(versionDir, 'node', NPX_CMD),
        },
      },
      lastErrorSummary: null,
    })
    await createRuntimeLauncherFiles(path.join(versionDir, 'node'), { node: NODE_EXE })

    const snapshot = await manager.loadSnapshot()

    expect(snapshot.status).toBe('broken')
    expect(snapshot.activeVersion).toBe(manifest.pinnedVersion)
    expect(snapshot.lastErrorSummary?.code).toBe('verification_failed')
    expect(snapshot.lastErrorSummary?.message).toContain(NPM_CMD)
    expect(snapshot.lastVerification?.summary).toBe('previously verified')
  })

  it('repairs an incomplete target version directory in a single repair run', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-node-runtime-self-heal-'))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'node')
    const manifest = getManagedRuntimeFamilyManifest('node')
    const components = resolveManagedRuntimeComponents('node', { platform: 'win32', arch: 'x64' })
    const versionDir = path.join(paths.versionsDir, manifest.pinnedVersion)
    const markerFile = path.join(versionDir, 'node', 'stale.txt')
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
        extract: vi.fn(async (_artifactFile: string, destinationDir: string) => {
          await createNodeRuntimeFixture(destinationDir, components[0]!.distribution.launcherRelativePaths)
        }),
      },
      commandRunner: {
        run: vi.fn(async (command: string) => command.endsWith(NODE_EXE) ? 'v24.15.0' : '11.0.0'),
      },
      clock: () => '2026-04-23T10:15:00.000Z',
    })

    await manager['writeState']({
      schemaVersion: 1,
      family: 'node',
      pinnedVersion: manifest.pinnedVersion,
      status: 'broken',
      activeVersion: manifest.pinnedVersion,
      lastInstalledAt: '2026-04-22T09:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: { code: 'verification_failed', message: `missing ${NPM_CMD}`, at: '2026-04-23T10:00:00.000Z' },
    })
    await createRuntimeLauncherFiles(path.join(versionDir, 'node'), { node: NODE_EXE })
    await writeFile(markerFile, 'stale')

    const repaired = await manager.installOrRepair('repair')
    const activePointer = JSON.parse(await readFile(paths.activePointerFile, 'utf8')) as { activeVersion: string }

    expect(repaired.status).toBe('ready')
    expect(repaired.activeVersion).toBe(manifest.pinnedVersion)
    expect(repaired.lastRepairedAt).toBe('2026-04-23T10:15:00.000Z')
    expect(activePointer.activeVersion).toBe(manifest.pinnedVersion)
    await expect(access(path.join(versionDir, 'node', NPM_CMD))).resolves.toBeUndefined()
    await expect(access(path.join(versionDir, 'node', NPX_CMD))).resolves.toBeUndefined()
    await expect(access(markerFile)).rejects.toThrow()
  })
})

describe('NodeRuntimeManager - staging cleanup', () => {
  it('removes staged artifacts after a failed install so the active directory is not polluted', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-node-runtime-staging-clean-'))
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
        extract: vi.fn(async (_artifactFile: string, destinationDir: string) => {
          await createNodeRuntimeFixture(destinationDir, components[0]!.distribution.launcherRelativePaths)
        }),
      },
      commandRunner: {
        run: vi.fn(async () => { throw new Error('checksum mismatch after extract') }),
      },
      clock: () => '2026-04-22T16:00:00.000Z',
    })

    const snapshot = await manager.installOrRepair('install')

    expect(snapshot.status).toBe('broken')
    expect(snapshot.activeVersion).toBeNull()
    expect(snapshot.lastErrorSummary?.message).toContain('checksum mismatch after extract')
    await expect(access(path.join(paths.activeDir, NPX_CMD))).rejects.toThrow()
  })
})
