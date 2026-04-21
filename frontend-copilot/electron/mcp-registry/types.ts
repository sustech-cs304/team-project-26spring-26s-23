export const MCP_REGISTRY_DOCUMENT_VERSION = 1 as const
export const MCP_SNAPSHOT_VERSION = 1 as const
export const MCP_TOOL_ID_PREFIX = 'mcp' as const
export const MCP_CAPABILITY_SNAPSHOT_FILE_NAME = 'mcp-capability-snapshot.json' as const
export const MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID = '__runtime.mcp.catalog__' as const
export const MCP_CAPABILITY_SNAPSHOT_BRIDGE_KEY = 'snapshot' as const

export type McpTransportKind = 'stdio' | 'http-sse'
export type McpConnectionState = 'disabled' | 'idle' | 'connecting' | 'connected' | 'degraded' | 'error'
export type McpToolAvailability = 'available' | 'degraded' | 'unavailable'

export interface McpRevisionState {
  registryRevision: number
  snapshotRevision: number
}

export interface McpServerValidationError {
  fieldPath: string
  message: string
  code?: string
}

export interface McpErrorSummary {
  code: string
  message: string
  retryable: boolean
  observedAt?: string | null
  details?: Record<string, unknown> | null
}

export interface McpStdioTransportConfig {
  kind: 'stdio'
  command: string
  args: string[]
  cwd?: string | null
  env?: Record<string, string>
}

export interface McpHttpSseTransportConfig {
  kind: 'http-sse'
  baseUrl: string
  headers?: Record<string, string>
  env?: Record<string, string>
  ssePathOverride?: string | null
}

export type McpTransportConfig = McpStdioTransportConfig | McpHttpSseTransportConfig

export interface McpServerDraft {
  serverId: string
  displayName: string
  enabled: boolean
  transportKind: McpTransportKind
  description?: string | null
  transportConfig: McpTransportConfig
  reservedSensitiveFields?: string[]
}

export interface McpServerRecord extends McpServerDraft {
  createdAt: string
  updatedAt: string
}

export interface McpStdioTransportStateSummary {
  kind: 'stdio'
  processStatus: 'stopped' | 'starting' | 'running' | 'exited'
  pid?: number | null
  lastExitCode?: number | null
  lastExitSignal?: string | null
}

export interface McpHttpSseTransportStateSummary {
  kind: 'http-sse'
  endpointStatus: 'offline' | 'connecting' | 'online'
  lastHttpStatus?: number | null
  sseOnline?: boolean
}

export type McpTransportStateSummary = McpStdioTransportStateSummary | McpHttpSseTransportStateSummary

export interface McpServerStateSummary {
  serverId: string
  enabled: boolean
  connectionState: McpConnectionState
  toolCount: number
  lastHandshakeAt?: string | null
  lastCatalogSyncAt?: string | null
  lastError?: McpErrorSummary | null
  transportState?: McpTransportStateSummary | null
  reconnectAttempt: number
}

export interface McpSnapshotCatalogRefreshSummary {
  refreshedAt: string
  toolCount: number
}

export interface McpRegistryLoadSuccess extends McpRevisionState {
  ok: true
  servers: McpServerRecord[]
  states: McpServerStateSummary[]
}

export interface McpSaveServerSuccess extends McpRevisionState {
  ok: true
  server: McpServerRecord
  state: McpServerStateSummary | null
  validationErrors: McpServerValidationError[]
}

export interface McpDeleteServerSuccess extends McpRevisionState {
  ok: true
  serverId: string
  deleted: true
}

export interface McpSetServerEnabledSuccess extends McpRevisionState {
  ok: true
  server: McpServerRecord
  state: McpServerStateSummary | null
}

export interface McpTestConnectionSuccess {
  ok: true
  success: boolean
  transportKind: McpTransportKind
  toolCount: number
  durationMs: number
  error?: McpErrorSummary | null
  warnings?: string[]
}

export interface McpRefreshCatalogServerResult {
  serverId: string
  toolCount: number
  connectionState: McpConnectionState
  error?: McpErrorSummary | null
}

export interface McpRefreshCatalogSuccess extends McpRevisionState {
  ok: true
  refreshedServerIds: string[]
  results: McpRefreshCatalogServerResult[]
}

export interface McpRegistrySnapshotEvent extends McpRevisionState {
  kind: 'snapshot'
  servers: McpServerRecord[]
  states: McpServerStateSummary[]
}

export interface McpRegistryServerStateEvent extends McpRevisionState {
  kind: 'server-state'
  serverId: string
  state: McpServerStateSummary
}

export interface McpRegistryServerRemovedEvent extends McpRevisionState {
  kind: 'server-removed'
  serverId: string
}

export interface McpRegistryCatalogEvent extends McpRevisionState {
  kind: 'catalog'
  refreshedServerIds: string[]
  serverId?: string | null
}

export type McpRegistrySubscriptionEvent =
  | McpRegistrySnapshotEvent
  | McpRegistryServerStateEvent
  | McpRegistryServerRemovedEvent
  | McpRegistryCatalogEvent

export interface McpSnapshotServerSummary {
  serverId: string
  displayName: string
  transportKind: McpTransportKind
  connectionState: McpConnectionState
  toolCount: number
  lastHandshakeAt?: string | null
  lastCatalogSyncAt?: string | null
  lastError?: McpErrorSummary | null
  lastSuccessfulCatalogRefresh?: McpSnapshotCatalogRefreshSummary | null
}

export interface McpSnapshotToolSummary {
  toolId: string
  serverId: string
  remoteToolName: string
  displayName: string
  description?: string | null
  inputSchema: Record<string, unknown>
  sourceKind: 'mcp'
  availability: McpToolAvailability
  groupId?: string | null
  groupLabel?: string | null
}

export interface McpSnapshotGroupSummary {
  groupId: string
  displayName: string
  sourceKind: 'mcp'
  toolIds: string[]
}

export interface McpCapabilitySnapshot extends McpRevisionState {
  version: typeof MCP_SNAPSHOT_VERSION
  generatedAt: string
  servers: McpSnapshotServerSummary[]
  tools: McpSnapshotToolSummary[]
  groups: McpSnapshotGroupSummary[]
}

export interface McpToolCallRequest {
  toolId: string
  serverId: string
  remoteToolName: string
  arguments: Record<string, unknown>
  runId: string
  toolCallId: string
  snapshotRevision?: number | null
}

export interface McpToolCallSuccess {
  ok: true
  toolId: string
  serverId: string
  remoteToolName: string
  content: unknown[]
  structuredContent?: unknown
  snapshotRevision?: number | null
  isError?: false
}

export interface McpToolCallFailure {
  ok: false
  toolId: string
  serverId: string
  remoteToolName: string
  snapshotRevision?: number | null
  error: McpErrorSummary
}

export type McpToolCallResult = McpToolCallSuccess | McpToolCallFailure
