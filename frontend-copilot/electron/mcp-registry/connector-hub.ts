import type {
  McpConnectionPhase,
  McpErrorSummary,
  McpRegistrySubscriptionEvent,
  McpServerRecord,
  McpServerStateSummary,
  McpToolCallRequest,
  McpToolCallResult,
  McpTransportKind,
} from './types'
import type {
  McpConnectorOperationResult,
  McpConnectorToolCallRequest,
  McpRemoteToolSummary,
  McpServerConnector,
} from './connectors/protocol'
import {
  cloneRemoteTools,
  cloneStateSummary,
  createConnectorState,
  createDefaultTransportState,
  createMcpErrorSummary,
  isRetryableError,
} from './connectors/protocol'
import { createStdioMcpServerConnector } from './connectors/stdio'
import { createHttpSseMcpServerConnector } from './connectors/http-sse'

const DEFAULT_CONNECTOR_TIMEOUT_MS = 5_000
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 2
const DEFAULT_RECONNECT_DELAY_MS = 50

export interface McpConnectorHubRevisionState {
  registryRevision: number
  snapshotRevision: number
}

export interface McpConnectorHubRefreshCatalogResult {
  serverId: string
  success: boolean
  toolCount: number
  state: McpServerStateSummary
  error: McpErrorSummary | null
}

export interface McpConnectorHubTestConnectionResult {
  success: boolean
  transportKind: McpTransportKind
  toolCount: number
  durationMs: number
  phase: McpConnectionPhase | null
  diagnosticSummary: string | null
  error: McpErrorSummary | null
  warnings: string[]
}

export interface McpConnectorHubReconcileResult {
  states: McpServerStateSummary[]
}

export interface McpConnectorHub {
  reconcile(servers: readonly McpServerRecord[], revisions: McpConnectorHubRevisionState): Promise<McpConnectorHubReconcileResult>
  removeServer(serverId: string, revisions: McpConnectorHubRevisionState): Promise<void>
  setServerDisabled(server: McpServerRecord, revisions: McpConnectorHubRevisionState): Promise<McpServerStateSummary>
  testConnection(server: McpServerRecord): Promise<McpConnectorHubTestConnectionResult>
  refreshCatalog(serverIds: readonly string[] | null, revisions: McpConnectorHubRevisionState): Promise<McpConnectorHubRefreshCatalogResult[]>
  callTool(request: McpToolCallRequest): Promise<McpToolCallResult>
  getState(serverId: string): McpServerStateSummary | null
  getAllStates(servers?: readonly McpServerRecord[]): McpServerStateSummary[]
  getTools(serverId: string): McpRemoteToolSummary[]
  stopAll(): Promise<void>
}

export interface CreateMcpConnectorHubOptions {
  now?: () => string
  publishEvent?: (event: McpRegistrySubscriptionEvent) => void | Promise<void>
  timeoutMs?: number
  maxReconnectAttempts?: number
  reconnectDelayMs?: number
  createConnector?: (server: McpServerRecord, context: ConnectorContextFactoryInput) => McpServerConnector
  getResolvedCommand?: (server: McpServerRecord) => {
    requestedCommand: string
    resolutionKind: 'raw' | 'managed'
    managedFamily?: 'node' | 'uv'
  } | null
}

export interface ConnectorContextFactoryInput {
  timeoutMs: number
  now: () => string
  onStateChange: (state: McpServerStateSummary) => void | Promise<void>
}

export type McpConnectorHubToolCallFailure = Extract<McpToolCallResult, { ok: false }>

interface ManagedConnectorEntry {
  server: McpServerRecord
  connector: McpServerConnector
  reconnectAttempt: number
  restarting: boolean
}

interface HubContext {
  now: () => string
  timeoutMs: number
  maxReconnectAttempts: number
  reconnectDelayMs: number
  entries: Map<string, ManagedConnectorEntry>
  states: Map<string, McpServerStateSummary>
  currentRevisions: McpConnectorHubRevisionState
  options: CreateMcpConnectorHubOptions
}

export function createMcpConnectorHub(options: CreateMcpConnectorHubOptions = {}): McpConnectorHub {
  const ctx: HubContext = {
    now: options.now ?? (() => new Date().toISOString()),
    timeoutMs: options.timeoutMs ?? DEFAULT_CONNECTOR_TIMEOUT_MS,
    maxReconnectAttempts: options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
    reconnectDelayMs: options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
    entries: new Map(),
    states: new Map(),
    currentRevisions: { registryRevision: 0, snapshotRevision: 0 },
    options,
  }

  return {
    reconcile: (servers, revisions) => hubReconcile(ctx, servers, revisions),
    removeServer: (serverId, revisions) => hubRemoveServer(ctx, serverId, revisions),
    setServerDisabled: (server, revisions) => hubSetDisabled(ctx, server, revisions),
    testConnection: (server) => hubTestConnection(ctx, server),
    refreshCatalog: (serverIds, revisions) => hubRefreshCatalog(ctx, serverIds, revisions),
    callTool: (request) => hubCallTool(ctx, request),
    getState: (serverId) => {
      const state = ctx.states.get(serverId)
      return state === undefined ? null : cloneStateSummary(state)
    },
    getAllStates: (servers) => {
      if (servers === undefined) {
        return Array.from(ctx.states.values()).map(cloneStateSummary)
      }
      return servers.map((server) => {
        const state = ctx.states.get(server.serverId)
        return state === undefined ? createInitialState(ctx, server) : cloneStateSummary(state)
      })
    },
    getTools: (serverId) => {
      const entry = ctx.entries.get(serverId)
      return entry === undefined ? [] : cloneRemoteTools(entry.connector.getTools())
    },
    stopAll: async () => {
      await Promise.all(Array.from(ctx.entries.values()).map(async (entry) => {
        await entry.connector.stop()
      }))
      ctx.entries.clear()
      ctx.states.clear()
    },
  }
}

async function hubReconcile(
  ctx: HubContext,
  servers: readonly McpServerRecord[],
  revisions: McpConnectorHubRevisionState,
): Promise<McpConnectorHubReconcileResult> {
  ctx.currentRevisions = revisions
  const activeServerIds = new Set(servers.map((server) => server.serverId))

  await Promise.all(Array.from(ctx.entries.keys()).map(async (serverId) => {
    if (activeServerIds.has(serverId)) {
      return
    }
    await hubRemoveManagedServer(ctx, serverId, revisions, true)
  }))

  const reconcileResults = await Promise.all(servers.map(async (server) => {
    if (!server.enabled) {
      return await hubSetDisabled(ctx, server, revisions)
    }
    return await hubEnsureRunning(ctx, server, revisions)
  }))

  return {
    states: reconcileResults.map(cloneStateSummary),
  }
}

async function hubEnsureRunning(
  ctx: HubContext,
  server: McpServerRecord,
  revisions: McpConnectorHubRevisionState,
): Promise<McpServerStateSummary> {
  ctx.currentRevisions = revisions
  const existing = ctx.entries.get(server.serverId)
  if (existing !== undefined && isSameServerConfig(existing.server, server)) {
    return existing.connector.getState()
  }

  if (existing !== undefined) {
    await existing.connector.stop()
    ctx.entries.delete(server.serverId)
  }

  const entry: ManagedConnectorEntry = {
    server: cloneServerRecord(server),
    connector: hubCreateConnector(ctx, server),
    reconnectAttempt: 0,
    restarting: false,
  }
  ctx.entries.set(server.serverId, entry)

  const result = await entry.connector.start()
  return await hubApplyConnectorResult(ctx, entry, result, revisions)
}

async function hubSetDisabled(
  ctx: HubContext,
  server: McpServerRecord,
  revisions: McpConnectorHubRevisionState,
): Promise<McpServerStateSummary> {
  ctx.currentRevisions = revisions
  const existing = ctx.entries.get(server.serverId)
  if (existing !== undefined) {
    await existing.connector.stop()
    ctx.entries.delete(server.serverId)
  }

  const disabledState = createConnectorState(server, 'disabled', 0, {
    transportState: createDefaultTransportState(server),
    lastError: null,
    reconnectAttempt: 0,
  })
  ctx.states.set(server.serverId, cloneStateSummary(disabledState))
  await hubPublishServerState(ctx, disabledState)
  return cloneStateSummary(disabledState)
}

async function hubRemoveManagedServer(
  ctx: HubContext,
  serverId: string,
  revisions: McpConnectorHubRevisionState,
  publishRemoved: boolean,
): Promise<void> {
  ctx.currentRevisions = revisions
  const existing = ctx.entries.get(serverId)
  if (existing !== undefined) {
    await existing.connector.stop()
    ctx.entries.delete(serverId)
  }

  ctx.states.delete(serverId)
  if (publishRemoved) {
    await ctx.options.publishEvent?.({
      kind: 'server-removed',
      registryRevision: revisions.registryRevision,
      snapshotRevision: revisions.snapshotRevision,
      serverId,
    })
  }
}

async function hubApplyConnectorResult(
  ctx: HubContext,
  entry: ManagedConnectorEntry,
  result: McpConnectorOperationResult,
  revisions: McpConnectorHubRevisionState,
): Promise<McpServerStateSummary> {
  ctx.currentRevisions = revisions
  const state = cloneStateSummary(result.state)
  ctx.states.set(entry.server.serverId, state)
  await hubPublishServerState(ctx, state)

  if (!result.ok && isRetryableError(result.error)) {
    hubScheduleReconnect(ctx, entry, revisions, result.error)
  }

  return state
}

function hubScheduleReconnect(
  ctx: HubContext,
  entry: ManagedConnectorEntry,
  revisions: McpConnectorHubRevisionState,
  error: McpErrorSummary,
): void {
  if (entry.restarting || entry.reconnectAttempt >= ctx.maxReconnectAttempts) {
    return
  }

  entry.restarting = true
  entry.reconnectAttempt += 1
  const attempt = entry.reconnectAttempt

  void (async () => {
    await new Promise((resolve) => setTimeout(resolve, ctx.reconnectDelayMs * attempt))
    entry.restarting = false
    if (ctx.entries.get(entry.server.serverId) !== entry) {
      return
    }

    const connectingState = createConnectorState(entry.server, 'connecting', entry.connector.getTools().length, {
      transportState: entry.connector.getState().transportState ?? createDefaultTransportState(entry.server),
      lastError: error,
      reconnectAttempt: attempt,
      lastHandshakeAt: entry.connector.getState().lastHandshakeAt ?? null,
      lastCatalogSyncAt: entry.connector.getState().lastCatalogSyncAt ?? null,
    })
    ctx.states.set(entry.server.serverId, connectingState)
    await hubPublishServerState(ctx, connectingState)
    const result = await entry.connector.start()
    const nextState = result.ok
      ? cloneStateSummary(result.state)
      : {
          ...cloneStateSummary(result.state),
          reconnectAttempt: attempt,
        }
    ctx.states.set(entry.server.serverId, nextState)
    await hubPublishServerState(ctx, nextState)

    if (!result.ok && result.error.retryable) {
      hubScheduleReconnect(ctx, entry, revisions, result.error)
    }
  })()
}

async function hubRemoveServer(
  ctx: HubContext,
  serverId: string,
  revisions: McpConnectorHubRevisionState,
): Promise<void> {
  ctx.currentRevisions = revisions
  await hubRemoveManagedServer(ctx, serverId, revisions, true)
}

async function hubTestConnection(
  ctx: HubContext,
  server: McpServerRecord,
): Promise<McpConnectorHubTestConnectionResult> {
  const startedAt = Date.now()
  const capturedStates: McpServerStateSummary[] = []
  const onStateChange = (state: McpServerStateSummary) => {
    capturedStates.push(cloneStateSummary(state))
  }
  const connector = hubCreateConnector(ctx, server, onStateChange)

  try {
    const result = await connector.start()
    const durationMs = Math.max(0, Date.now() - startedAt)
    return {
      success: result.ok,
      transportKind: server.transportKind,
      toolCount: result.tools.length,
      durationMs,
      phase: resolveTestConnectionPhase(result, capturedStates),
      diagnosticSummary: resolveDiagnosticSummary(result),
      error: result.ok ? null : result.error,
      warnings: result.warnings,
    }
  } finally {
    await connector.stop()
  }
}

async function hubRefreshCatalog(
  ctx: HubContext,
  serverIds: readonly string[] | null,
  revisions: McpConnectorHubRevisionState,
): Promise<McpConnectorHubRefreshCatalogResult[]> {
  ctx.currentRevisions = revisions
  const targetEntries = Array.from(ctx.entries.values()).filter((entry) => {
    return serverIds === null || serverIds.includes(entry.server.serverId)
  })

  return await Promise.all(targetEntries.map(async (entry) => {
    const result = await entry.connector.refreshCatalog()
    const normalized = await hubApplyConnectorResult(ctx, entry, result, revisions)
    return {
      serverId: entry.server.serverId,
      success: result.ok,
      toolCount: normalized.toolCount,
      state: normalized,
      error: result.ok ? null : result.error,
    }
  }))
}

async function hubCallTool(
  ctx: HubContext,
  request: McpToolCallRequest,
): Promise<McpToolCallResult> {
  const entry = ctx.entries.get(request.serverId)
  const state = ctx.states.get(request.serverId) ?? null

  if (entry === undefined) {
    return createHubToolCallFailure(request, {
      code: 'temporarily_unavailable',
      message: 'The MCP server is not ready to execute tools.',
      retryable: true,
      details: { connectionState: state?.connectionState ?? 'missing' },
    })
  }

  if (state !== null && state.connectionState !== 'connected' && state.connectionState !== 'degraded') {
    return createHubToolCallFailure(request, {
      code: 'temporarily_unavailable',
      message: 'The MCP server is not ready to execute tools.',
      retryable: true,
      details: { connectionState: state.connectionState },
    })
  }

  return await entry.connector.callTool(toConnectorToolCallRequest(request))
}

function hubCreateConnector(
  ctx: HubContext,
  server: McpServerRecord,
  onStateChangeOverride?: (state: McpServerStateSummary) => void,
): McpServerConnector {
  if (ctx.options.createConnector !== undefined) {
    return ctx.options.createConnector(server, {
      timeoutMs: ctx.timeoutMs,
      now: ctx.now,
      onStateChange: onStateChangeOverride ?? ((state) => { void hubPublishServerState(ctx, state) }),
    })
  }

  const context = {
    timeoutMs: ctx.timeoutMs,
    now: ctx.now,
    onStateChange: onStateChangeOverride ?? ((state: McpServerStateSummary) => { void hubPublishServerState(ctx, state) }),
  }
  return server.transportKind === 'stdio'
    ? createStdioMcpServerConnector({
        server,
        context,
        resolvedCommand: ctx.options.getResolvedCommand?.(server) ?? undefined,
      })
    : createHttpSseMcpServerConnector({ server, context })
}

async function hubPublishServerState(
  ctx: HubContext,
  state: McpServerStateSummary,
): Promise<void> {
  ctx.states.set(state.serverId, cloneStateSummary(state))
  await ctx.options.publishEvent?.({
    kind: 'server-state',
    registryRevision: ctx.currentRevisions.registryRevision,
    snapshotRevision: ctx.currentRevisions.snapshotRevision,
    serverId: state.serverId,
    state: cloneStateSummary(state),
  })
}

function createHubToolCallFailure(
  request: McpToolCallRequest,
  errorOptions: {
    code: string
    message: string
    retryable: boolean
    details?: Record<string, unknown> | null
  },
): McpConnectorHubToolCallFailure {
  return {
    ok: false,
    toolId: request.toolId,
    serverId: request.serverId,
    remoteToolName: request.remoteToolName,
    snapshotRevision: request.snapshotRevision ?? null,
    error: createMcpErrorSummary(errorOptions.code, errorOptions.message, {
      retryable: errorOptions.retryable,
      now: () => new Date().toISOString(),
      details: errorOptions.details,
    }),
  }
}

function createInitialState(
  _ctx: HubContext,
  server: McpServerRecord,
): McpServerStateSummary {
  return createConnectorState(server, server.enabled ? 'idle' : 'disabled', 0, {
    transportState: createDefaultTransportState(server),
  })
}

function resolveTestConnectionPhase(
  result: McpConnectorOperationResult,
  capturedStates: readonly McpServerStateSummary[],
): McpConnectionPhase | null {
  if (typeof result.state.lastPhase === 'string') {
    return result.state.lastPhase
  }

  const errorPhase = result.ok ? null : result.error.details?.phase
  if (typeof errorPhase === 'string') {
    return errorPhase as McpConnectionPhase
  }

  for (let index = capturedStates.length - 1; index >= 0; index -= 1) {
    const phase = capturedStates[index]?.lastPhase
    if (typeof phase === 'string') {
      return phase
    }
  }

  return null
}

function resolveDiagnosticSummary(result: McpConnectorOperationResult): string | null {
  if (result.ok) {
    return null
  }

  const diagnosticSummary = result.error.details?.diagnosticSummary
  return typeof diagnosticSummary === 'string' && diagnosticSummary.trim() !== ''
    ? diagnosticSummary
    : null
}

function isSameServerConfig(left: McpServerRecord, right: McpServerRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function cloneServerRecord(server: McpServerRecord): McpServerRecord {
  if (server.transportConfig.kind === 'stdio') {
    return {
      ...server,
      transportConfig: {
        ...server.transportConfig,
        args: [...server.transportConfig.args],
        ...(server.transportConfig.env === undefined ? {} : { env: { ...server.transportConfig.env } }),
      },
      ...(server.reservedSensitiveFields === undefined ? {} : { reservedSensitiveFields: [...server.reservedSensitiveFields] }),
    }
  }

  return {
    ...server,
    transportConfig: {
      ...server.transportConfig,
      ...(server.transportConfig.headers === undefined ? {} : { headers: { ...server.transportConfig.headers } }),
      ...(server.transportConfig.env === undefined ? {} : { env: { ...server.transportConfig.env } }),
    },
    ...(server.reservedSensitiveFields === undefined ? {} : { reservedSensitiveFields: [...server.reservedSensitiveFields] }),
  }
}

function toConnectorToolCallRequest(
  request: McpToolCallRequest,
): McpConnectorToolCallRequest {
  return {
    toolId: request.toolId,
    serverId: request.serverId,
    remoteToolName: request.remoteToolName,
    arguments: request.arguments,
    snapshotRevision: request.snapshotRevision,
  }
}

export function createConnectorUnavailableState(server: McpServerRecord, message: string, now: () => string): McpServerStateSummary {
  return createConnectorState(server, server.enabled ? 'error' : 'disabled', 0, {
    transportState: createDefaultTransportState(server),
    lastError: createMcpErrorSummary('connector_unavailable', message, { retryable: true, now }),
  })
}
