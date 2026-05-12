import type { McpServerRecord, McpServerStateSummary, McpToolCallResult } from '../types'
import {
  MCP_INITIALIZE_METHOD,
  MCP_INITIALIZED_NOTIFICATION_METHOD,
  MCP_TOOLS_CALL_METHOD,
  MCP_TOOLS_LIST_METHOD,
  McpConnectorError,
  type JsonRpcResponsePayload,
  type McpConnectorContext,
  type McpConnectorOperationResult,
  type McpConnectorToolCallRequest,
  type McpRemoteToolSummary,
  type McpServerConnector,
  classifyHttpStatus,
  cloneRemoteTools,
  cloneStateSummary,
  createConnectorFailure,
  createConnectorState,
  createConnectorSuccess,
  createInitializeParams,
  createJsonRpcNotification,
  createJsonRpcRequest,
  createMcpErrorSummary,
  normalizeConnectorError,
  normalizeToolsCallResult,
  normalizeToolsListResult,
  unwrapJsonRpcResponse,
} from './protocol'

const HTTP_SSE_CONNECT_TIMEOUT_MS = 5_000

export interface CreateHttpSseMcpServerConnectorOptions {
  server: McpServerRecord
  context: McpConnectorContext
}

interface HttpSseContext {
  server: McpServerRecord
  transportConfig: Extract<McpServerRecord['transportConfig'], { kind: 'http-sse' }>
  context: McpConnectorContext
  tools: McpRemoteToolSummary[]
  sessionReady: boolean
  lastHttpStatus: number | null
  sseOnline: boolean
  state: McpServerStateSummary
}

export function createHttpSseMcpServerConnector(
  options: CreateHttpSseMcpServerConnectorOptions,
): McpServerConnector {
  if (options.server.transportConfig.kind !== 'http-sse') {
    throw new Error('createHttpSseMcpServerConnector requires an HTTP/SSE transport config.')
  }

  const ctx: HttpSseContext = {
    server: options.server,
    transportConfig: options.server.transportConfig as Extract<McpServerRecord['transportConfig'], { kind: 'http-sse' }>,
    context: options.context,
    tools: [],
    sessionReady: false,
    lastHttpStatus: null,
    sseOnline: false,
    state: createConnectorState(options.server, options.server.enabled ? 'idle' : 'disabled', 0, {}),
  }

  return {
    start: () => httpSseStart(ctx),
    refreshCatalog: () => httpSseRefreshCatalog(ctx),
    callTool: (request) => httpSseCallTool(ctx, request),
    stop: () => httpSseStop(ctx),
    getState: () => cloneStateSummary(ctx.state),
    getTools: () => cloneRemoteTools(ctx.tools),
  }
}

async function httpSseStart(ctx: HttpSseContext): Promise<McpConnectorOperationResult> {
  ctx.sessionReady = false
  ctx.state = createConnectorState(ctx.server, 'connecting', ctx.tools.length, {
    transportState: {
      kind: 'http-sse',
      endpointStatus: 'connecting',
      lastHttpStatus: ctx.lastHttpStatus,
      sseOnline: ctx.sseOnline,
    },
    lastHandshakeAt: ctx.state.lastHandshakeAt ?? null,
    lastCatalogSyncAt: ctx.state.lastCatalogSyncAt ?? null,
    lastError: null,
  })
  await emitHttpSseState(ctx)

  try {
    const initializeResponse = await httpSsePostJsonRpc(ctx, 1, MCP_INITIALIZE_METHOD, createInitializeParams())
    unwrapJsonRpcResponse(initializeResponse, ctx.context.now)
    await httpSsePostJsonRpcNotification(ctx, MCP_INITIALIZED_NOTIFICATION_METHOD, {})
    await httpSseProbeEndpoint(ctx)
    const nextTools = await httpSseRequestToolsList(ctx)
    ctx.tools = cloneRemoteTools(nextTools)
    ctx.sessionReady = true
    const success = createConnectorSuccess(ctx.server, nextTools, {
      now: ctx.context.now,
      transportState: {
        kind: 'http-sse',
        endpointStatus: 'online',
        lastHttpStatus: ctx.lastHttpStatus,
        sseOnline: ctx.sseOnline,
      },
      lastHandshakeAt: ctx.context.now(),
      lastCatalogSyncAt: ctx.context.now(),
    })
    ctx.state = cloneStateSummary(success.state)
    await emitHttpSseState(ctx)
    return success
  } catch (error) {
    return await httpSseApplyFailure(ctx, error)
  }
}

async function httpSseRefreshCatalog(ctx: HttpSseContext): Promise<McpConnectorOperationResult> {
  if (!ctx.sessionReady) {
    return await httpSseStart(ctx)
  }

  try {
    const nextTools = await httpSseRequestToolsList(ctx)
    ctx.tools = cloneRemoteTools(nextTools)
    const success = createConnectorSuccess(ctx.server, nextTools, {
      now: ctx.context.now,
      transportState: {
        kind: 'http-sse',
        endpointStatus: 'online',
        lastHttpStatus: ctx.lastHttpStatus,
        sseOnline: ctx.sseOnline,
      },
      lastHandshakeAt: ctx.state.lastHandshakeAt ?? ctx.context.now(),
      lastCatalogSyncAt: ctx.context.now(),
    })
    ctx.state = cloneStateSummary(success.state)
    await emitHttpSseState(ctx)
    return success
  } catch (error) {
    return await httpSseApplyFailure(ctx, error)
  }
}

async function httpSseStop(ctx: HttpSseContext): Promise<void> {
  ctx.sessionReady = false
  ctx.sseOnline = false
  ctx.state = createConnectorState(ctx.server, 'idle', ctx.tools.length, {
    transportState: {
      kind: 'http-sse',
      endpointStatus: 'offline',
      lastHttpStatus: ctx.lastHttpStatus,
      sseOnline: false,
    },
    lastHandshakeAt: ctx.state.lastHandshakeAt ?? null,
    lastCatalogSyncAt: ctx.state.lastCatalogSyncAt ?? null,
    lastError: null,
  })
  await emitHttpSseState(ctx)
}

async function httpSseRequestToolsList(ctx: HttpSseContext): Promise<McpRemoteToolSummary[]> {
  const response = await httpSsePostJsonRpc(ctx, 2, MCP_TOOLS_LIST_METHOD, {})
  const result = unwrapJsonRpcResponse(response, ctx.context.now)
  return normalizeToolsListResult(result)
}

async function httpSseCallTool(
  ctx: HttpSseContext,
  request: McpConnectorToolCallRequest,
): Promise<McpToolCallResult> {
  if (!ctx.sessionReady) {
    return {
      ok: false,
      toolId: request.toolId,
      serverId: request.serverId,
      remoteToolName: request.remoteToolName,
      snapshotRevision: request.snapshotRevision ?? null,
      error: createMcpErrorSummary(
        'temporarily_unavailable',
        'The MCP HTTP/SSE server is not ready to execute tools.',
        { retryable: true, now: ctx.context.now },
      ),
    }
  }

  if (!ctx.tools.some((tool) => tool.name === request.remoteToolName)) {
    return {
      ok: false,
      toolId: request.toolId,
      serverId: request.serverId,
      remoteToolName: request.remoteToolName,
      snapshotRevision: request.snapshotRevision ?? null,
      error: createMcpErrorSummary(
        'directory_drift',
        'The requested MCP tool no longer exists in the current server catalog.',
        { retryable: false, now: ctx.context.now },
      ),
    }
  }

  try {
    const response = await httpSsePostJsonRpc(ctx, 3, MCP_TOOLS_CALL_METHOD, {
      name: request.remoteToolName,
      arguments: request.arguments,
    })
    const result = unwrapJsonRpcResponse(response, ctx.context.now)
    return normalizeToolsCallResult({
      result,
      request,
      server: ctx.server,
      now: ctx.context.now,
    })
  } catch (error) {
    return {
      ok: false,
      toolId: request.toolId,
      serverId: request.serverId,
      remoteToolName: request.remoteToolName,
      snapshotRevision: request.snapshotRevision ?? null,
      error: normalizeConnectorError(error, ctx.context.now, 'http_sse_tool_call_failed'),
    }
  }
}

async function httpSsePostJsonRpc(
  ctx: HttpSseContext,
  id: number,
  method: string,
  params?: unknown,
): Promise<JsonRpcResponsePayload> {
  const payload = await httpSseFetchJson(ctx, ctx.transportConfig.baseUrl, {
    method: 'POST',
    headers: httpSseCreateJsonHeaders(ctx),
    body: JSON.stringify(createJsonRpcRequest(id, method, params)),
  })

  if (!isJsonRpcResponsePayload(payload)) {
    throw new McpConnectorError(createMcpErrorSummary(
      'protocol_parse_failed',
      'The MCP HTTP/SSE endpoint returned an invalid JSON-RPC response.',
      { retryable: false, now: ctx.context.now },
    ))
  }

  return payload
}

async function httpSsePostJsonRpcNotification(
  ctx: HttpSseContext,
  method: string,
  params?: unknown,
): Promise<void> {
  await httpSseFetchJson(ctx, ctx.transportConfig.baseUrl, {
    method: 'POST',
    headers: httpSseCreateJsonHeaders(ctx),
    body: JSON.stringify(createJsonRpcNotification(method, params)),
    allowEmptyBody: true,
  })
}

async function httpSseProbeEndpoint(ctx: HttpSseContext): Promise<void> {
  const sseUrl = resolveHttpSseProbeUrl(ctx)
  if (sseUrl === null) {
    ctx.sseOnline = true
    return
  }

  const controller = new AbortController()
  const timeoutMs = ctx.context.timeoutMs > 0 ? ctx.context.timeoutMs : HTTP_SSE_CONNECT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(sseUrl, {
      method: 'GET',
      headers: httpSseCreateSseProbeHeaders(ctx),
      signal: controller.signal,
    })
    ctx.lastHttpStatus = response.status
    if (!response.ok) {
      throw new McpConnectorError(classifyHttpStatus(response.status, response.statusText, ctx.context.now))
    }

    const contentType = response.headers.get('content-type') ?? ''
    ctx.sseOnline = contentType.includes('text/event-stream') || contentType.trim() === ''
    await response.body?.cancel().catch(() => undefined)
  } finally {
    clearTimeout(timer)
  }
}

async function httpSseFetchJson(
  ctx: HttpSseContext,
  url: string,
  init: RequestInit & { allowEmptyBody?: boolean },
): Promise<unknown> {
  const controller = new AbortController()
  const timeoutMs = ctx.context.timeoutMs > 0 ? ctx.context.timeoutMs : HTTP_SSE_CONNECT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    })
    ctx.lastHttpStatus = response.status
    if (!response.ok) {
      throw new McpConnectorError(classifyHttpStatus(response.status, response.statusText, ctx.context.now))
    }

    const text = await response.text()
    if (text.trim() === '') {
      if (init.allowEmptyBody === true) {
        return null
      }

      throw new McpConnectorError(createMcpErrorSummary(
        'protocol_parse_failed',
        'The MCP HTTP/SSE endpoint returned an empty response body.',
        { retryable: false, now: ctx.context.now },
      ))
    }

    return JSON.parse(text) as unknown
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new McpConnectorError(createMcpErrorSummary(
        'protocol_parse_failed',
        `The MCP HTTP/SSE endpoint returned invalid JSON: ${error.message}`,
        { retryable: false, now: ctx.context.now },
      ))
    }

    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function httpSseApplyFailure(ctx: HttpSseContext, error: unknown): Promise<McpConnectorOperationResult> {
  const summary = normalizeConnectorError(error, ctx.context.now, 'http_sse_connection_failed')
  ctx.sessionReady = false
  ctx.sseOnline = false
  const failure = createConnectorFailure(ctx.server, summary, {
    now: ctx.context.now,
    transportState: {
      kind: 'http-sse',
      endpointStatus: 'offline',
      lastHttpStatus: ctx.lastHttpStatus,
      sseOnline: false,
    },
    previousTools: ctx.tools,
    lastHandshakeAt: ctx.state.lastHandshakeAt ?? null,
    lastCatalogSyncAt: ctx.state.lastCatalogSyncAt ?? null,
  })
  ctx.state = cloneStateSummary(failure.state)
  await emitHttpSseState(ctx)
  return failure
}

function resolveHttpSseProbeUrl(ctx: HttpSseContext): string | null {
  const override = ctx.transportConfig.ssePathOverride?.trim()
  if (override === undefined || override === null || override === '') {
    return null
  }

  try {
    return new URL(override, ctx.transportConfig.baseUrl).toString()
  } catch {
    throw new McpConnectorError(createMcpErrorSummary(
      'invalid_sse_url',
      'The MCP HTTP/SSE server has an invalid SSE path override.',
      { retryable: false, now: ctx.context.now },
    ))
  }
}

function httpSseCreateJsonHeaders(ctx: HttpSseContext): Headers {
  const headers = new Headers(ctx.transportConfig.headers ?? {})
  headers.set('Accept', 'application/json')
  headers.set('Content-Type', 'application/json')
  return headers
}

function httpSseCreateSseProbeHeaders(ctx: HttpSseContext): Headers {
  const headers = new Headers(ctx.transportConfig.headers ?? {})
  headers.set('Accept', 'text/event-stream')
  headers.delete('Content-Type')
  return headers
}

async function emitHttpSseState(ctx: HttpSseContext): Promise<void> {
  await ctx.context.onStateChange?.(cloneStateSummary(ctx.state))
}

function isJsonRpcResponsePayload(value: unknown): value is JsonRpcResponsePayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
