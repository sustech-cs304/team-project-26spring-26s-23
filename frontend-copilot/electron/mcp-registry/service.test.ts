import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createMcpRegistryService } from './service'
import { buildMcpToolId } from './snapshot'
import { createMcpRegistryPaths, createMcpRegistryStore } from './store'
import {
  createMcpHttpSseStubServerFixture,
  createMcpServerStateFixture,
  createMcpStdioStubServerFixture,
  MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS,
} from './test-support'
import type { McpConnectorHub } from './connector-hub'
import type { McpCapabilitySnapshot, McpServerRecord, McpServerStateSummary, McpToolCallRequest } from './types'
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

interface FakeConnectorHub extends McpConnectorHub {
  __getToolCallRequests(): McpToolCallRequest[]
}

async function createRegistryServiceFixture(testName: string) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-mcp-registry-service-${testName}-`))
  activeTempRoots.push(tempRoot)

  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)

  const store = createMcpRegistryStore({
    paths: createMcpRegistryPaths(hostedPaths),
  })
  const publishEvent = vi.fn()
  const snapshotWrites: McpCapabilitySnapshot[] = []
  const snapshotSink = {
    write: vi.fn(async (snapshot: McpCapabilitySnapshot) => {
      snapshotWrites.push(snapshot)
    }),
  }
  const connectorHub = createFakeConnectorHub()
  const service = createMcpRegistryService({
    store,
    connectorHub,
    snapshotSink,
    publishEvent,
    now: () => '2026-04-21T12:00:00.000Z',
  })

  return {
    tempRoot,
    store,
    publishEvent,
    snapshotSink,
    snapshotWrites,
    connectorHub,
    service,
  }
}

function createFakeConnectorHub(): FakeConnectorHub {
  const states = new Map<string, McpServerStateSummary>()
  const tools = new Map<string, McpRemoteToolSummary[]>()

  const toolCallRequests: McpToolCallRequest[] = []

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
        phase: server.enabled ? null : 'initialize',
        diagnosticSummary: server.enabled ? null : 'phase=initialize; command=stub-mcp-server',
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
    async callTool(request) {
      toolCallRequests.push({
        ...request,
        arguments: { ...request.arguments },
      })
      return {
        ok: true,
        toolId: request.toolId,
        serverId: request.serverId,
        remoteToolName: request.remoteToolName,
        content: [{ type: 'text', text: JSON.stringify(request.arguments) }],
        structuredContent: { echoedArguments: { ...request.arguments } },
        snapshotRevision: request.snapshotRevision ?? null,
        isError: false,
      }
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
      toolCallRequests.splice(0)
    },
    __getToolCallRequests() {
      return toolCallRequests.map((request) => ({
        ...request,
        arguments: { ...request.arguments },
      }))
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

  it('writes capability snapshots to the configured sink across load and catalog refresh flows', async () => {
    const fixture = await createRegistryServiceFixture('snapshot-sink')
    const stdioServer = createMcpStdioStubServerFixture()
    const disabledHttpServer = createMcpHttpSseStubServerFixture({ enabled: false })

    await fixture.service.loadRegistry({ includeDisabled: true })
    await fixture.service.saveServer(stdioServer)
    await fixture.service.saveServer(disabledHttpServer)
    const refreshResult = await fixture.service.refreshCatalog()

    expect(refreshResult.ok).toBe(true)
    expect(fixture.snapshotSink.write).toHaveBeenCalled()

    const initialSnapshot = fixture.snapshotWrites[0]
    expect(initialSnapshot).toBeDefined()
    if (initialSnapshot === undefined) {
      throw new Error('Expected initial snapshot write call.')
    }
    expect(initialSnapshot).toEqual({
      version: 1,
      registryRevision: 0,
      snapshotRevision: 0,
      generatedAt: '2026-04-21T12:00:00.000Z',
      servers: [],
      tools: [],
      groups: [],
    })

    const latestSnapshot = fixture.snapshotWrites[fixture.snapshotWrites.length - 1]
    expect(latestSnapshot).toBeDefined()
    if (latestSnapshot === undefined) {
      throw new Error('Expected latest snapshot write call.')
    }
    expect(latestSnapshot).toMatchObject({
      version: 1,
      registryRevision: 2,
      snapshotRevision: 2,
      generatedAt: '2026-04-21T12:00:00.000Z',
      tools: [
        {
          toolId: buildMcpToolId(MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio, 'search-campus'),
          serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
          remoteToolName: 'search-campus',
          displayName: 'Search Campus',
          availability: 'available',
          groupId: 'mcp.server.mcp-stdio-stub',
          groupLabel: 'stdio stub server',
        },
      ],
      groups: [
        {
          groupId: 'mcp.server.mcp-stdio-stub',
          displayName: 'stdio stub server',
          sourceKind: 'mcp',
          toolIds: [buildMcpToolId(MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio, 'search-campus')],
        },
      ],
    })
    expect(latestSnapshot.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
        connectionState: 'connected',
        toolCount: 1,
        lastSuccessfulCatalogRefresh: {
          refreshedAt: '2026-04-21T12:00:00.000Z',
          toolCount: 1,
        },
      }),
      expect.objectContaining({
        serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.httpSse,
        connectionState: 'disabled',
        toolCount: 0,
        lastSuccessfulCatalogRefresh: null,
      }),
    ]))
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
      phase: null,
      diagnosticSummary: null,
      error: null,
      warnings: [],
    })

    const beforeRefreshServers = (await fixture.store.load()).servers
    const refreshCatalogResult = await fixture.service.refreshCatalog()
    expect(refreshCatalogResult).toEqual({
      ok: true,
      registryRevision: 1,
      snapshotRevision: 2,
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

  it('promotes a successful saved-server connection test into an automatic snapshot and catalog refresh', async () => {
    const fixture = await createRegistryServiceFixture('test-sync-success')
    const server = createMcpStdioStubServerFixture()
    await fixture.store.saveServers([server])

    const result = await fixture.service.testConnection({
      serverId: server.serverId,
    })

    expect(result).toEqual({
      ok: true,
      success: true,
      transportKind: 'stdio',
      toolCount: 1,
      durationMs: expect.any(Number),
      phase: null,
      diagnosticSummary: null,
      error: null,
      warnings: [],
    })

    expect(fixture.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'catalog',
      serverId: server.serverId,
      refreshedServerIds: [server.serverId],
    }))

    const latestSnapshot = fixture.snapshotWrites[fixture.snapshotWrites.length - 1]
    expect(latestSnapshot).toBeDefined()
    expect(latestSnapshot?.snapshotRevision).toBeGreaterThan(0)
    expect(latestSnapshot?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        serverId: server.serverId,
        remoteToolName: 'search-campus',
      }),
    ]))
  })

  it('executes MCP tools by stable toolId and reports snapshot directory drift failures', async () => {
    const fixture = await createRegistryServiceFixture('execute-tool')
    const server = createMcpStdioStubServerFixture()
    await fixture.service.saveServer(server)

    const toolId = buildMcpToolId(MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio, 'search-campus')
    const executed = await fixture.service.executeTool({
      toolId,
      serverId: 'stale-server-id',
      remoteToolName: 'stale-tool-name',
      arguments: { keyword: 'calendar' },
      runId: 'run-1',
      toolCallId: 'call-1',
      snapshotRevision: 1,
    })

    expect(executed).toEqual({
      ok: true,
      toolId,
      serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
      remoteToolName: 'search-campus',
      content: [{ type: 'text', text: '{"keyword":"calendar"}' }],
      structuredContent: { echoedArguments: { keyword: 'calendar' } },
      snapshotRevision: 1,
      isError: false,
    })
    expect(fixture.connectorHub.__getToolCallRequests()).toEqual([
      expect.objectContaining({
        toolId,
        serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
        remoteToolName: 'search-campus',
        arguments: { keyword: 'calendar' },
        snapshotRevision: 1,
      }),
    ])

    const fallbackResolved = await fixture.service.executeTool({
      toolId: 'mcp.missing.tool.11111111',
      serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
      remoteToolName: 'search-campus',
      arguments: { keyword: 'fallback' },
      runId: 'run-1',
      toolCallId: 'call-1b',
      snapshotRevision: 0,
    })

    expect(fallbackResolved).toEqual({
      ok: true,
      toolId: 'mcp.missing.tool.11111111',
      serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
      remoteToolName: 'search-campus',
      content: [{ type: 'text', text: '{"keyword":"fallback"}' }],
      structuredContent: { echoedArguments: { keyword: 'fallback' } },
      snapshotRevision: 1,
      isError: false,
    })

    const drift = await fixture.service.executeTool({
      toolId: 'mcp.missing.tool.00000000',
      serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
      remoteToolName: 'missing-tool',
      arguments: {},
      runId: 'run-1',
      toolCallId: 'call-2',
      snapshotRevision: 0,
    })

    expect(drift).toEqual({
      ok: false,
      toolId: 'mcp.missing.tool.00000000',
      serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
      remoteToolName: 'missing-tool',
      snapshotRevision: 0,
      error: {
        code: 'directory_drift',
        message: 'The requested MCP tool no longer exists in the current snapshot.',
        retryable: false,
        observedAt: '2026-04-21T12:00:00.000Z',
        details: { snapshotRevision: 1 },
      },
    })
  })

  it('returns connection test phase and diagnostic summaries and emits a targeted failure log', async () => {
    const fixture = await createRegistryServiceFixture('test-connection-diagnostics')
    const appendLog = vi.fn()
    const service = createMcpRegistryService({
      store: fixture.store,
      connectorHub: {
        ...fixture.connectorHub,
        async testConnection(server) {
          return {
            success: false,
            transportKind: server.transportKind,
            toolCount: 0,
            durationMs: 9,
            phase: 'initialize',
            diagnosticSummary: 'phase=initialize; command=uvx mcp-server-fetch; stderr=booting',
            error: {
              code: 'timeout',
              message: 'Timed out while waiting for the MCP stdio server response during initialize.',
              retryable: true,
              observedAt: '2026-04-21T12:00:00.000Z',
              details: {
                phase: 'initialize',
                stderrSummary: 'booting',
              },
            },
            warnings: ['booting'],
          }
        },
      },
      snapshotSink: fixture.snapshotSink,
      publishEvent: fixture.publishEvent,
      appendLog,
      now: () => '2026-04-21T12:00:00.000Z',
    })

    await fixture.store.saveServers([createMcpStdioStubServerFixture()])
    const result = await service.testConnection({
      serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
    })

    expect(result).toEqual({
      ok: true,
      success: false,
      transportKind: 'stdio',
      toolCount: 0,
      durationMs: expect.any(Number),
      phase: 'initialize',
      diagnosticSummary: 'phase=initialize; command=uvx mcp-server-fetch; stderr=booting',
      error: {
        code: 'timeout',
        message: 'Timed out while waiting for the MCP stdio server response during initialize.',
        retryable: true,
        observedAt: '2026-04-21T12:00:00.000Z',
        details: {
          phase: 'initialize',
          stderrSummary: 'booting',
        },
      },
      warnings: ['booting'],
    })
    expect(appendLog).toHaveBeenCalledWith('warn', '[mcp-registry] MCP testConnection failed.', {
      serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
      transportKind: 'stdio',
      phase: 'initialize',
      errorCode: 'timeout',
      retryable: true,
      diagnosticSummary: 'phase=initialize; command=uvx mcp-server-fetch; stderr=booting',
      stderrSummary: 'booting',
    })
  })
})
