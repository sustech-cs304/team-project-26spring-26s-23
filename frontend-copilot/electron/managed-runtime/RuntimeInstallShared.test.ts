import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createManagedRuntimeFamilyPaths } from './ManagedRuntimePaths'
import { activateManagedRuntimeVersion, createVersionDirectoryName } from './RuntimeInstallShared'

const TEMP_PREFIX = 'candue-runtime-install-shared-'
const PAYLOAD_FILE = 'payload.txt'
const ACTIVE_VERSION_KEY = '"activeVersion"'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })))
})

async function expectPathPresent(targetPath: string): Promise<void> {
  await expect(access(targetPath)).resolves.toBeUndefined()
}

async function writeFixtureFile(targetPath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, contents)
}

describe('activateManagedRuntimeVersion', () => {
  it('replaces an existing version directory and removes the backup after a successful activation', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}success-`))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'node')
    const version = 'v1.2.3'
    const versionDir = path.join(paths.versionsDir, createVersionDirectoryName(version))
    const stagedVersionDir = path.join(paths.stagingDir, 'staged-success')
    await rm(paths.rootDir, { recursive: true, force: true })
    await writeFixtureFile(path.join(versionDir, PAYLOAD_FILE), 'old-runtime')
    await writeFixtureFile(path.join(stagedVersionDir, PAYLOAD_FILE), 'new-runtime')

    const activatedVersionDir = await activateManagedRuntimeVersion(paths, version, stagedVersionDir)

    expect(activatedVersionDir).toBe(versionDir)
    await expect(readFile(path.join(versionDir, PAYLOAD_FILE), 'utf8')).resolves.toBe('new-runtime')
    await expect(readFile(paths.activePointerFile, 'utf8')).resolves.toContain(`${ACTIVE_VERSION_KEY}: "${version}"`)
    await expect(access(stagedVersionDir)).rejects.toThrow()
    await expect(readdir(paths.versionsDir)).resolves.toEqual([createVersionDirectoryName(version)])
  })

  it('restores the previous version directory when staged activation fails mid-switch', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}rollback-`))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'uv')
    const version = 'python 3.12.13 + uv 0.11.7'
    const versionDir = path.join(paths.versionsDir, createVersionDirectoryName(version))
    const missingStagedVersionDir = path.join(paths.stagingDir, 'missing-stage')
    await rm(paths.rootDir, { recursive: true, force: true })
    await writeFixtureFile(path.join(versionDir, PAYLOAD_FILE), 'known-good-runtime')

    await expect(activateManagedRuntimeVersion(paths, version, missingStagedVersionDir)).rejects.toThrow()

    await expect(readFile(path.join(versionDir, PAYLOAD_FILE), 'utf8')).resolves.toBe('known-good-runtime')
    await expect(access(paths.activePointerFile)).rejects.toThrow()
    await expect(readdir(paths.versionsDir)).resolves.toEqual([createVersionDirectoryName(version)])
  })

  it('activates a staged version normally when no previous version directory exists', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), `${TEMP_PREFIX}empty-`))
    tempRoots.push(tempRoot)
    const paths = createManagedRuntimeFamilyPaths(tempRoot, 'node')
    const version = 'v2.0.0'
    const versionDir = path.join(paths.versionsDir, createVersionDirectoryName(version))
    const stagedVersionDir = path.join(paths.stagingDir, 'staged-empty')
    await rm(paths.rootDir, { recursive: true, force: true })
    await writeFixtureFile(path.join(stagedVersionDir, PAYLOAD_FILE), 'fresh-runtime')

    const activatedVersionDir = await activateManagedRuntimeVersion(paths, version, stagedVersionDir)

    expect(activatedVersionDir).toBe(versionDir)
    await expect(readFile(path.join(versionDir, PAYLOAD_FILE), 'utf8')).resolves.toBe('fresh-runtime')
    await expect(readFile(paths.activePointerFile, 'utf8')).resolves.toContain(`${ACTIVE_VERSION_KEY}: "${version}"`)
    await expectPathPresent(versionDir)
  })
})
