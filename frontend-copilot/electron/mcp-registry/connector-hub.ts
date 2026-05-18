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

export function createMcpConnectorHub(options: CreateMcpConnectorHubOptions = {}): McpConnectorHub {
  const now = options.now ?? (() => new Date().toISOString())
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECTOR_TIMEOUT_MS
  const maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS
  const entries = new Map<string, ManagedConnectorEntry>()
  const states = new Map<string, McpServerStateSummary>()
  let currentRevisions: McpConnectorHubRevisionState = { registryRevision: 0, snapshotRevision: 0 }

  const publishServerState = async (state: McpServerStateSummary): Promise<void> => {
    states.set(state.serverId, cloneStateSummary(state))
    await options.publishEvent?.({
      kind: 'server-state',
      registryRevision: currentRevisions.registryRevision,
      snapshotRevision: currentRevisions.snapshotRevision,
      serverId: state.serverId,
      state: cloneStateSummary(state),
    })
  }

  const createConnector = (server: McpServerRecord): McpServerConnector => {
    if (options.createConnector !== undefined) {
      return options.createConnector(server, {
        timeoutMs,
        now,
        onStateChange: publishServerState,
      })
    }

    const context = {
      timeoutMs,
      now,
      onStateChange: publishServerState,
    }
    return server.transportKind === 'stdio'
      ? createStdioMcpServerConnector({
          server,
          context,
          resolvedCommand: options.getResolvedCommand?.(server) ?? undefined,
        })
      : createHttpSseMcpServerConnector({ server, context })
  }

  return {
    async reconcile(servers, revisions) {
      currentRevisions = revisions
      const activeServerIds = new Set(servers.map((server) => server.serverId))

      await Promise.all(Array.from(entries.keys()).map(async (serverId) => {
        if (activeServerIds.has(serverId)) {
          return
        }

        await removeManagedServer(serverId, revisions, true)
      }))

      const reconcileResults = await Promise.all(servers.map(async (server) => {
        if (!server.enabled) {
          return await setDisabled(server, revisions)
        }

        return await ensureRunning(server, revisions)
      }))

      return {
        states: reconcileResults.map(cloneStateSummary),
      }
    },
    async removeServer(serverId, revisions) {
      currentRevisions = revisions
      await removeManagedServer(serverId, revisions, true)
    },
    async setServerDisabled(server, revisions) {
      currentRevisions = revisions
      return await setDisabled(server, revisions)
    },
    async testConnection(server) {
      const startedAt = Date.now()
      const capturedStates: McpServerStateSummary[] = []
      const connector = options.createConnector !== undefined
        ? options.createConnector(server, {
            timeoutMs,
            now,
            onStateChange(state) {
              capturedStates.push(cloneStateSummary(state))
            },
          })
        : server.transportKind === 'stdio'
          ? createStdioMcpServerConnector({
              server,
              context: {
                timeoutMs,
                now,
                onStateChange(state) {
                  capturedStates.push(cloneStateSummary(state))
                },
              },
              resolvedCommand: options.getResolvedCommand?.(server) ?? undefined,
            })
          : createHttpSseMcpServerConnector({
              server,
              context: {
                timeoutMs,
                now,
                onStateChange(state) {
                  capturedStates.push(cloneStateSummary(state))
                },
              },
            })

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
    },
    async refreshCatalog(serverIds, revisions) {
      currentRevisions = revisions
      const targetEntries = Array.from(entries.values()).filter((entry) => {
        return serverIds === null || serverIds.includes(entry.server.serverId)
      })

      return await Promise.all(targetEntries.map(async (entry) => {
        const result = await entry.connector.refreshCatalog()
        const normalized = await applyConnectorResult(entry, result, revisions)
        return {
          serverId: entry.server.serverId,
          success: result.ok,
          toolCount: normalized.toolCount,
          state: normalized,
          error: result.ok ? null : result.error,
        }
      }))
    },
    async callTool(request) {
      const entry = entries.get(request.serverId)
      const state = states.get(request.serverId) ?? null

      if (entry === undefined) {
        return createToolCallFailure(
          request,
          'temporarily_unavailable',
          'The MCP server is not ready to execute tools.',
          true,
          {
            connectionState: state?.connectionState ?? 'missing',
          },
          now,
        )
      }

      if (state !== null && state.connectionState !== 'connected' && state.connectionState !== 'degraded') {
        return createToolCallFailure(
          request,
          'temporarily_unavailable',
          'The MCP server is not ready to execute tools.',
          true,
          {
            connectionState: state.connectionState,
          },
          now,
        )
      }

      return await entry.connector.callTool(toConnectorToolCallRequest(request))
    },
    getState(serverId) {
      const state = states.get(serverId)
      return state === undefined ? null : cloneStateSummary(state)
    },
    getAllStates(servers) {
      if (servers === undefined) {
        return Array.from(states.values()).map(cloneStateSummary)
      }

      return servers.map((server) => {
        const state = states.get(server.serverId)
        return state === undefined ? createInitialState(server) : cloneStateSummary(state)
      })
    },
    getTools(serverId) {
      const entry = entries.get(serverId)
      return entry === undefined ? [] : cloneRemoteTools(entry.connector.getTools())
    },
    async stopAll() {
      await Promise.all(Array.from(entries.values()).map(async (entry) => {
        await entry.connector.stop()
      }))
      entries.clear()
      states.clear()
    },
  }

  async function ensureRunning(
    server: McpServerRecord,
    revisions: McpConnectorHubRevisionState,
  ): Promise<McpServerStateSummary> {
    currentRevisions = revisions
    const existing = entries.get(server.serverId)
    if (existing !== undefined && isSameServerConfig(existing.server, server)) {
      return existing.connector.getState()
    }

    if (existing !== undefined) {
      await existing.connector.stop()
      entries.delete(server.serverId)
    }

    const entry: ManagedConnectorEntry = {
      server: cloneServerRecord(server),
      connector: createConnector(server),
      reconnectAttempt: 0,
      restarting: false,
    }
    entries.set(server.serverId, entry)

    const result = await entry.connector.start()
    return await applyConnectorResult(entry, result, revisions)
  }

  async function setDisabled(
    server: McpServerRecord,
    revisions: McpConnectorHubRevisionState,
  ): Promise<McpServerStateSummary> {
    currentRevisions = revisions
    const existing = entries.get(server.serverId)
    if (existing !== undefined) {
      await existing.connector.stop()
      entries.delete(server.serverId)
    }

    const disabledState = createConnectorState(server, 'disabled', 0, now, {
      transportState: createDefaultTransportState(server),
      lastError: null,
      reconnectAttempt: 0,
    })
    states.set(server.serverId, cloneStateSummary(disabledState))
    await publishServerState(disabledState)
    return cloneStateSummary(disabledState)
  }

  async function removeManagedServer(
    serverId: string,
    revisions: McpConnectorHubRevisionState,
    publishRemoved: boolean,
  ): Promise<void> {
    currentRevisions = revisions
    const existing = entries.get(serverId)
    if (existing !== undefined) {
      await existing.connector.stop()
      entries.delete(serverId)
    }

    states.delete(serverId)
    if (publishRemoved) {
      await options.publishEvent?.({
        kind: 'server-removed',
        registryRevision: revisions.registryRevision,
        snapshotRevision: revisions.snapshotRevision,
        serverId,
      })
    }
  }

  async function applyConnectorResult(
    entry: ManagedConnectorEntry,
    result: McpConnectorOperationResult,
    revisions: McpConnectorHubRevisionState,
  ): Promise<McpServerStateSummary> {
    currentRevisions = revisions
    const state = cloneStateSummary(result.state)
    states.set(entry.server.serverId, state)
    await publishServerState(state)

    if (!result.ok && isRetryableError(result.error)) {
      scheduleReconnect(entry, revisions, result.error)
    }

    return state
  }

  function scheduleReconnect(
    entry: ManagedConnectorEntry,
    revisions: McpConnectorHubRevisionState,
    error: McpErrorSummary,
  ): void {
    if (entry.restarting || entry.reconnectAttempt >= maxReconnectAttempts) {
      return
    }

    entry.restarting = true
    entry.reconnectAttempt += 1
    const attempt = entry.reconnectAttempt

    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs * attempt))
      entry.restarting = false
      if (entries.get(entry.server.serverId) !== entry) {
        return
      }

      const connectingState = createConnectorState(entry.server, 'connecting', entry.connector.getTools().length, now, {
        transportState: entry.connector.getState().transportState ?? createDefaultTransportState(entry.server),
        lastError: error,
        reconnectAttempt: attempt,
        lastHandshakeAt: entry.connector.getState().lastHandshakeAt ?? null,
        lastCatalogSyncAt: entry.connector.getState().lastCatalogSyncAt ?? null,
      })
      states.set(entry.server.serverId, connectingState)
      await publishServerState(connectingState)
      const result = await entry.connector.start()
      const nextState = result.ok
        ? cloneStateSummary(result.state)
        : {
            ...cloneStateSummary(result.state),
            reconnectAttempt: attempt,
          }
      states.set(entry.server.serverId, nextState)
      await publishServerState(nextState)

      if (!result.ok && result.error.retryable) {
        scheduleReconnect(entry, revisions, result.error)
      }
    })()
  }

  function createInitialState(server: McpServerRecord): McpServerStateSummary {
    return createConnectorState(server, server.enabled ? 'idle' : 'disabled', 0, now, {
      transportState: createDefaultTransportState(server),
    })
  }
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

function createToolCallFailure(
  request: McpToolCallRequest,
  code: string,
  message: string,
  retryable: boolean,
  details: Record<string, unknown> | null = null,
  now: () => string = () => new Date().toISOString(),
): McpConnectorHubToolCallFailure {
  return {
    ok: false,
    toolId: request.toolId,
    serverId: request.serverId,
    remoteToolName: request.remoteToolName,
    snapshotRevision: request.snapshotRevision ?? null,
    error: createMcpErrorSummary(code, message, retryable, now, details),
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
  return createConnectorState(server, server.enabled ? 'error' : 'disabled', 0, now, {
    transportState: createDefaultTransportState(server),
    lastError: createMcpErrorSummary('connector_unavailable', message, true, now),
  })
}
