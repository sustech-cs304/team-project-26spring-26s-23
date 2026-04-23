import {
  createMcpRegistryApiFailure,
  type McpDeleteServerResult,
  type McpRefreshCatalogRequest,
  type McpRefreshCatalogResult,
  type McpRegistryApi,
  type McpRegistryLoadRequest,
  type McpRegistryLoadResult,
  type McpRegistrySubscriptionApi,
  type McpSaveServerResult,
  type McpSetServerEnabledRequest,
  type McpSetServerEnabledResult,
  type McpTestConnectionRequest,
  type McpTestConnectionResult,
} from '../../../electron/mcp-registry/ipc'
import type { McpRegistrySubscriptionEvent, McpServerDraft } from '../../../electron/mcp-registry/types'

const MCP_REGISTRY_API_UNAVAILABLE_ERROR = 'window.mcpRegistry is unavailable in the renderer process.'

export interface McpRegistryClient {
  loadRegistry(request?: McpRegistryLoadRequest): Promise<McpRegistryLoadResult>
  saveServer(draft: McpServerDraft): Promise<McpSaveServerResult>
  deleteServer(serverId: string): Promise<McpDeleteServerResult>
  setServerEnabled(request: McpSetServerEnabledRequest): Promise<McpSetServerEnabledResult>
  testConnection(request: McpTestConnectionRequest): Promise<McpTestConnectionResult>
  refreshCatalog(request?: McpRefreshCatalogRequest): Promise<McpRefreshCatalogResult>
  subscribe(listener: (event: McpRegistrySubscriptionEvent) => void): () => void
}

export function createWindowMcpRegistryClient(): McpRegistryClient {
  return {
    async loadRegistry(request) {
      const api = getMcpRegistryApi()
      return api ? await api.loadRegistry(request) : createFailureResult(MCP_REGISTRY_API_UNAVAILABLE_ERROR)
    },
    async saveServer(draft) {
      const api = getMcpRegistryApi()
      return api ? await api.saveServer(draft) : createFailureResult(MCP_REGISTRY_API_UNAVAILABLE_ERROR)
    },
    async deleteServer(serverId) {
      const api = getMcpRegistryApi()
      return api ? await api.deleteServer(serverId) : createFailureResult(MCP_REGISTRY_API_UNAVAILABLE_ERROR)
    },
    async setServerEnabled(request) {
      const api = getMcpRegistryApi()
      return api ? await api.setServerEnabled(request) : createFailureResult(MCP_REGISTRY_API_UNAVAILABLE_ERROR)
    },
    async testConnection(request) {
      const api = getMcpRegistryApi()
      return api ? await api.testConnection(request) : createFailureResult(MCP_REGISTRY_API_UNAVAILABLE_ERROR)
    },
    async refreshCatalog(request) {
      const api = getMcpRegistryApi()
      return api ? await api.refreshCatalog(request) : createFailureResult(MCP_REGISTRY_API_UNAVAILABLE_ERROR)
    },
    subscribe(listener) {
      const subscriptionApi = getMcpRegistrySubscriptionApi()
      return subscriptionApi ? subscriptionApi.subscribe(listener) : () => {}
    },
  }
}

function getMcpRegistryApi(): McpRegistryApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.mcpRegistry
}

function getMcpRegistrySubscriptionApi(): McpRegistrySubscriptionApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.mcpRegistrySubscription
}

function createFailureResult<TResult>(error: string): TResult {
  return createMcpRegistryApiFailure(error, 'api_unavailable') as TResult
}
