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
  createMcpServerStateFixture,
  createMcpStdioStubServerFixture,
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

})