import type { McpServerRecord, McpToolCallResult } from '../types'
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

export function createHttpSseMcpServerConnector(
  options: CreateHttpSseMcpServerConnectorOptions,
): McpServerConnector {
  if (options.server.transportConfig.kind !== 'http-sse') {
    throw new Error('createHttpSseMcpServerConnector requires an HTTP/SSE transport config.')
  }

  const server = options.server
  const transportConfig = options.server.transportConfig
  const context = options.context
  let tools: McpRemoteToolSummary[] = []
  let sessionReady = false
  let lastHttpStatus: number | null = null
  let sseOnline = false
  let state = createConnectorState(server, server.enabled ? 'idle' : 'disabled', 0, context.now)

  return {
    start,
    refreshCatalog,
    callTool,
    stop,
    getState() {
      return cloneStateSummary(state)
    },
    getTools() {
      return cloneRemoteTools(tools)
    },
  }

  async function start(): Promise<McpConnectorOperationResult> {
    sessionReady = false
    state = createConnectorState(server, 'connecting', tools.length, context.now, {
      transportState: {
        kind: 'http-sse',
        endpointStatus: 'connecting',
        lastHttpStatus,
        sseOnline,
      },
      lastHandshakeAt: state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
      lastError: null,
    })
    await emitState()

    try {
      const initializeResponse = await postJsonRpc(1, MCP_INITIALIZE_METHOD, createInitializeParams())
      unwrapJsonRpcResponse(initializeResponse, context.now)
      await postJsonRpcNotification(MCP_INITIALIZED_NOTIFICATION_METHOD, {})
      await probeSseEndpoint()
      const nextTools = await requestToolsList()
      tools = cloneRemoteTools(nextTools)
      sessionReady = true
      const success = createConnectorSuccess(server, nextTools, context.now, {
        kind: 'http-sse',
        endpointStatus: 'online',
        lastHttpStatus,
        sseOnline,
      }, {
        lastHandshakeAt: context.now(),
        lastCatalogSyncAt: context.now(),
      })
      state = cloneStateSummary(success.state)
      await emitState()
      return success
    } catch (error) {
      return await applyFailure(error)
    }
  }

  async function refreshCatalog(): Promise<McpConnectorOperationResult> {
    if (!sessionReady) {
      return await start()
    }

    try {
      const nextTools = await requestToolsList()
      tools = cloneRemoteTools(nextTools)
      const success = createConnectorSuccess(server, nextTools, context.now, {
        kind: 'http-sse',
        endpointStatus: 'online',
        lastHttpStatus,
        sseOnline,
      }, {
        lastHandshakeAt: state.lastHandshakeAt ?? context.now(),
        lastCatalogSyncAt: context.now(),
      })
      state = cloneStateSummary(success.state)
      await emitState()
      return success
    } catch (error) {
      return await applyFailure(error)
    }
  }

  async function stop(): Promise<void> {
    sessionReady = false
    sseOnline = false
    state = createConnectorState(server, 'idle', 0, context.now, {
      transportState: {
        kind: 'http-sse',
        endpointStatus: 'offline',
        lastHttpStatus,
        sseOnline: false,
      },
      lastHandshakeAt: state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
      lastError: null,
    })
    await emitState()
  }

  async function requestToolsList(): Promise<McpRemoteToolSummary[]> {
    const response = await postJsonRpc(2, MCP_TOOLS_LIST_METHOD, {})
    const result = unwrapJsonRpcResponse(response, context.now)
    return normalizeToolsListResult(result)
  }

  async function callTool(request: McpConnectorToolCallRequest): Promise<McpToolCallResult> {
    if (!sessionReady) {
      return {
        ok: false,
        toolId: request.toolId,
        serverId: request.serverId,
        remoteToolName: request.remoteToolName,
        snapshotRevision: request.snapshotRevision ?? null,
        error: createMcpErrorSummary(
          'temporarily_unavailable',
          'The MCP HTTP/SSE server is not ready to execute tools.',
          true,
          context.now,
        ),
      }
    }

    if (!tools.some((tool) => tool.name === request.remoteToolName)) {
      return {
        ok: false,
        toolId: request.toolId,
        serverId: request.serverId,
        remoteToolName: request.remoteToolName,
        snapshotRevision: request.snapshotRevision ?? null,
        error: createMcpErrorSummary(
          'directory_drift',
          'The requested MCP tool no longer exists in the current server catalog.',
          false,
          context.now,
        ),
      }
    }

    try {
      const response = await postJsonRpc(3, MCP_TOOLS_CALL_METHOD, {
        name: request.remoteToolName,
        arguments: request.arguments,
      })
      const result = unwrapJsonRpcResponse(response, context.now)
      return normalizeToolsCallResult({
        result,
        request,
        server,
        now: context.now,
      })
    } catch (error) {
      return {
        ok: false,
        toolId: request.toolId,
        serverId: request.serverId,
        remoteToolName: request.remoteToolName,
        snapshotRevision: request.snapshotRevision ?? null,
        error: normalizeConnectorError(error, context.now, 'http_sse_tool_call_failed'),
      }
    }
  }

  async function postJsonRpc(id: number, method: string, params?: unknown): Promise<JsonRpcResponsePayload> {
    const payload = await fetchJson(transportConfig.baseUrl, {
      method: 'POST',
      headers: createJsonHeaders('application/json'),
      body: JSON.stringify(createJsonRpcRequest(id, method, params)),
    })

    if (!isJsonRpcResponsePayload(payload)) {
      throw new McpConnectorError(createMcpErrorSummary(
        'protocol_parse_failed',
        'The MCP HTTP/SSE endpoint returned an invalid JSON-RPC response.',
        false,
        context.now,
      ))
    }

    return payload
  }

  async function postJsonRpcNotification(method: string, params?: unknown): Promise<void> {
    await fetchJson(transportConfig.baseUrl, {
      method: 'POST',
      headers: createJsonHeaders('application/json'),
      body: JSON.stringify(createJsonRpcNotification(method, params)),
      allowEmptyBody: true,
    })
  }

  async function probeSseEndpoint(): Promise<void> {
    const sseUrl = resolveSseProbeUrl()
    if (sseUrl === null) {
      sseOnline = true
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), context.timeoutMs > 0 ? context.timeoutMs : HTTP_SSE_CONNECT_TIMEOUT_MS)
    try {
      const response = await fetch(sseUrl, {
        method: 'GET',
        headers: createJsonHeaders('text/event-stream'),
        signal: controller.signal,
      })
      lastHttpStatus = response.status
      if (!response.ok) {
        throw new McpConnectorError(classifyHttpStatus(response.status, response.statusText, context.now))
      }

      const contentType = response.headers.get('content-type') ?? ''
      sseOnline = contentType.includes('text/event-stream') || contentType.trim() === ''
      await response.body?.cancel().catch(() => undefined)
    } finally {
      clearTimeout(timer)
    }
  }

  async function fetchJson(
    url: string,
    init: RequestInit & { allowEmptyBody?: boolean },
  ): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), context.timeoutMs > 0 ? context.timeoutMs : HTTP_SSE_CONNECT_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      })
      lastHttpStatus = response.status
      if (!response.ok) {
        throw new McpConnectorError(classifyHttpStatus(response.status, response.statusText, context.now))
      }

      const text = await response.text()
      if (text.trim() === '') {
        if (init.allowEmptyBody === true) {
          return null
        }

        throw new McpConnectorError(createMcpErrorSummary(
          'protocol_parse_failed',
          'The MCP HTTP/SSE endpoint returned an empty response body.',
          false,
          context.now,
        ))
      }

      return JSON.parse(text) as unknown
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new McpConnectorError(createMcpErrorSummary(
          'protocol_parse_failed',
          `The MCP HTTP/SSE endpoint returned invalid JSON: ${error.message}`,
          false,
          context.now,
        ))
      }

      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async function applyFailure(error: unknown): Promise<McpConnectorOperationResult> {
    const summary = normalizeConnectorError(error, context.now, 'http_sse_connection_failed')
    sessionReady = false
    sseOnline = false
    const failure = createConnectorFailure(server, summary, context.now, {
      kind: 'http-sse',
      endpointStatus: 'offline',
      lastHttpStatus,
      sseOnline: false,
    }, {
      previousTools: tools,
      lastHandshakeAt: state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
    })
    state = cloneStateSummary(failure.state)
    await emitState()
    return failure
  }

  function resolveSseProbeUrl(): string | null {
    const override = transportConfig.ssePathOverride?.trim()
    if (override === undefined || override === null || override === '') {
      return null
    }

    try {
      return new URL(override, transportConfig.baseUrl).toString()
    } catch {
      throw new McpConnectorError(createMcpErrorSummary(
        'invalid_sse_url',
        'The MCP HTTP/SSE server has an invalid SSE path override.',
        false,
        context.now,
      ))
    }
  }

  function createJsonHeaders(accept: string): Headers {
    const headers = new Headers(transportConfig.headers ?? {})
    headers.set('Accept', accept)
    headers.set('Content-Type', 'application/json')
    return headers
  }

  async function emitState(): Promise<void> {
    await context.onStateChange?.(cloneStateSummary(state))
  }
}

function isJsonRpcResponsePayload(value: unknown): value is JsonRpcResponsePayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
