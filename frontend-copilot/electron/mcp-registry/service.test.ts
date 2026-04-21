import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createMcpRegistryService } from './service'
import { createMcpRegistryPaths, createMcpRegistryStore } from './store'
import {
  createMcpHttpSseStubServerFixture,
  createMcpStdioStubServerFixture,
  MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS,
} from './test-support'

const activeTempRoots: string[] = []

afterEach(async () => {
  await Promise.all(activeTempRoots.splice(0).map(async (tempRoot) => {
    await rm(tempRoot, { recursive: true, force: true })
  }))
})

async function createRegistryServiceFixture(testName: string) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-mcp-registry-service-${testName}-`))
  activeTempRoots.push(tempRoot)

  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)

  const store = createMcpRegistryStore({
    paths: createMcpRegistryPaths(hostedPaths),
  })
  const publishEvent = vi.fn()
  const service = createMcpRegistryService({
    store,
    publishEvent,
    now: () => '2026-04-21T12:00:00.000Z',
  })

  return {
    tempRoot,
    store,
    publishEvent,
    service,
  }
}

describe('createMcpRegistryService', () => {
  it('loads, saves, toggles, and deletes persisted registry records', async () => {
    const fixture = await createRegistryServiceFixture('crud')
    const draft = createMcpStdioStubServerFixture({
      createdAt: '2026-04-20T12:00:00.000Z',
      updatedAt: '2026-04-20T12:00:00.000Z',
    })

    await expect(fixture.service.loadRegistry({ includeDisabled: true })).resolves.toEqual({
      ok: true,
      registryRevision: 0,
      snapshotRevision: 0,
      servers: [],
      states: [],
    })

    const saveResult = await fixture.service.saveServer(draft)
    expect(saveResult.ok).toBe(true)
    if (!saveResult.ok) {
      throw new Error('Expected saveResult.ok=true')
    }
    expect(saveResult.registryRevision).toBe(1)
    expect(saveResult.server.serverId).toBe(draft.serverId)
    expect(saveResult.server.updatedAt).toBe('2026-04-21T12:00:00.000Z')
    expect(saveResult.state?.connectionState).toBe('idle')

    const toggleResult = await fixture.service.setServerEnabled({ serverId: draft.serverId, enabled: false })
    expect(toggleResult.ok).toBe(true)
    if (!toggleResult.ok) {
      throw new Error('Expected toggleResult.ok=true')
    }
    expect(toggleResult.registryRevision).toBe(2)
    expect(toggleResult.server.enabled).toBe(false)
    expect(toggleResult.state?.connectionState).toBe('disabled')

    const deleteResult = await fixture.service.deleteServer(draft.serverId)
    expect(deleteResult).toEqual({
      ok: true,
      registryRevision: 3,
      snapshotRevision: 0,
      serverId: draft.serverId,
      deleted: true,
    })
    expect(fixture.publishEvent).toHaveBeenCalledTimes(3)
  })

  it('returns structured validation failures without writing invalid drafts', async () => {
    const fixture = await createRegistryServiceFixture('validation')

    const result = await fixture.service.saveServer({
      ...createMcpStdioStubServerFixture(),
      serverId: '   ',
      displayName: '',
      transportConfig: {
        kind: 'stdio',
        command: '',
        args: [],
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected validation failure.')
    }
    expect(result.code).toBe('validation_failed')
    expect(result.validationErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: 'serverId' }),
      expect.objectContaining({ fieldPath: 'displayName' }),
      expect.objectContaining({ fieldPath: 'transportConfig.command' }),
    ]))
    expect((await fixture.store.load()).servers).toEqual([])
  })

  it('returns explicit P1-limited testConnection and refreshCatalog results instead of a stub failure', async () => {
    const fixture = await createRegistryServiceFixture('p1-limited-ops')
    await fixture.store.saveServers([
      createMcpStdioStubServerFixture(),
      createMcpHttpSseStubServerFixture({ enabled: false }),
    ])

    const testConnectionResult = await fixture.service.testConnection({
      serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
    })
    expect(testConnectionResult).toEqual({
      ok: true,
      success: false,
      transportKind: 'stdio',
      toolCount: 0,
      durationMs: expect.any(Number),
      error: expect.objectContaining({
        code: 'p1_management_only',
        retryable: false,
      }),
      warnings: ['P1 已接通管理平面持久化；真实传输连接测试将在 P2 接入。'],
    })

    const refreshCatalogResult = await fixture.service.refreshCatalog()
    expect(refreshCatalogResult).toEqual({
      ok: true,
      registryRevision: 1,
      snapshotRevision: 0,
      refreshedServerIds: [MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio],
      results: [
        {
          serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
          toolCount: 0,
          connectionState: 'idle',
          error: expect.objectContaining({ code: 'p1_management_only' }),
        },
      ],
    })
  })
})
