import type {
  McpDeleteServerSuccess,
  McpRefreshCatalogSuccess,
  McpRegistryLoadSuccess,
  McpRegistrySubscriptionEvent,
  McpSaveServerSuccess,
  McpServerDraft,
  McpServerValidationError,
  McpSetServerEnabledSuccess,
  McpTestConnectionSuccess,
} from './types'

export const MCP_REGISTRY_LOAD_CHANNEL = 'mcp-registry:load'
export const MCP_REGISTRY_SAVE_SERVER_CHANNEL = 'mcp-registry:save-server'
export const MCP_REGISTRY_DELETE_SERVER_CHANNEL = 'mcp-registry:delete-server'
export const MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL = 'mcp-registry:set-server-enabled'
export const MCP_REGISTRY_TEST_CONNECTION_CHANNEL = 'mcp-registry:test-connection'
export const MCP_REGISTRY_REFRESH_CATALOG_CHANNEL = 'mcp-registry:refresh-catalog'
export const MCP_REGISTRY_SUBSCRIPTION_CHANNEL = 'mcp-registry:subscription'

export const MCP_REGISTRY_NOT_IMPLEMENTED_ERROR_CODE = 'not_implemented'

export interface McpRegistryLoadRequest {
  language?: string | null
  includeDisabled?: boolean
}

export interface McpSetServerEnabledRequest {
  serverId: string
  enabled: boolean
}

export interface McpTestConnectionRequest {
  serverId?: string
  draft?: McpServerDraft
}

export interface McpRefreshCatalogRequest {
  serverId?: string | null
}

export interface McpRegistryApiFailure {
  ok: false
  error: string
  code: string
  validationErrors?: McpServerValidationError[]
}

export type McpRegistryLoadResult = McpRegistryLoadSuccess | McpRegistryApiFailure
export type McpSaveServerResult = McpSaveServerSuccess | McpRegistryApiFailure
export type McpDeleteServerResult = McpDeleteServerSuccess | McpRegistryApiFailure
export type McpSetServerEnabledResult = McpSetServerEnabledSuccess | McpRegistryApiFailure
export type McpTestConnectionResult = McpTestConnectionSuccess | McpRegistryApiFailure
export type McpRefreshCatalogResult = McpRefreshCatalogSuccess | McpRegistryApiFailure

export interface McpRegistryApi {
  loadRegistry: (request?: McpRegistryLoadRequest) => Promise<McpRegistryLoadResult>
  saveServer: (draft: McpServerDraft) => Promise<McpSaveServerResult>
  deleteServer: (serverId: string) => Promise<McpDeleteServerResult>
  setServerEnabled: (request: McpSetServerEnabledRequest) => Promise<McpSetServerEnabledResult>
  testConnection: (request: McpTestConnectionRequest) => Promise<McpTestConnectionResult>
  refreshCatalog: (request?: McpRefreshCatalogRequest) => Promise<McpRefreshCatalogResult>
}

export interface McpRegistrySubscriptionApi {
  subscribe: (listener: (event: McpRegistrySubscriptionEvent) => void) => (() => void)
}

interface McpRegistrySubscriptionEventSource {
  on: (channel: string, listener: (...args: unknown[]) => void) => void
  off: (channel: string, listener: (...args: unknown[]) => void) => void
}

export function createEmptyMcpRegistryLoadSuccess(): McpRegistryLoadSuccess {
  return {
    ok: true,
    registryRevision: 0,
    snapshotRevision: 0,
    servers: [],
    states: [],
  }
}

export function createMcpRegistryApiFailure(
  error: string,
  code: string = MCP_REGISTRY_NOT_IMPLEMENTED_ERROR_CODE,
  validationErrors: McpServerValidationError[] = [],
): McpRegistryApiFailure {
  return {
    ok: false,
    error,
    code,
    ...(validationErrors.length > 0 ? { validationErrors } : {}),
  }
}

export function createMcpRegistrySubscriptionApi(
  eventSource: McpRegistrySubscriptionEventSource,
): McpRegistrySubscriptionApi {
  return {
    subscribe(listener) {
      const wrappedListener = (_event: unknown, eventPayload: unknown) => {
        if (!isMcpRegistrySubscriptionEvent(eventPayload)) {
          console.error(
            `[mcp-registry] Ignored invalid subscription payload on "${MCP_REGISTRY_SUBSCRIPTION_CHANNEL}".`,
            eventPayload,
          )
          return
        }

        listener(eventPayload)
      }

      eventSource.on(MCP_REGISTRY_SUBSCRIPTION_CHANNEL, wrappedListener)

      return () => {
        eventSource.off(MCP_REGISTRY_SUBSCRIPTION_CHANNEL, wrappedListener)
      }
    },
  }
}

function isMcpRegistrySubscriptionEvent(value: unknown): value is McpRegistrySubscriptionEvent {
  if (!isPlainRecord(value) || !hasRevisionState(value)) {
    return false
  }

  if (value.kind === 'snapshot') {
    return Array.isArray(value.servers) && Array.isArray(value.states)
  }

  if (value.kind === 'server-state') {
    return typeof value.serverId === 'string' && isPlainRecord(value.state)
  }

  if (value.kind === 'server-removed') {
    return typeof value.serverId === 'string'
  }

  if (value.kind === 'catalog') {
    return Array.isArray(value.refreshedServerIds)
  }

  return false
}

function hasRevisionState(value: Record<string, unknown>): boolean {
  return typeof value.registryRevision === 'number' && typeof value.snapshotRevision === 'number'
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
