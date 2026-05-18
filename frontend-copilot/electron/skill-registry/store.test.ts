import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createSkillRecordFixture } from './test-support'
import { createSkillRegistryPaths, createSkillRegistryStore } from './store'

const activeTempRoots: string[] = []

afterEach(async () => {
  await Promise.all(activeTempRoots.splice(0).map(async (tempRoot) => {
    await rm(tempRoot, { recursive: true, force: true })
  }))
})

async function createRegistryStoreFixture(testName: string) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-skill-registry-store-${testName}-`))
  activeTempRoots.push(tempRoot)

  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)

  const paths = createSkillRegistryPaths(hostedPaths)
  const store = createSkillRegistryStore({ paths })
  return {
    tempRoot,
    hostedPaths,
    paths,
    store,
  }
}

describe('createSkillRegistryStore', () => {
  it('initializes registry and managed skills directories under application runtime paths', async () => {
    const fixture = await createRegistryStoreFixture('initialize-defaults')

    const result = await fixture.store.load()
    const storedDocument = JSON.parse(await readFile(fixture.paths.documentFile, 'utf8')) as {
      version: number
      kind: string
      registryRevision: number
      snapshotRevision: number
      skills: unknown[]
    }

    expect(result).toEqual({
      source: 'initialized-defaults',
      registryRevision: 0,
      snapshotRevision: 0,
      skills: [],
    })
    expect(storedDocument).toEqual({
      version: 1,
      kind: 'skill-registry',
      registryRevision: 0,
      snapshotRevision: 0,
      skills: [],
    })
    expect(fixture.paths.documentFile).toContain('skill-registry')
    expect(fixture.paths.managedSkillsDir).toBe(path.join(fixture.hostedPaths.runtimeRootDir, 'skills'))
  })

  it('persists skill records and increments registryRevision on save', async () => {
    const fixture = await createRegistryStoreFixture('persist-skills')
    const skill = createSkillRecordFixture()

    const saved = await fixture.store.saveSkills([skill])
    const loaded = await fixture.store.load()

    expect(saved.registryRevision).toBe(1)
    expect(saved.snapshotRevision).toBe(0)
    expect(saved.skills).toEqual([skill])
    expect(loaded.source).toBe('stored')
    expect(loaded.skills).toEqual([skill])
  })

  it('persists snapshotRevision without bumping registryRevision or rewriting skill records', async () => {
    const fixture = await createRegistryStoreFixture('persist-snapshot-revision')
    const skill = createSkillRecordFixture()
    await fixture.store.saveSkills([skill])

    const saved = await fixture.store.saveSnapshotRevision(7)
    const loaded = await fixture.store.load()
    const storedDocument = JSON.parse(await readFile(fixture.paths.documentFile, 'utf8')) as {
      registryRevision: number
      snapshotRevision: number
      skills: unknown[]
    }

    expect(saved.registryRevision).toBe(1)
    expect(saved.snapshotRevision).toBe(7)
    expect(saved.skills).toEqual([skill])
    expect(loaded).toEqual(saved)
    expect(storedDocument.registryRevision).toBe(1)
    expect(storedDocument.snapshotRevision).toBe(7)
    expect(storedDocument.skills).toEqual([skill])
  })

  it('recovers from a corrupt registry document by backing it up and reinitializing defaults', async () => {
    const fixture = await createRegistryStoreFixture('recover-corrupt')

    await mkdir(fixture.paths.rootDir, { recursive: true })
    await writeFile(fixture.paths.documentFile, '{ this is not valid json }\n', 'utf8')

    const recovered = await fixture.store.load()

    expect(recovered).toEqual({
      source: 'recovered-corrupt',
      registryRevision: 0,
      snapshotRevision: 0,
      skills: [],
    })

    const siblingFiles = await (await import('node:fs/promises')).readdir(fixture.paths.rootDir)
    expect(siblingFiles.some((fileName) => fileName.startsWith('registry.json.corrupt-'))).toBe(true)
  })
})
