import type {
  McpConnectionState,
  McpErrorSummary,
  McpServerRecord,
  McpServerStateSummary,
  McpToolCallResult,
  McpTransportStateSummary,
} from '../types'

export const MCP_JSON_RPC_VERSION = '2.0'
export const MCP_INITIALIZE_METHOD = 'initialize'
export const MCP_INITIALIZED_NOTIFICATION_METHOD = 'notifications/initialized'
export const MCP_TOOLS_LIST_METHOD = 'tools/list'
export const MCP_TOOLS_CALL_METHOD = 'tools/call'
export const MCP_PROTOCOL_VERSION = '2024-11-05'

export interface McpRemoteToolSummary {
  name: string
  displayName: string
  description: string | null
  inputSchema: Record<string, unknown>
}

export interface McpConnectorOperationSuccess {
  ok: true
  tools: McpRemoteToolSummary[]
  state: McpServerStateSummary
  warnings: string[]
}

export interface McpConnectorOperationFailure {
  ok: false
  tools: McpRemoteToolSummary[]
  state: McpServerStateSummary
  error: McpErrorSummary
  warnings: string[]
}

export type McpConnectorOperationResult = McpConnectorOperationSuccess | McpConnectorOperationFailure

export interface McpConnectorContext {
  now: () => string
  timeoutMs: number
  onStateChange?: (state: McpServerStateSummary) => void | Promise<void>
  onRetryableDisconnect?: (error: McpErrorSummary) => void | Promise<void>
}

export interface McpConnectorToolCallRequest {
  toolId: string
  serverId: string
  remoteToolName: string
  arguments: Record<string, unknown>
  snapshotRevision?: number | null
}

export interface McpServerConnector {
  start: () => Promise<McpConnectorOperationResult>
  refreshCatalog: () => Promise<McpConnectorOperationResult>
  callTool: (request: McpConnectorToolCallRequest) => Promise<McpToolCallResult>
  stop: () => Promise<void>
  getState: () => McpServerStateSummary
  getTools: () => McpRemoteToolSummary[]
}

export interface JsonRpcRequestPayload {
  jsonrpc: typeof MCP_JSON_RPC_VERSION
  id: number
  method: string
  params?: unknown
}

export interface JsonRpcNotificationPayload {
  jsonrpc: typeof MCP_JSON_RPC_VERSION
  method: string
  params?: unknown
}

export interface JsonRpcResponsePayload {
  jsonrpc?: string
  id?: number | string | null
  result?: unknown
  error?: {
    code?: number | string
    message?: string
    data?: unknown
  } | null
}

export function createJsonRpcRequest(id: number, method: string, params?: unknown): JsonRpcRequestPayload {
  return {
    jsonrpc: MCP_JSON_RPC_VERSION,
    id,
    method,
    ...(params === undefined ? {} : { params }),
  }
}

export function createJsonRpcNotification(method: string, params?: unknown): JsonRpcNotificationPayload {
  return {
    jsonrpc: MCP_JSON_RPC_VERSION,
    method,
    ...(params === undefined ? {} : { params }),
  }
}

export function createInitializeParams(): Record<string, unknown> {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: 'CanDue Desktop MCP Registry',
      version: '0.0.0',
    },
  }
}

export function encodeJsonRpcContentLengthMessage(payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'utf8'),
    body,
  ])
}

export class JsonRpcContentLengthParser {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer | string): unknown[] {
    const chunkBuffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    this.buffer = Buffer.concat([this.buffer, chunkBuffer])

    const messages: unknown[] = []
    let keepParsing = true
    while (keepParsing) {
      const header = this.readHeader()
      if (header === null) {
        keepParsing = false
        continue
      }

      const contentLength = parseContentLength(header.headerText)
      if (contentLength === null) {
        throw new Error('MCP stdio response is missing a valid Content-Length header.')
      }

      const totalLength = header.bodyOffset + contentLength
      if (this.buffer.byteLength < totalLength) {
        keepParsing = false
        continue
      }

      const body = this.buffer.subarray(header.bodyOffset, totalLength).toString('utf8')
      this.buffer = this.buffer.subarray(totalLength)
      messages.push(JSON.parse(body) as unknown)
    }

    return messages
  }

  private readHeader(): { headerText: string, bodyOffset: number } | null {
    const crlfIndex = this.buffer.indexOf('\r\n\r\n')
    if (crlfIndex !== -1) {
      return {
        headerText: this.buffer.subarray(0, crlfIndex).toString('utf8'),
        bodyOffset: crlfIndex + 4,
      }
    }

    const lfIndex = this.buffer.indexOf('\n\n')
    if (lfIndex !== -1) {
      return {
        headerText: this.buffer.subarray(0, lfIndex).toString('utf8'),
        bodyOffset: lfIndex + 2,
      }
    }

    return null
  }
}

export function isJsonRpcResponseForId(value: unknown, id: number): value is JsonRpcResponsePayload {
  if (!isPlainRecord(value)) {
    return false
  }

  return value.id === id
}

export function unwrapJsonRpcResponse(response: JsonRpcResponsePayload, now: () => string): unknown {
  if (response.error !== undefined && response.error !== null) {
    throw new McpConnectorError(createMcpErrorSummary(
      'mcp_remote_error',
      typeof response.error.message === 'string' && response.error.message.trim() !== ''
        ? response.error.message
        : 'The MCP server returned a JSON-RPC error response.',
      true,
      now,
      {
        remoteCode: response.error.code ?? null,
      },
    ))
  }

  return response.result
}

export class McpConnectorError extends Error {
  readonly summary: McpErrorSummary

  constructor(summary: McpErrorSummary) {
    super(summary.message)
    this.name = 'McpConnectorError'
    this.summary = summary
  }
}

export function createMcpErrorSummary(
  code: string,
  message: string,
  retryable: boolean,
  now: () => string,
  details: Record<string, unknown> | null = null,
): McpErrorSummary {
  return {
    code,
    message,
    retryable,
    observedAt: now(),
    details,
  }
}

export function normalizeConnectorError(error: unknown, now: () => string, fallbackCode = 'connector_error'): McpErrorSummary {
  if (error instanceof McpConnectorError) {
    return cloneErrorSummary(error.summary)
  }

  if (isNodeError(error)) {
    return classifyNodeError(error, now, fallbackCode)
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return createMcpErrorSummary('timeout', 'The MCP connection attempt timed out.', true, now)
  }

  if (error instanceof Error) {
    return createMcpErrorSummary(fallbackCode, error.message, true, now)
  }

  return createMcpErrorSummary(fallbackCode, String(error), true, now)
}

export function classifyHttpStatus(status: number, statusText: string, now: () => string): McpErrorSummary {
  const suffix = statusText.trim() === '' ? '' : `: ${statusText.trim()}`
  if (status === 401) {
    return createMcpErrorSummary('http_unauthorized', `MCP HTTP/SSE endpoint rejected authentication with status 401${suffix}.`, false, now, { status })
  }
  if (status === 403) {
    return createMcpErrorSummary('http_forbidden', `MCP HTTP/SSE endpoint denied access with status 403${suffix}.`, false, now, { status })
  }
  if (status === 404) {
    return createMcpErrorSummary('http_not_found', `MCP HTTP/SSE endpoint was not found with status 404${suffix}.`, false, now, { status })
  }
  if (status >= 500) {
    return createMcpErrorSummary('http_server_error', `MCP HTTP/SSE endpoint failed with status ${status}${suffix}.`, true, now, { status })
  }

  return createMcpErrorSummary('http_status_error', `MCP HTTP/SSE endpoint failed with status ${status}${suffix}.`, status === 408 || status === 429, now, { status })
}

export function createConnectorSuccess(
  server: McpServerRecord,
  tools: readonly McpRemoteToolSummary[],
  now: () => string,
  transportState: McpTransportStateSummary,
  overrides: Partial<McpServerStateSummary> = {},
): McpConnectorOperationSuccess {
  const clonedTools = cloneRemoteTools(tools)
  return {
    ok: true,
    tools: clonedTools,
    warnings: [],
    state: createConnectorState(server, 'connected', clonedTools.length, now, {
      transportState,
      lastError: null,
      lastHandshakeAt: overrides.lastHandshakeAt ?? now(),
      lastCatalogSyncAt: overrides.lastCatalogSyncAt ?? now(),
      reconnectAttempt: overrides.reconnectAttempt ?? 0,
    }),
  }
}

export function createConnectorFailure(
  server: McpServerRecord,
  error: McpErrorSummary,
  now: () => string,
  transportState: McpTransportStateSummary,
  options: {
    previousTools?: readonly McpRemoteToolSummary[]
    reconnectAttempt?: number
    connectionState?: McpConnectionState
    lastHandshakeAt?: string | null
    lastCatalogSyncAt?: string | null
    warnings?: string[]
  } = {},
): McpConnectorOperationFailure {
  const previousTools = cloneRemoteTools(options.previousTools ?? [])
  const connectionState = options.connectionState
    ?? (previousTools.length > 0 && error.retryable ? 'degraded' : 'error')

  return {
    ok: false,
    tools: previousTools,
    warnings: options.warnings ?? [],
    error: cloneErrorSummary(error),
    state: createConnectorState(server, connectionState, previousTools.length, now, {
      transportState,
      lastError: error,
      reconnectAttempt: options.reconnectAttempt ?? 0,
      lastHandshakeAt: options.lastHandshakeAt ?? null,
      lastCatalogSyncAt: options.lastCatalogSyncAt ?? null,
    }),
  }
}

export function createConnectorState(
  server: McpServerRecord,
  connectionState: McpConnectionState,
  toolCount: number,
  _now: () => string,
  options: {
    transportState?: McpTransportStateSummary | null
    lastError?: McpErrorSummary | null
    reconnectAttempt?: number
    lastHandshakeAt?: string | null
    lastCatalogSyncAt?: string | null
  } = {},
): McpServerStateSummary {
  const resolvedConnectionState = server.enabled ? connectionState : 'disabled'
  return {
    serverId: server.serverId,
    enabled: server.enabled,
    connectionState: resolvedConnectionState,
    toolCount: resolvedConnectionState === 'disabled' ? 0 : Math.max(0, toolCount),
    lastHandshakeAt: options.lastHandshakeAt ?? null,
    lastCatalogSyncAt: options.lastCatalogSyncAt ?? null,
    lastError: options.lastError === undefined ? null : cloneNullableError(options.lastError),
    reconnectAttempt: options.reconnectAttempt ?? 0,
    transportState: options.transportState === undefined ? createDefaultTransportState(server) : cloneTransportState(options.transportState),
  }
}

export function createDefaultTransportState(server: McpServerRecord): McpTransportStateSummary {
  if (server.transportKind === 'stdio') {
    return {
      kind: 'stdio',
      processStatus: 'stopped',
      pid: null,
      lastExitCode: null,
      lastExitSignal: null,
    }
  }

  return {
    kind: 'http-sse',
    endpointStatus: 'offline',
    lastHttpStatus: null,
    sseOnline: false,
  }
}

export function cloneRemoteTools(tools: readonly McpRemoteToolSummary[]): McpRemoteToolSummary[] {
  return tools.map((tool) => ({
    ...tool,
    inputSchema: cloneRecord(tool.inputSchema),
  }))
}

export function normalizeToolsListResult(result: unknown): McpRemoteToolSummary[] {
  if (!isPlainRecord(result) || !Array.isArray(result.tools)) {
    throw new McpConnectorError(createMcpErrorSummary(
      'protocol_parse_failed',
      'The MCP server returned an invalid tools/list result.',
      false,
      () => new Date().toISOString(),
    ))
  }

  const tools = result.tools.map((entry, index) => normalizeToolEntry(entry, index))
  return ensureUniqueToolNames(tools)
}

export function normalizeToolsCallResult(input: {
  result: unknown
  request: McpConnectorToolCallRequest
  server: McpServerRecord
  now: () => string
}): McpToolCallResult {
  const { result, request, server, now } = input
  if (!isPlainRecord(result)) {
    return {
      ok: false,
      toolId: request.toolId,
      serverId: server.serverId,
      remoteToolName: request.remoteToolName,
      snapshotRevision: request.snapshotRevision ?? null,
      error: createMcpErrorSummary(
        'protocol_parse_failed',
        'The MCP server returned an invalid tools/call result.',
        false,
        now,
      ),
    }
  }

  const content = Array.isArray(result.content) ? [...result.content] : []
  const structuredContent = 'structuredContent' in result ? result.structuredContent : undefined
  const isError = result.isError === true
  if (isError) {
    return {
      ok: false,
      toolId: request.toolId,
      serverId: server.serverId,
      remoteToolName: request.remoteToolName,
      snapshotRevision: request.snapshotRevision ?? null,
      error: createMcpErrorSummary(
        'mcp_remote_error',
        extractToolCallErrorMessage(content),
        false,
        now,
        {
          isError: true,
          structuredContent: structuredContent ?? null,
        },
      ),
    }
  }

  return {
    ok: true,
    toolId: request.toolId,
    serverId: server.serverId,
    remoteToolName: request.remoteToolName,
    content,
    structuredContent,
    snapshotRevision: request.snapshotRevision ?? null,
    isError: false,
  }
}

export function cloneStateSummary(state: McpServerStateSummary): McpServerStateSummary {
  return {
    ...state,
    lastError: cloneNullableError(state.lastError ?? null),
    transportState: cloneTransportState(state.transportState ?? null),
  }
}

export function cloneErrorSummary(error: McpErrorSummary): McpErrorSummary {
  return {
    ...error,
    details: error.details === undefined || error.details === null ? null : cloneRecord(error.details),
  }
}

export function cloneNullableError(error: McpErrorSummary | null): McpErrorSummary | null {
  return error === null ? null : cloneErrorSummary(error)
}

export function cloneTransportState(state: McpTransportStateSummary | null): McpTransportStateSummary | null {
  if (state === null) {
    return null
  }

  return { ...state }
}

export function isRetryableError(error: McpErrorSummary | null | undefined): boolean {
  return error?.retryable === true
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  now: () => string,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new McpConnectorError(createMcpErrorSummary('timeout', message, true, now)))
    }, timeoutMs)

    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function parseContentLength(headerText: string): number | null {
  for (const line of headerText.split(/\r?\n/g)) {
    const match = /^Content-Length:\s*(\d+)$/iu.exec(line.trim())
    if (match !== null) {
      return Number.parseInt(match[1], 10)
    }
  }

  return null
}

function normalizeToolEntry(entry: unknown, index: number): McpRemoteToolSummary {
  if (!isPlainRecord(entry) || typeof entry.name !== 'string' || entry.name.trim() === '') {
    throw new McpConnectorError(createMcpErrorSummary(
      'protocol_parse_failed',
      `The MCP server returned an invalid tool entry at index ${index}.`,
      false,
      () => new Date().toISOString(),
    ))
  }

  const inputSchema = isPlainRecord(entry.inputSchema) ? cloneRecord(entry.inputSchema) : {}
  const displayName = typeof entry.title === 'string' && entry.title.trim() !== ''
    ? entry.title.trim()
    : entry.name.trim()

  return {
    name: entry.name.trim(),
    displayName,
    description: typeof entry.description === 'string' && entry.description.trim() !== '' ? entry.description.trim() : null,
    inputSchema,
  }
}

function ensureUniqueToolNames(tools: readonly McpRemoteToolSummary[]): McpRemoteToolSummary[] {
  const seenToolNames = new Set<string>()

  for (const tool of tools) {
    if (seenToolNames.has(tool.name)) {
      throw new McpConnectorError(createMcpErrorSummary(
        'protocol_parse_failed',
        `The MCP server returned duplicate tool metadata for '${tool.name}'.`,
        false,
        () => new Date().toISOString(),
        { remoteToolName: tool.name },
      ))
    }

    seenToolNames.add(tool.name)
  }

  return cloneRemoteTools(tools)
}

function classifyNodeError(error: NodeJS.ErrnoException, now: () => string, fallbackCode: string): McpErrorSummary {
  if (error.code === 'ENOENT') {
    return createMcpErrorSummary('command_not_found', 'MCP stdio command or working directory was not found.', false, now, { nodeCode: error.code })
  }
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    return createMcpErrorSummary('permission_denied', 'MCP stdio command could not be started because permission was denied.', false, now, { nodeCode: error.code })
  }
  if (error.code === 'ETIMEDOUT') {
    return createMcpErrorSummary('timeout', 'The MCP connection attempt timed out.', true, now, { nodeCode: error.code })
  }
  if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'EPIPE') {
    return createMcpErrorSummary('network_unavailable', 'The MCP endpoint is temporarily unavailable.', true, now, { nodeCode: error.code })
  }

  return createMcpErrorSummary(fallbackCode, error.message, true, now, { nodeCode: error.code ?? null })
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>
}

function extractToolCallErrorMessage(content: unknown[]): string {
  for (const entry of content) {
    if (!isPlainRecord(entry)) {
      continue
    }
    if (entry.type === 'text' && typeof entry.text === 'string' && entry.text.trim() !== '') {
      return entry.text.trim()
    }
  }

  return 'The MCP tool returned an error result.'
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
