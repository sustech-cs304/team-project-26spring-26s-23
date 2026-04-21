import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createMcpRegistryService } from './service'
import { createMcpRegistryPaths, createMcpRegistryStore } from './store'
import {
  createMcpHttpSseStubServerFixture,
  createMcpServerStateFixture,
  createMcpStdioStubServerFixture,
  MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS,
} from './test-support'
import type { McpConnectorHub } from './connector-hub'
import type { McpServerRecord, McpServerStateSummary } from './types'
import type { McpRemoteToolSummary } from './connectors/protocol'

const activeTempRoots: string[] = []

const STUB_TOOLS: McpRemoteToolSummary[] = [{
  name: 'search-campus',
  displayName: 'Search Campus',
  description: 'Search the campus knowledge base.',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: { type: 'string' },
    },
  },
}]

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
  const connectorHub = createFakeConnectorHub()
  const service = createMcpRegistryService({
    store,
    connectorHub,
    publishEvent,
    now: () => '2026-04-21T12:00:00.000Z',
  })

  return {
    tempRoot,
    store,
    publishEvent,
    connectorHub,
    service,
  }
}

function createFakeConnectorHub(): McpConnectorHub {
  const states = new Map<string, McpServerStateSummary>()
  const tools = new Map<string, McpRemoteToolSummary[]>()

  return {
    async reconcile(servers) {
      for (const server of servers) {
        const state = createStateForServer(server)
        states.set(server.serverId, state)
        tools.set(server.serverId, server.enabled ? STUB_TOOLS : [])
      }

      return { states: servers.map((server) => states.get(server.serverId) ?? createStateForServer(server)) }
    },
    async removeServer(serverId) {
      states.delete(serverId)
      tools.delete(serverId)
    },
    async setServerDisabled(server) {
      const state = createStateForServer({ ...server, enabled: false })
      states.set(server.serverId, state)
      tools.set(server.serverId, [])
      return state
    },
    async testConnection(server) {
      return {
        success: server.enabled,
        transportKind: server.transportKind,
        toolCount: server.enabled ? STUB_TOOLS.length : 0,
        durationMs: 12,
        error: server.enabled ? null : {
          code: 'disabled',
          message: 'The server is disabled.',
          retryable: false,
          observedAt: '2026-04-21T12:00:00.000Z',
        },
        warnings: [],
      }
    },
    async refreshCatalog(serverIds) {
      const ids = serverIds ?? Array.from(states.keys())
      return ids.map((serverId) => {
        const state = states.get(serverId) ?? createMcpServerStateFixture(createMcpStdioStubServerFixture({ serverId }))
        return {
          serverId,
          success: state.enabled,
          toolCount: state.enabled ? STUB_TOOLS.length : 0,
          state: {
            ...state,
            connectionState: state.enabled ? 'connected' : 'disabled',
            toolCount: state.enabled ? STUB_TOOLS.length : 0,
            lastCatalogSyncAt: '2026-04-21T12:00:00.000Z',
          },
          error: state.enabled ? null : {
            code: 'disabled',
            message: 'The server is disabled.',
            retryable: false,
            observedAt: '2026-04-21T12:00:00.000Z',
          },
        }
      })
    },
    getState(serverId) {
      return states.get(serverId) ?? null
    },
    getAllStates(servers) {
      if (servers === undefined) {
        return Array.from(states.values())
      }

      return servers.map((server) => states.get(server.serverId) ?? createStateForServer(server))
    },
    getTools(serverId) {
      return tools.get(serverId) ?? []
    },
    async stopAll() {
      states.clear()
      tools.clear()
    },
  }
}

function createStateForServer(server: McpServerRecord): McpServerStateSummary {
  if (!server.enabled) {
    return createMcpServerStateFixture(server, {
      enabled: false,
      connectionState: 'disabled',
      toolCount: 0,
      lastHandshakeAt: null,
      lastCatalogSyncAt: null,
      transportState: server.transportKind === 'stdio'
        ? {
            kind: 'stdio',
            processStatus: 'stopped',
            pid: null,
            lastExitCode: null,
            lastExitSignal: null,
          }
        : {
            kind: 'http-sse',
            endpointStatus: 'offline',
            lastHttpStatus: null,
            sseOnline: false,
          },
    })
  }

  return createMcpServerStateFixture(server, {
    connectionState: 'connected',
    toolCount: STUB_TOOLS.length,
    lastHandshakeAt: '2026-04-21T12:00:00.000Z',
    lastCatalogSyncAt: '2026-04-21T12:00:00.000Z',
  })
}

describe('createMcpRegistryService', () => {
  it('loads, saves, toggles, and deletes persisted registry records while reconciling connector state', async () => {
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
    expect(saveResult.snapshotRevision).toBe(1)
    expect(saveResult.server.serverId).toBe(draft.serverId)
    expect(saveResult.server.updatedAt).toBe('2026-04-21T12:00:00.000Z')
    expect(saveResult.state?.connectionState).toBe('connected')
    expect(saveResult.state?.toolCount).toBe(1)

    const toggleResult = await fixture.service.setServerEnabled({ serverId: draft.serverId, enabled: false })
    expect(toggleResult.ok).toBe(true)
    if (!toggleResult.ok) {
      throw new Error('Expected toggleResult.ok=true')
    }
    expect(toggleResult.registryRevision).toBe(2)
    expect(toggleResult.snapshotRevision).toBe(2)
    expect(toggleResult.server.enabled).toBe(false)
    expect(toggleResult.state?.connectionState).toBe('disabled')

    const deleteResult = await fixture.service.deleteServer(draft.serverId)
    expect(deleteResult).toEqual({
      ok: true,
      registryRevision: 3,
      snapshotRevision: 2,
      serverId: draft.serverId,
      deleted: true,
    })
    expect(fixture.publishEvent).toHaveBeenCalled()
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

  it('runs real P2 connection tests and catalog refreshes through the connector hub without mutating saved drafts', async () => {
    const fixture = await createRegistryServiceFixture('p2-ops')
    await fixture.store.saveServers([
      createMcpStdioStubServerFixture(),
      createMcpHttpSseStubServerFixture({ enabled: false }),
    ])

    const testConnectionResult = await fixture.service.testConnection({
      serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
    })
    expect(testConnectionResult).toEqual({
      ok: true,
      success: true,
      transportKind: 'stdio',
      toolCount: 1,
      durationMs: expect.any(Number),
      error: null,
      warnings: [],
    })

    const beforeRefreshServers = (await fixture.store.load()).servers
    const refreshCatalogResult = await fixture.service.refreshCatalog()
    expect(refreshCatalogResult).toEqual({
      ok: true,
      registryRevision: 1,
      snapshotRevision: 1,
      refreshedServerIds: [
        MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.httpSse,
        MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
      ],
      results: [
        {
          serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.httpSse,
          toolCount: 0,
          connectionState: 'disabled',
          error: expect.objectContaining({ code: 'disabled' }),
        },
        {
          serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
          toolCount: 1,
          connectionState: 'connected',
          error: null,
        },
      ],
    })
    expect((await fixture.store.load()).servers).toEqual(beforeRefreshServers)
  })
})
