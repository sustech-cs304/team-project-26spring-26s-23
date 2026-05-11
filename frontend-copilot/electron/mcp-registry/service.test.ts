/* eslint-disable sonarjs/no-duplicate-string -- Fixture data like "search-campus" and "2026-04-21T12:00:00.000Z" repeat across independent mcp-registry-service test cases; extracting every literal would fragment the test narrative without adding clarity. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createMcpRegistryService } from './service'
import type { ManagedRuntimeService } from '../managed-runtime/ManagedRuntimeService'
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

const MCP_FIXED_NOW = '2026-04-21T12:00:00.000Z'
const STUB_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    keyword: { type: 'string' },
  },
}

const activeTempRoots: string[] = []

const STUB_TOOLS: McpRemoteToolSummary[] = [{
  name: 'search-campus',
  displayName: 'Search Campus',
  description: 'Search the campus knowledge base.',
  inputSchema: STUB_TOOL_INPUT_SCHEMA,
}]

afterEach(async () => {
  await Promise.all(activeTempRoots.splice(0).map(async (tempRoot) => {
    await rm(tempRoot, { recursive: true, force: true })
  }))
})

interface FakeConnectorHub extends McpConnectorHub {
  __getToolCallRequests(): McpToolCallRequest[]
  __getRefreshCatalogCalls(): Array<readonly string[] | null>
}

interface FakeConnectorHubOptions {
  reconcileHydratesCatalog?: boolean
  refreshCatalogSucceeds?: boolean
  callToolRequiresHydratedCatalog?: boolean
}

async function createRegistryServiceFixture(testName: string, hubOptions: FakeConnectorHubOptions = {}) {
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
  const connectorHub = createFakeConnectorHub(hubOptions)
  const service = createMcpRegistryService({
    store,
    connectorHub,
    snapshotSink,
    publishEvent,
    now: () => MCP_FIXED_NOW,
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

function createManagedRuntimeServiceStub(
  resolveLauncher: ManagedRuntimeService['resolveLauncher'],
): ManagedRuntimeService {
  return {
    loadSnapshot: vi.fn(async () => {
      throw new Error('loadSnapshot should not be called in this test')
    }),
    installOrRepairAll: vi.fn(async () => {
      throw new Error('installOrRepairAll should not be called in this test')
    }),
    resolveLauncher,
  }
}

// eslint-disable-next-line max-lines-per-function -- This helper constructs a full fake connector hub with realistic state transitions; keeping it colocated avoids indirection for test readers.
function createFakeConnectorHub(options: FakeConnectorHubOptions = {}): FakeConnectorHub {
  const reconcileHydratesCatalog = options.reconcileHydratesCatalog ?? true
  const refreshCatalogSucceeds = options.refreshCatalogSucceeds ?? true
  const callToolRequiresHydratedCatalog = options.callToolRequiresHydratedCatalog ?? true
  const states = new Map<string, McpServerStateSummary>()
  const tools = new Map<string, McpRemoteToolSummary[]>()

  const toolCallRequests: McpToolCallRequest[] = []
  const refreshCatalogCalls: Array<readonly string[] | null> = []

  return {
    async reconcile(servers) {
      for (const server of servers) {
        const state = createStateForServer(server)
        states.set(server.serverId, state)
        tools.set(server.serverId, server.enabled && reconcileHydratesCatalog ? STUB_TOOLS : [])
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
    async refreshCatalog(serverIds, revisions) {
      void revisions
      refreshCatalogCalls.push(serverIds === null ? null : [...serverIds])
      const ids = serverIds ?? Array.from(states.keys())
      return ids.map((serverId) => {
        const state = states.get(serverId) ?? createMcpServerStateFixture(createMcpStdioStubServerFixture({ serverId }))
        const success = state.enabled && refreshCatalogSucceeds
        const nextState: McpServerStateSummary = success
          ? {
              ...state,
              connectionState: 'connected',
              toolCount: STUB_TOOLS.length,
              lastCatalogSyncAt: '2026-04-21T12:00:00.000Z',
              lastError: null,
            }
          : {
              ...state,
              connectionState: 'error',
              toolCount: 0,
              lastCatalogSyncAt: null,
              lastError: {
                code: 'catalog_sync_failed',
                message: 'The catalog refresh failed.',
                retryable: true,
                observedAt: '2026-04-21T12:00:00.000Z',
              },
            }
        states.set(serverId, nextState)
        tools.set(serverId, success ? STUB_TOOLS : [])
        return {
          serverId,
          success,
          toolCount: success ? STUB_TOOLS.length : 0,
          state: nextState,
          error: success ? null : (nextState.lastError ?? null),
        }
      })
    },
    async callTool(request) {
      toolCallRequests.push({
        ...request,
        arguments: { ...request.arguments },
      })
      const availableTools = tools.get(request.serverId) ?? []
      if (callToolRequiresHydratedCatalog && !availableTools.some((tool) => tool.name === request.remoteToolName)) {
        const state = states.get(request.serverId)
        return {
          ok: false,
          toolId: request.toolId,
          serverId: request.serverId,
          remoteToolName: request.remoteToolName,
          snapshotRevision: request.snapshotRevision ?? null,
          error: {
            code: 'server_not_ready',
            message: 'The MCP server is not ready to execute tools.',
            retryable: true,
            observedAt: '2026-04-21T12:00:00.000Z',
            details: {
              requestedServerId: request.serverId,
              requestedRemoteToolName: request.remoteToolName,
              connectionState: state?.connectionState ?? 'connecting',
              connectorToolCount: availableTools.length,
              requestedSnapshotRevision: request.snapshotRevision ?? null,
              snapshotRevision: request.snapshotRevision ?? null,
            },
          },
        }
      }
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
    __getRefreshCatalogCalls() {
      return refreshCatalogCalls.map((entry) => entry === null ? null : [...entry])
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

/* eslint-disable sonarjs/no-duplicate-string -- Fixture data like "2026-04-21T12:00:00.000Z" and tool names appear across independent test cases that each exercise distinct mcp-registry-service flows; extracting every shared literal would fragment the test narrative. */
// eslint-disable-next-line max-lines-per-function -- This describe groups the full mcp-registry service test suite; each it() already exercises an isolated flow, and splitting into sub-describes would scatter fixture setup and duplicate orchestration.
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

  it('rewrites npx test connections to the managed Node/npm launcher without using system PATH', async () => {
    const fixture = await createRegistryServiceFixture('managed-npx-test-connection')
    const managedRuntimeService = createManagedRuntimeServiceStub(async (command) => {
      expect(command).toBe('npx')
      return {
        ok: true,
        command,
        normalizedCommand: 'npx',
        family: 'node',
        executablePath: 'D:/managed/node/npx.cmd',
        windowsCommandChain: {
          command: 'C:/Windows/System32/cmd.exe',
          argsPrefix: ['/d', '/s', '/c', 'D:/managed/node/npx.cmd'],
        },
      }
    })
    const service = createMcpRegistryService({
      store: fixture.store,
      connectorHub: {
        ...fixture.connectorHub,
        async testConnection(server) {
          if (server.transportConfig.kind !== 'stdio') {
            throw new Error('Expected stdio server.')
          }
          expect(server.transportConfig.command).toBe('C:/Windows/System32/cmd.exe')
          expect(server.transportConfig.args).toEqual([
            '/d',
            '/s',
            '/c',
            'D:/managed/node/npx.cmd',
            '@modelcontextprotocol/server-filesystem',
          ])
          return await fixture.connectorHub.testConnection(server)
        },
      },
      managedRuntimeService,
      now: () => '2026-04-21T12:00:00.000Z',
    })

    const result = await service.testConnection({
      draft: createMcpStdioStubServerFixture({
        transportConfig: {
          kind: 'stdio',
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem'],
        },
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('Expected MCP test connection success wrapper.')
    }
    expect(result.success).toBe(true)
  })

  it('surfaces a managed runtime error instead of falling back to command_not_found when uvx is unavailable', async () => {
    const fixture = await createRegistryServiceFixture('managed-uvx-unavailable')
    const service = createMcpRegistryService({
      store: fixture.store,
      connectorHub: {
        ...fixture.connectorHub,
        async testConnection(server) {
          if (server.transportConfig.kind !== 'stdio') {
            throw new Error('Expected stdio server.')
          }
          expect(server.transportConfig.command).toBe('__managed_runtime_unavailable__')
          expect(server.transportConfig.args).toEqual([])
          return {
            success: false,
            transportKind: 'stdio',
            toolCount: 0,
            durationMs: 12,
            phase: 'spawn',
            diagnosticSummary: 'managed runtime unavailable',
            error: {
              code: 'managed_runtime_unavailable',
              message: 'The managed Python/uv runtime is broken; repair is required before MCP can run uvx.',
              retryable: false,
              observedAt: '2026-04-21T12:00:00.000Z',
              details: {
                requestedCommand: 'uvx',
                managedFamily: 'uv',
                managedRuntimeStatus: 'broken',
              },
            },
            warnings: [],
          }
        },
      },
      managedRuntimeService: createManagedRuntimeServiceStub(async () => ({
        ok: false as const,
        reason: 'managed_runtime_unavailable',
        command: 'uvx',
        normalizedCommand: 'uvx',
        family: 'uv',
        status: 'broken',
        message: 'The managed Python/uv runtime is broken; repair is required before MCP can run uvx.',
        detail: 'uvx verification failed',
      })),
      now: () => '2026-04-21T12:00:00.000Z',
    })

    const result = await service.testConnection({
      draft: createMcpStdioStubServerFixture({
        transportConfig: {
          kind: 'stdio',
          command: 'uvx',
          args: ['mcp-server-time'],
        },
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('Expected MCP test connection result.')
    }
    expect(result.success).toBe(false)
    expect(result.error).toMatchObject({
      code: 'managed_runtime_unavailable',
      retryable: false,
      details: expect.objectContaining({
        requestedCommand: 'uvx',
        managedFamily: 'uv',
        managedRuntimeStatus: 'broken',
      }),
    })
  })

  it('rewrites saved uvx servers to the managed launcher and never executes the system PATH command', async () => {
    const fixture = await createRegistryServiceFixture('managed-uvx-saved-server')
    const managedRuntimeService = createManagedRuntimeServiceStub(async (command) => {
      expect(command).toBe('uvx')
      return {
        ok: true,
        command,
        normalizedCommand: 'uvx',
        family: 'uv',
        executablePath: 'D:/managed/uv/uvx.exe',
        windowsCommandChain: null,
      }
    })
    const service = createMcpRegistryService({
      store: fixture.store,
      connectorHub: {
        ...fixture.connectorHub,
        async testConnection(server) {
          if (server.transportConfig.kind !== 'stdio') {
            throw new Error('Expected stdio server.')
          }
          expect(server.transportConfig.command).toBe('D:/managed/uv/uvx.exe')
          expect(server.transportConfig.args).toEqual(['mcp-server-fetch'])
          return await fixture.connectorHub.testConnection(server)
        },
      },
      managedRuntimeService,
      now: () => '2026-04-21T12:00:00.000Z',
    })
    const savedServer = createMcpStdioStubServerFixture({
      serverId: 'fetch',
      transportConfig: {
        kind: 'stdio',
        command: 'uvx',
        args: ['mcp-server-fetch'],
      },
    })

    await service.saveServer(savedServer)
    const result = await service.testConnection({ serverId: 'fetch' })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('Expected MCP test connection success wrapper.')
    }
    expect(result.success).toBe(true)
  })

  it('keeps custom absolute paths and unmanaged commands unchanged', async () => {
    const fixture = await createRegistryServiceFixture('managed-command-bypass')
    const resolveLauncher = vi.fn(async () => ({
      ok: false as const,
      reason: 'unmanaged_command' as const,
      command: 'C:/custom/mcp-server.exe',
    }))
    const service = createMcpRegistryService({
      store: fixture.store,
      connectorHub: {
        ...fixture.connectorHub,
        async testConnection(server) {
          if (server.transportConfig.kind !== 'stdio') {
            throw new Error('Expected stdio server.')
          }
          expect(server.transportConfig.command).toBe('C:/custom/mcp-server.exe')
          expect(server.transportConfig.args).toEqual(['--stdio'])
          return await fixture.connectorHub.testConnection(server)
        },
      },
      managedRuntimeService: createManagedRuntimeServiceStub(resolveLauncher),
      now: () => '2026-04-21T12:00:00.000Z',
    })

    const result = await service.testConnection({
      draft: createMcpStdioStubServerFixture({
        transportConfig: {
          kind: 'stdio',
          command: 'C:/custom/mcp-server.exe',
          args: ['--stdio'],
        },
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('Expected MCP test connection result.')
    }
    expect(result.success).toBe(true)
    expect(resolveLauncher).toHaveBeenCalledOnce()
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

  it('automatically refreshes the catalog after saving an enabled server when reconcile has not hydrated tools yet', async () => {
    const fixture = await createRegistryServiceFixture('save-enabled-auto-sync', {
      reconcileHydratesCatalog: false,
    })
    const server = createMcpStdioStubServerFixture()

    const result = await fixture.service.saveServer(server)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('Expected saveServer to succeed.')
    }
    expect(result.state?.connectionState).toBe('connected')
    expect(result.state?.lastCatalogSyncAt).toBe('2026-04-21T12:00:00.000Z')
    expect(fixture.connectorHub.__getRefreshCatalogCalls()).toEqual([[server.serverId]])
    expect(fixture.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'catalog',
      serverId: server.serverId,
      refreshedServerIds: [server.serverId],
    }))

    const latestSnapshot = fixture.snapshotWrites[fixture.snapshotWrites.length - 1]
    expect(latestSnapshot?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        serverId: server.serverId,
        remoteToolName: 'search-campus',
      }),
    ]))
  })

  it('surfaces automatic connection or catalog-sync failures after saving an enabled server without requiring manual testConnection', async () => {
    const fixture = await createRegistryServiceFixture('save-enabled-auto-sync-failure', {
      reconcileHydratesCatalog: false,
      refreshCatalogSucceeds: false,
    })
    const server = createMcpStdioStubServerFixture()

    const result = await fixture.service.saveServer(server)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('Expected saveServer to succeed.')
    }
    expect(result.state?.connectionState).toBe('error')
    expect(result.state?.lastError).toEqual(expect.objectContaining({
      code: 'catalog_sync_failed',
    }))
    expect(fixture.connectorHub.__getRefreshCatalogCalls()).toEqual([[server.serverId]])
    expect(fixture.publishEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: 'catalog',
      serverId: server.serverId,
    }))
  })

  it('warms enabled servers on startup and publishes catalog updates without manual test connection', async () => {
    const fixture = await createRegistryServiceFixture('startup-warmup', {
      reconcileHydratesCatalog: false,
      refreshCatalogSucceeds: true,
    })
    const server = createMcpStdioStubServerFixture()

    await fixture.service.saveServer({
      ...server,
      enabled: false,
    })
    fixture.publishEvent.mockClear()
    fixture.snapshotWrites.splice(0)

    await fixture.service.setServerEnabled({
      serverId: server.serverId,
      enabled: true,
    })
    fixture.publishEvent.mockClear()
    fixture.snapshotWrites.splice(0)

    await expect(fixture.service.warmupEnabledServersOnStartup()).resolves.toBeUndefined()

    expect(fixture.connectorHub.__getRefreshCatalogCalls()).toEqual([[server.serverId], [server.serverId]])
    expect(fixture.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'catalog',
      refreshedServerIds: [server.serverId],
    }))

    const latestSnapshot = fixture.snapshotWrites[fixture.snapshotWrites.length - 1]
    expect(latestSnapshot?.tools).toEqual([
      expect.objectContaining({
        toolId: buildMcpToolId(server.serverId, 'search-campus'),
        serverId: server.serverId,
      }),
    ])
  })

  it('keeps startup warmup failures diagnosable without blocking snapshot publication', async () => {
    const fixture = await createRegistryServiceFixture('startup-warmup-failure', {
      reconcileHydratesCatalog: false,
      refreshCatalogSucceeds: false,
    })
    const server = createMcpStdioStubServerFixture()

    await fixture.service.saveServer({
      ...server,
      enabled: false,
    })
    fixture.publishEvent.mockClear()
    fixture.snapshotWrites.splice(0)

    await fixture.service.setServerEnabled({
      serverId: server.serverId,
      enabled: true,
    })
    fixture.publishEvent.mockClear()
    fixture.snapshotWrites.splice(0)

    await expect(fixture.service.warmupEnabledServersOnStartup()).resolves.toBeUndefined()

    const latestSnapshot = fixture.snapshotWrites[fixture.snapshotWrites.length - 1]
    expect(latestSnapshot?.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        serverId: server.serverId,
        connectionState: 'error',
        toolCount: 0,
        lastSuccessfulCatalogRefresh: null,
        lastError: expect.objectContaining({
          code: 'catalog_sync_failed',
        }),
      }),
    ]))
    expect(fixture.publishEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'snapshot' }))
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

  it('reuses the managed catalog after a successful saved-server connection test instead of forcing a second refresh', async () => {
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
    expect(fixture.connectorHub.__getRefreshCatalogCalls()).toEqual([])

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

  it('falls back to a catalog refresh after a successful saved-server connection test when the managed connector has no hydrated catalog', async () => {
    const fixture = await createRegistryServiceFixture('test-sync-refresh-fallback')
    const server = createMcpStdioStubServerFixture()
    await fixture.store.saveServers([server])

    const refreshCatalogCalls: Array<readonly string[] | null> = []
    let managedState = createMcpServerStateFixture(server, {
      connectionState: 'connected',
      toolCount: 0,
      lastCatalogSyncAt: null,
    })
    let managedTools: McpRemoteToolSummary[] = []

    const service = createMcpRegistryService({
      store: fixture.store,
      connectorHub: {
        ...fixture.connectorHub,
        async reconcile(servers) {
          const matchingServer = servers.find((entry) => entry.serverId === server.serverId) ?? server
          managedState = createMcpServerStateFixture(matchingServer, {
            connectionState: 'connected',
            toolCount: 0,
            lastCatalogSyncAt: null,
          })
          managedTools = []
          return { states: servers.map((entry) => entry.serverId === server.serverId ? managedState : createStateForServer(entry)) }
        },
        async testConnection(targetServer) {
          return {
            success: true,
            transportKind: targetServer.transportKind,
            toolCount: STUB_TOOLS.length,
            durationMs: 12,
            phase: null,
            diagnosticSummary: null,
            error: null,
            warnings: [],
          }
        },
        async refreshCatalog(serverIds) {
          refreshCatalogCalls.push(serverIds === null ? null : [...serverIds])
          managedState = createMcpServerStateFixture(server, {
            connectionState: 'connected',
            toolCount: STUB_TOOLS.length,
            lastCatalogSyncAt: '2026-04-21T12:00:00.000Z',
          })
          managedTools = STUB_TOOLS.map((tool) => ({
            ...tool,
            inputSchema: { ...tool.inputSchema },
          }))
          return [{
            serverId: server.serverId,
            success: true,
            toolCount: STUB_TOOLS.length,
            state: managedState,
            error: null,
          }]
        },
        getState(serverId) {
          return serverId === server.serverId ? managedState : null
        },
        getAllStates(servers) {
          if (servers === undefined) {
            return [managedState]
          }

          return servers.map((entry) => entry.serverId === server.serverId ? managedState : createStateForServer(entry))
        },
        getTools(serverId) {
          return serverId === server.serverId
            ? managedTools.map((tool) => ({
                ...tool,
                inputSchema: { ...tool.inputSchema },
              }))
            : []
        },
      },
      snapshotSink: fixture.snapshotSink,
      publishEvent: fixture.publishEvent,
      now: () => '2026-04-21T12:00:00.000Z',
    })

    const result = await service.testConnection({
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
    expect(refreshCatalogCalls).toEqual([[server.serverId]])

    const latestSnapshot = fixture.snapshotWrites[fixture.snapshotWrites.length - 1]
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
        details: {
          requestedServerId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
          requestedRemoteToolName: 'missing-tool',
          connectorToolCount: 1,
          requestedSnapshotRevision: 0,
          snapshotRevision: 1,
        },
      },
    })
  })

  it('surfaces first-call readiness failures when a saved server is connected but the managed catalog has not hydrated yet', async () => {
    const fixture = await createRegistryServiceFixture('execute-tool-first-call-ready-window', {
      reconcileHydratesCatalog: false,
      callToolRequiresHydratedCatalog: true,
    })
    const server = createMcpStdioStubServerFixture()
    await fixture.service.saveServer(server)
    await fixture.connectorHub.reconcile([server], { registryRevision: 1, snapshotRevision: 8 })

    const result = await fixture.service.executeTool({
      toolId: 'mcp.missing.tool.11111111',
      serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
      remoteToolName: 'search-campus',
      arguments: { keyword: 'calendar' },
      runId: 'run-1',
      toolCallId: 'call-1',
      snapshotRevision: 7,
    })

    expect(result).toEqual({
      ok: false,
      toolId: 'mcp.missing.tool.11111111',
      serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
      remoteToolName: 'search-campus',
      snapshotRevision: 1,
      error: {
        code: 'server_not_ready',
        message: 'The MCP server is not ready to execute tools.',
        retryable: true,
        observedAt: '2026-04-21T12:00:00.000Z',
        details: {
          requestedServerId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
          requestedRemoteToolName: 'search-campus',
          connectionState: 'connected',
          connectorToolCount: 0,
          requestedSnapshotRevision: 1,
          snapshotRevision: 1,
        },
      },
    })
    expect(fixture.connectorHub.__getToolCallRequests()).toEqual([
      expect.objectContaining({
        toolId: 'mcp.missing.tool.11111111',
        serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
        remoteToolName: 'search-campus',
        arguments: { keyword: 'calendar' },
        snapshotRevision: 1,
      }),
    ])
  })

  it('includes layered diagnostics when MCP target resolution fails', async () => {
    const fixture = await createRegistryServiceFixture('execute-tool-diagnostics')
    const server = createMcpStdioStubServerFixture({ enabled: false })
    await fixture.store.saveServers([server])

    const result = await fixture.service.executeTool({
      toolId: 'mcp.missing.tool.00000000',
      serverId: server.serverId,
      remoteToolName: 'search-campus',
      arguments: {},
      runId: 'run-1',
      toolCallId: 'call-2',
      snapshotRevision: 7,
    })

    expect(result).toEqual({
      ok: false,
      toolId: 'mcp.missing.tool.00000000',
      serverId: server.serverId,
      remoteToolName: 'search-campus',
      snapshotRevision: 7,
      error: {
        code: 'server_not_ready',
        message: 'The MCP server is not ready to execute tools.',
        retryable: true,
        observedAt: '2026-04-21T12:00:00.000Z',
        details: {
          requestedServerId: server.serverId,
          requestedRemoteToolName: 'search-campus',
          connectionState: 'disabled',
          connectorToolCount: 0,
          requestedSnapshotRevision: 7,
          snapshotRevision: 0,
        },
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
