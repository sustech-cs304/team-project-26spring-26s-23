import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createMcpRegistryPaths, createMcpRegistryStore } from './store'
import { createMcpHttpSseStubServerFixture, createMcpStdioStubServerFixture } from './test-support'

const activeTempRoots: string[] = []

afterEach(async () => {
  await Promise.all(activeTempRoots.splice(0).map(async (tempRoot) => {
    await rm(tempRoot, { recursive: true, force: true })
  }))
})

async function createRegistryStoreFixture(testName: string) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-mcp-registry-store-${testName}-`))
  activeTempRoots.push(tempRoot)

  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)

  const paths = createMcpRegistryPaths(hostedPaths)
  const store = createMcpRegistryStore({ paths })
  return {
    tempRoot,
    hostedPaths,
    paths,
    store,
  }
}

describe('createMcpRegistryStore', () => {
  it('initializes a dedicated registry document under the runtime config directory', async () => {
    const fixture = await createRegistryStoreFixture('initialize-defaults')

    const result = await fixture.store.load()
    const storedDocument = JSON.parse(await readFile(fixture.paths.documentFile, 'utf8')) as {
      version: number
      registryRevision: number
      snapshotRevision: number
      servers: unknown[]
    }

    expect(result).toEqual({
      source: 'initialized-defaults',
      registryRevision: 0,
      snapshotRevision: 0,
      servers: [],
    })
    expect(storedDocument).toEqual({
      version: 1,
      registryRevision: 0,
      snapshotRevision: 0,
      servers: [],
    })
    expect(fixture.paths.documentFile).toContain('mcp-registry')
  })

  it('persists server records and increments registryRevision on save', async () => {
    const fixture = await createRegistryStoreFixture('persist-servers')
    const stdioServer = createMcpStdioStubServerFixture()
    const httpSseServer = createMcpHttpSseStubServerFixture()

    const saved = await fixture.store.saveServers([stdioServer, httpSseServer])
    const loaded = await fixture.store.load()

    expect(saved.registryRevision).toBe(1)
    expect(saved.snapshotRevision).toBe(0)
    expect(saved.servers).toEqual([stdioServer, httpSseServer])
    expect(loaded.source).toBe('stored')
    expect(loaded.servers).toEqual([stdioServer, httpSseServer])
  })

  it('persists snapshotRevision without bumping registryRevision or rewriting server records', async () => {
    const fixture = await createRegistryStoreFixture('persist-snapshot-revision')
    const stdioServer = createMcpStdioStubServerFixture()
    await fixture.store.saveServers([stdioServer])

    const saved = await fixture.store.saveSnapshotRevision(7)
    const loaded = await fixture.store.load()
    const storedDocument = JSON.parse(await readFile(fixture.paths.documentFile, 'utf8')) as {
      registryRevision: number
      snapshotRevision: number
      servers: unknown[]
    }

    expect(saved.registryRevision).toBe(1)
    expect(saved.snapshotRevision).toBe(7)
    expect(saved.servers).toEqual([stdioServer])
    expect(loaded).toEqual(saved)
    expect(storedDocument.registryRevision).toBe(1)
    expect(storedDocument.snapshotRevision).toBe(7)
    expect(storedDocument.servers).toEqual([stdioServer])
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
      servers: [],
    })

    const siblingFiles = await (await import('node:fs/promises')).readdir(fixture.paths.rootDir)
    expect(siblingFiles.some((fileName) => fileName.startsWith('registry.json.corrupt-'))).toBe(true)
  })
})
