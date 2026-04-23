import type {
  McpCapabilitySnapshot,
  McpDeleteServerSuccess,
  McpErrorSummary,
  McpRefreshCatalogSuccess,
  McpRegistryLoadSuccess,
  McpRegistrySubscriptionEvent,
  McpSaveServerSuccess,
  McpServerRecord,
  McpServerStateSummary,
  McpSetServerEnabledSuccess,
  McpSnapshotGroupSummary,
  McpSnapshotServerSummary,
  McpSnapshotToolSummary,
  McpTestConnectionSuccess,
  McpToolCallFailure,
  McpToolCallRequest,
  McpToolCallSuccess,
} from './types'
import { MCP_SNAPSHOT_VERSION } from './types'
import { buildMcpToolId } from './snapshot'

export const MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS = Object.freeze({
  stdio: 'mcp-stdio-stub',
  httpSse: 'mcp-http-sse-stub',
})

export function createMcpStdioStubServerFixture(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
    displayName: 'stdio stub server',
    enabled: true,
    transportKind: 'stdio',
    description: 'Contract fixture for a local stdio-backed MCP server.',
    transportConfig: {
      kind: 'stdio',
      command: 'node',
      args: ['fixtures/stdio-stub-server.mjs'],
      cwd: 'D:/workspace/mcp-fixtures',
      env: {
        MCP_FIXTURE_PROFILE: 'stdio',
      },
    },
    createdAt: '2026-04-21T08:00:00Z',
    updatedAt: '2026-04-21T08:00:00Z',
    reservedSensitiveFields: ['env.OPENAI_API_KEY'],
    ...overrides,
  }
}

export function createMcpHttpSseStubServerFixture(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.httpSse,
    displayName: 'http sse stub server',
    enabled: true,
    transportKind: 'http-sse',
    description: 'Contract fixture for a remote HTTP/SSE-backed MCP server.',
    transportConfig: {
      kind: 'http-sse',
      baseUrl: 'http://127.0.0.1:34081/mcp',
      headers: {
        'X-Fixture-Profile': 'http-sse',
      },
      env: {
        MCP_FIXTURE_PROFILE: 'http-sse',
      },
      ssePathOverride: '/events',
    },
    createdAt: '2026-04-21T08:05:00Z',
    updatedAt: '2026-04-21T08:05:00Z',
    reservedSensitiveFields: ['headers.Authorization'],
    ...overrides,
  }
}

export function createMcpServerStateFixture(
  server: McpServerRecord,
  overrides: Partial<McpServerStateSummary> = {},
): McpServerStateSummary {
  const transportState = server.transportKind === 'stdio'
    ? {
        kind: 'stdio' as const,
        processStatus: 'running' as const,
        pid: 4102,
      }
    : {
        kind: 'http-sse' as const,
        endpointStatus: 'online' as const,
        lastHttpStatus: 200,
        sseOnline: true,
      }

  return {
    serverId: server.serverId,
    enabled: server.enabled,
    connectionState: server.enabled ? 'connected' : 'disabled',
    toolCount: server.transportKind === 'stdio' ? 1 : 2,
    lastHandshakeAt: '2026-04-21T08:10:00Z',
    lastCatalogSyncAt: '2026-04-21T08:12:00Z',
    lastError: null,
    transportState,
    reconnectAttempt: 0,
    ...overrides,
  }
}

export function createMcpRegistryLoadResultFixture(): McpRegistryLoadSuccess {
  const stdioServer = createMcpStdioStubServerFixture()
  const httpSseServer = createMcpHttpSseStubServerFixture()

  return {
    ok: true,
    registryRevision: 3,
    snapshotRevision: 8,
    servers: [stdioServer, httpSseServer],
    states: [
      createMcpServerStateFixture(stdioServer),
      createMcpServerStateFixture(httpSseServer, {
        toolCount: 2,
      }),
    ],
  }
}

export function createMcpSaveServerSuccessFixture(
  overrides: {
    registryRevision?: number
    snapshotRevision?: number
    server?: Partial<McpServerRecord>
    state?: Partial<McpServerStateSummary>
    validationErrors?: McpSaveServerSuccess['validationErrors']
  } = {},
): McpSaveServerSuccess {
  const server = createMcpStdioStubServerFixture({
    updatedAt: '2026-04-21T08:20:00Z',
    ...(overrides.server ?? {}),
  })

  return {
    ok: true,
    registryRevision: overrides.registryRevision ?? 4,
    snapshotRevision: overrides.snapshotRevision ?? 9,
    server,
    state: createMcpServerStateFixture(server, overrides.state),
    validationErrors: overrides.validationErrors ?? [],
  }
}

export function createMcpDeleteServerSuccessFixture(
  serverId: string = MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
): McpDeleteServerSuccess {
  return {
    ok: true,
    registryRevision: 5,
    snapshotRevision: 9,
    serverId,
    deleted: true,
  }
}

export function createMcpSetServerEnabledSuccessFixture(enabled: boolean): McpSetServerEnabledSuccess {
  const server = createMcpHttpSseStubServerFixture({ enabled, updatedAt: '2026-04-21T08:30:00Z' })

  return {
    ok: true,
    registryRevision: 6,
    snapshotRevision: enabled ? 10 : 9,
    server,
    state: createMcpServerStateFixture(server, {
      connectionState: enabled ? 'connected' : 'disabled',
      enabled,
      toolCount: enabled ? 2 : 0,
    }),
  }
}

export function createMcpTestConnectionSuccessFixture(transportKind: 'stdio' | 'http-sse' = 'stdio'): McpTestConnectionSuccess {
  return {
    ok: true,
    success: true,
    transportKind,
    toolCount: transportKind === 'stdio' ? 1 : 2,
    durationMs: transportKind === 'stdio' ? 46 : 71,
    phase: null,
    diagnosticSummary: null,
    error: null,
    warnings: [],
  }
}

export function createMcpRefreshCatalogSuccessFixture(): McpRefreshCatalogSuccess {
  return {
    ok: true,
    registryRevision: 6,
    snapshotRevision: 10,
    refreshedServerIds: [
      MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
      MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.httpSse,
    ],
    results: [
      {
        serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
        toolCount: 1,
        connectionState: 'connected',
        error: null,
      },
      {
        serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.httpSse,
        toolCount: 2,
        connectionState: 'connected',
        error: null,
      },
    ],
  }
}

export function createMcpRegistrySubscriptionEventFixture(
  kind: McpRegistrySubscriptionEvent['kind'] = 'snapshot',
): McpRegistrySubscriptionEvent {
  const loadResult = createMcpRegistryLoadResultFixture()

  if (kind === 'snapshot') {
    return {
      kind,
      registryRevision: loadResult.registryRevision,
      snapshotRevision: loadResult.snapshotRevision,
      servers: loadResult.servers,
      states: loadResult.states,
    }
  }

  if (kind === 'server-state') {
    return {
      kind,
      registryRevision: loadResult.registryRevision,
      snapshotRevision: loadResult.snapshotRevision,
      serverId: loadResult.states[0].serverId,
      state: loadResult.states[0],
    }
  }

  if (kind === 'server-removed') {
    return {
      kind,
      registryRevision: loadResult.registryRevision,
      snapshotRevision: loadResult.snapshotRevision,
      serverId: loadResult.servers[0].serverId,
    }
  }

  return {
    kind,
    registryRevision: loadResult.registryRevision,
    snapshotRevision: loadResult.snapshotRevision,
    serverId: loadResult.servers[1].serverId,
    refreshedServerIds: loadResult.servers.map((server) => server.serverId),
  }
}

export function createMcpCapabilitySnapshotFixture(): McpCapabilitySnapshot {
  const stdioServer = createMcpStdioStubServerFixture()
  const httpSseServer = createMcpHttpSseStubServerFixture()
  const searchCampusToolId = buildMcpToolId(stdioServer.serverId, 'search-campus')
  const calendarToolId = buildMcpToolId(httpSseServer.serverId, 'fetch-calendar')

  const servers: McpSnapshotServerSummary[] = [
    {
      serverId: stdioServer.serverId,
      displayName: stdioServer.displayName,
      transportKind: stdioServer.transportKind,
      connectionState: 'connected',
      toolCount: 1,
      lastHandshakeAt: '2026-04-21T08:10:00Z',
      lastCatalogSyncAt: '2026-04-21T08:12:00Z',
      lastError: null,
    },
    {
      serverId: httpSseServer.serverId,
      displayName: httpSseServer.displayName,
      transportKind: httpSseServer.transportKind,
      connectionState: 'connected',
      toolCount: 1,
      lastHandshakeAt: '2026-04-21T08:11:00Z',
      lastCatalogSyncAt: '2026-04-21T08:13:00Z',
      lastError: null,
    },
  ]

  const tools: McpSnapshotToolSummary[] = [
    {
      toolId: searchCampusToolId,
      serverId: stdioServer.serverId,
      remoteToolName: 'search-campus',
      displayName: 'Search Campus',
      description: 'Search the campus knowledge base.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          keyword: { type: 'string' },
        },
        required: ['keyword'],
      },
      sourceKind: 'mcp',
      availability: 'available',
      groupId: 'mcp-search',
      groupLabel: 'Search',
    },
    {
      toolId: calendarToolId,
      serverId: httpSseServer.serverId,
      remoteToolName: 'fetch-calendar',
      displayName: 'Fetch Calendar',
      description: 'Fetch the current course calendar.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      sourceKind: 'mcp',
      availability: 'available',
      groupId: 'mcp-productivity',
      groupLabel: 'Productivity',
    },
  ]

  const groups: McpSnapshotGroupSummary[] = [
    {
      groupId: 'mcp-search',
      displayName: 'Search',
      sourceKind: 'mcp',
      toolIds: [searchCampusToolId],
    },
    {
      groupId: 'mcp-productivity',
      displayName: 'Productivity',
      sourceKind: 'mcp',
      toolIds: [calendarToolId],
    },
  ]

  return {
    version: MCP_SNAPSHOT_VERSION,
    registryRevision: 3,
    snapshotRevision: 8,
    generatedAt: '2026-04-21T08:15:00Z',
    servers,
    tools,
    groups,
  }
}

export function createMcpToolCallRequestFixture(): McpToolCallRequest {
  const toolId = buildMcpToolId(MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio, 'search-campus')

  return {
    toolId,
    serverId: MCP_REGISTRY_TEST_FIXTURE_SERVER_IDS.stdio,
    remoteToolName: 'search-campus',
    arguments: {
      keyword: 'library',
    },
    runId: 'run-1',
    toolCallId: 'tool-call-1',
    snapshotRevision: 8,
  }
}

export function createMcpToolCallSuccessFixture(): McpToolCallSuccess {
  const request = createMcpToolCallRequestFixture()

  return {
    ok: true,
    toolId: request.toolId,
    serverId: request.serverId,
    remoteToolName: request.remoteToolName,
    snapshotRevision: request.snapshotRevision,
    content: [
      {
        type: 'text',
        text: 'Found three matching library resources.',
      },
    ],
    structuredContent: {
      resultCount: 3,
    },
    isError: false,
  }
}

export function createMcpDirectoryDriftToolCallFailureFixture(): McpToolCallFailure {
  const request = createMcpToolCallRequestFixture()

  return {
    ok: false,
    toolId: request.toolId,
    serverId: request.serverId,
    remoteToolName: request.remoteToolName,
    snapshotRevision: request.snapshotRevision,
    error: createMcpErrorSummaryFixture({
      code: 'directory_drift',
      message: 'The requested MCP tool no longer exists in the current snapshot.',
      retryable: false,
    }),
  }
}

export function createMcpErrorSummaryFixture(overrides: Partial<McpErrorSummary> = {}): McpErrorSummary {
  return {
    code: 'temporarily_unavailable',
    message: 'The MCP server is temporarily unavailable.',
    retryable: true,
    observedAt: '2026-04-21T08:40:00Z',
    details: null,
    ...overrides,
  }
}
