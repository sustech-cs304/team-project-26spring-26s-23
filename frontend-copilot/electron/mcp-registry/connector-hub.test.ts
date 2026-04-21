import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMcpConnectorHub } from './connector-hub'
import { createMcpHttpSseStubServerFixture, createMcpStdioStubServerFixture } from './test-support'
import type { McpRegistrySubscriptionEvent, McpServerRecord, McpServerStateSummary, McpToolCallResult } from './types'
import type { McpConnectorOperationResult, McpServerConnector } from './connectors/protocol'
import { createConnectorFailure, createConnectorState, createConnectorSuccess, createMcpErrorSummary } from './connectors/protocol'

afterEach(() => {
  vi.useRealTimers()
})

describe('createMcpConnectorHub', () => {
  it('reconciles enabled servers, disables disabled servers, and publishes state updates', async () => {
    const publishedEvents: McpRegistrySubscriptionEvent[] = []
    const stdioServer = createMcpStdioStubServerFixture()
    const disabledServer = createMcpHttpSseStubServerFixture({ enabled: false })

    const hub = createMcpConnectorHub({
      now: () => '2026-04-21T12:00:00.000Z',
      publishEvent(event) {
        publishedEvents.push(event)
      },
      createConnector(server, context) {
        return createFakeConnector(server, context, {
          startResults: [createSuccessfulResult(server)],
          refreshResults: [createSuccessfulResult(server)],
        })
      },
    })

    const result = await hub.reconcile([stdioServer, disabledServer], { registryRevision: 3, snapshotRevision: 8 })

    expect(result.states).toHaveLength(2)
    expect(hub.getState(stdioServer.serverId)?.connectionState).toBe('connected')
    expect(hub.getState(disabledServer.serverId)?.connectionState).toBe('disabled')
    expect(hub.getTools(stdioServer.serverId)).toHaveLength(1)
    expect(hub.getTools(disabledServer.serverId)).toHaveLength(0)
    expect(publishedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'server-state',
        serverId: stdioServer.serverId,
        state: expect.objectContaining({ connectionState: 'connected', toolCount: 1 }),
      }),
      expect.objectContaining({
        kind: 'server-state',
        serverId: disabledServer.serverId,
        state: expect.objectContaining({ connectionState: 'disabled', toolCount: 0 }),
      }),
    ]))
  })

  it('refreshes only targeted managed connectors and reports connector failures', async () => {
    const stdioServer = createMcpStdioStubServerFixture()
    const httpServer = createMcpHttpSseStubServerFixture()
    const publishedEvents: McpRegistrySubscriptionEvent[] = []

    const hub = createMcpConnectorHub({
      now: () => '2026-04-21T12:00:00.000Z',
      publishEvent(event) {
        publishedEvents.push(event)
      },
      createConnector(server, context) {
        if (server.serverId === stdioServer.serverId) {
          return createFakeConnector(server, context, {
            startResults: [createSuccessfulResult(server)],
            refreshResults: [createSuccessfulResult(server)],
          })
        }

        return createFakeConnector(server, context, {
          startResults: [createSuccessfulResult(server)],
          refreshResults: [createRetryableFailure(server, 'http_server_error')],
        })
      },
    })

    await hub.reconcile([stdioServer, httpServer], { registryRevision: 4, snapshotRevision: 9 })
    const refreshed = await hub.refreshCatalog([httpServer.serverId], { registryRevision: 4, snapshotRevision: 9 })

    expect(refreshed).toEqual([
      expect.objectContaining({
        serverId: httpServer.serverId,
        success: false,
        state: expect.objectContaining({ connectionState: 'degraded', toolCount: 1 }),
        error: expect.objectContaining({ code: 'http_server_error', retryable: true }),
      }),
    ])
    expect(hub.getState(stdioServer.serverId)?.connectionState).toBe('connected')
    expect(publishedEvents.some((event) => event.kind === 'server-state' && event.serverId === httpServer.serverId)).toBe(true)
  })

  it('performs limited retry recovery for retryable connector failures', async () => {
    vi.useFakeTimers()

    const stdioServer = createMcpStdioStubServerFixture()
    const publishedEvents: McpRegistrySubscriptionEvent[] = []
    let startCalls = 0

    const hub = createMcpConnectorHub({
      now: () => '2026-04-21T12:00:00.000Z',
      reconnectDelayMs: 10,
      publishEvent(event) {
        publishedEvents.push(event)
      },
      createConnector(server, context) {
        return createFakeConnector(server, context, {
          startResults: [
            createRetryableFailure(server, 'process_exited'),
            createSuccessfulResult(server),
          ],
        }, {
          onStart() {
            startCalls += 1
          },
        })
      },
    })

    await hub.reconcile([stdioServer], { registryRevision: 5, snapshotRevision: 9 })
    await vi.advanceTimersByTimeAsync(20)
    await Promise.resolve()

    expect(startCalls).toBe(2)
    expect(hub.getState(stdioServer.serverId)?.connectionState).toBe('connected')
    expect(publishedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'server-state',
        serverId: stdioServer.serverId,
        state: expect.objectContaining({ connectionState: 'connecting', reconnectAttempt: 1 }),
      }),
      expect.objectContaining({
        kind: 'server-state',
        serverId: stdioServer.serverId,
        state: expect.objectContaining({ connectionState: 'connected', toolCount: 1 }),
      }),
    ]))
  })

  it('ignores stale reconnect work after a server entry is replaced during reconciliation', async () => {
    vi.useFakeTimers()

    const stdioServer = createMcpStdioStubServerFixture()
    const replacementServer = createMcpStdioStubServerFixture({
      transportConfig: stdioServer.transportConfig.kind === 'stdio'
        ? {
            ...stdioServer.transportConfig,
            args: [...stdioServer.transportConfig.args, '--replacement'],
          }
        : stdioServer.transportConfig,
      updatedAt: '2026-04-21T12:05:00.000Z',
    })
    const startCalls: string[] = []

    const hub = createMcpConnectorHub({
      now: () => '2026-04-21T12:00:00.000Z',
      reconnectDelayMs: 10,
      createConnector(server, context) {
        const connectorLabel = server.transportConfig.kind === 'stdio' && server.transportConfig.args.includes('--replacement')
          ? 'replacement'
          : 'original'
        return createFakeConnector(server, context, {
          startResults: connectorLabel === 'original'
            ? [
                createRetryableFailure(server, 'process_exited'),
                createSuccessfulResult(server),
              ]
            : [createSuccessfulResult(server)],
        }, {
          onStart() {
            startCalls.push(connectorLabel)
          },
        })
      },
    })

    await hub.reconcile([stdioServer], { registryRevision: 7, snapshotRevision: 10 })
    await hub.reconcile([replacementServer], { registryRevision: 8, snapshotRevision: 10 })
    await vi.advanceTimersByTimeAsync(20)
    await Promise.resolve()

    expect(startCalls).toEqual(['original', 'replacement'])
    expect(hub.getState(stdioServer.serverId)).toMatchObject({
      connectionState: 'connected',
      reconnectAttempt: 0,
    })
  })

  it('routes tool calls to managed connectors and rejects tools missing from the current catalog', async () => {
    const stdioServer = createMcpStdioStubServerFixture()
    const capturedRequests: Array<{ toolId: string, remoteToolName: string, arguments: Record<string, unknown> }> = []

    const hub = createMcpConnectorHub({
      now: () => '2026-04-21T12:00:00.000Z',
      createConnector(server, context) {
        return createFakeConnector(server, context, {
          startResults: [createSuccessfulResult(server)],
        }, {
          onCallTool(request) {
            capturedRequests.push({
              toolId: request.toolId,
              remoteToolName: request.remoteToolName,
              arguments: request.arguments,
            })
          },
        })
      },
    })

    await hub.reconcile([stdioServer], { registryRevision: 6, snapshotRevision: 10 })

    await expect(hub.callTool({
      toolId: 'mcp.test.search-campus',
      serverId: stdioServer.serverId,
      remoteToolName: 'search-campus',
      arguments: { keyword: 'calendar' },
      runId: 'run-1',
      toolCallId: 'call-1',
      snapshotRevision: 10,
    })).resolves.toEqual({
      ok: true,
      toolId: 'mcp.test.search-campus',
      serverId: stdioServer.serverId,
      remoteToolName: 'search-campus',
      content: [{ type: 'text', text: '{"keyword":"calendar"}' }],
      structuredContent: { echoedArguments: { keyword: 'calendar' } },
      snapshotRevision: 10,
      isError: false,
    })

    await expect(hub.callTool({
      toolId: 'mcp.test.missing',
      serverId: stdioServer.serverId,
      remoteToolName: 'missing-tool',
      arguments: {},
      runId: 'run-1',
      toolCallId: 'call-2',
      snapshotRevision: 10,
    })).resolves.toEqual({
      ok: false,
      toolId: 'mcp.test.missing',
      serverId: stdioServer.serverId,
      remoteToolName: 'missing-tool',
      snapshotRevision: 10,
      error: expect.objectContaining({
        code: 'directory_drift',
        message: 'The requested MCP tool no longer exists in the current server catalog.',
        retryable: false,
        observedAt: '2026-04-21T12:00:00.000Z',
      }),
    })

    expect(capturedRequests).toEqual([
      {
        toolId: 'mcp.test.search-campus',
        remoteToolName: 'search-campus',
        arguments: { keyword: 'calendar' },
      },
    ])
  })

  it('returns the last connection phase and diagnostic summary for connection test failures', async () => {
    const stdioServer = createMcpStdioStubServerFixture()

    const hub = createMcpConnectorHub({
      now: () => '2026-04-21T12:00:00.000Z',
      createConnector(server, context) {
        return createFakeConnector(server, context, {
          startResults: [createConnectorFailure(server, createMcpErrorSummary(
            'timeout',
            'Timed out while waiting for the MCP stdio server response during initialize.',
            true,
            () => '2026-04-21T12:00:00.000Z',
            {
              phase: 'initialize',
              diagnosticSummary: 'phase=initialize; command=uvx mcp-server-fetch; stderr=booting',
            },
          ), () => '2026-04-21T12:00:00.000Z', {
            kind: 'stdio',
            processStatus: 'running',
            pid: 4102,
            lastExitCode: null,
            lastExitSignal: null,
          }, {
            lastPhase: 'initialize',
            warnings: ['booting'],
          })],
        })
      },
    })

    await expect(hub.testConnection(stdioServer)).resolves.toEqual({
      success: false,
      transportKind: 'stdio',
      toolCount: 0,
      durationMs: expect.any(Number),
      phase: 'initialize',
      diagnosticSummary: 'phase=initialize; command=uvx mcp-server-fetch; stderr=booting',
      error: expect.objectContaining({
        code: 'timeout',
        message: 'Timed out while waiting for the MCP stdio server response during initialize.',
      }),
      warnings: ['booting'],
    })
  })
})

function createFakeConnector(
  server: McpServerRecord,
  context: { onStateChange: (state: McpServerStateSummary) => void | Promise<void> },
  sequences: {
    startResults: McpConnectorOperationResult[]
    refreshResults?: McpConnectorOperationResult[]
    callToolResults?: McpToolCallResult[]
  },
  hooks: {
    onStart?: () => void
    onRefresh?: () => void
    onCallTool?: (request: { toolId: string, remoteToolName: string, arguments: Record<string, unknown> }) => void
  } = {},
): McpServerConnector {
  let state = createConnectorState(server, server.enabled ? 'idle' : 'disabled', 0, () => '2026-04-21T12:00:00.000Z')
  let tools = [] as ReturnType<typeof createSuccessfulResult>['tools']
  const startQueue = [...sequences.startResults]
  const refreshQueue = [...(sequences.refreshResults ?? sequences.startResults)]
  const callToolQueue = [...(sequences.callToolResults ?? [])]

  return {
    async start() {
      hooks.onStart?.()
      const result = startQueue.shift() ?? createSuccessfulResult(server)
      state = result.state
      tools = result.tools
      await context.onStateChange(state)
      return result
    },
    async refreshCatalog() {
      hooks.onRefresh?.()
      const result = refreshQueue.shift() ?? createSuccessfulResult(server)
      state = result.state
      tools = result.tools
      await context.onStateChange(state)
      return result
    },
    async callTool(request) {
      hooks.onCallTool?.({
        toolId: request.toolId,
        remoteToolName: request.remoteToolName,
        arguments: request.arguments,
      })
      const result = callToolQueue.shift()
      if (result !== undefined) {
        return result
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
    async stop() {
      state = createConnectorState(server, 'idle', 0, () => '2026-04-21T12:00:00.000Z')
      tools = []
    },
    getState() {
      return state
    },
    getTools() {
      return tools
    },
  }
}

function createSuccessfulResult(server: McpServerRecord): McpConnectorOperationResult {
  return createConnectorSuccess(server, [{
    name: 'search-campus',
    displayName: 'Search Campus',
    description: 'Search the campus knowledge base.',
    inputSchema: { type: 'object' },
  }], () => '2026-04-21T12:00:00.000Z', server.transportKind === 'stdio'
    ? {
        kind: 'stdio',
        processStatus: 'running',
        pid: 4102,
        lastExitCode: null,
        lastExitSignal: null,
      }
    : {
        kind: 'http-sse',
        endpointStatus: 'online',
        lastHttpStatus: 200,
        sseOnline: true,
      })
}

function createRetryableFailure(server: McpServerRecord, code: string): McpConnectorOperationResult {
  return createConnectorFailure(server, createMcpErrorSummary(
    code,
    'Temporary connector failure.',
    true,
    () => '2026-04-21T12:00:00.000Z',
  ), () => '2026-04-21T12:00:00.000Z', server.transportKind === 'stdio'
    ? {
        kind: 'stdio',
        processStatus: 'exited',
        pid: null,
        lastExitCode: 1,
        lastExitSignal: null,
      }
    : {
        kind: 'http-sse',
        endpointStatus: 'offline',
        lastHttpStatus: 503,
        sseOnline: false,
      }, {
        previousTools: [{
          name: 'search-campus',
          displayName: 'Search Campus',
          description: 'Search the campus knowledge base.',
          inputSchema: { type: 'object' },
        }],
      })
}
