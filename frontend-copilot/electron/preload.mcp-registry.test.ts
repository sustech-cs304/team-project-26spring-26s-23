import { describe, expect, it, vi } from 'vitest'

import {
  MCP_REGISTRY_DELETE_SERVER_CHANNEL,
  MCP_REGISTRY_LOAD_CHANNEL,
  MCP_REGISTRY_REFRESH_CATALOG_CHANNEL,
  MCP_REGISTRY_SAVE_SERVER_CHANNEL,
  MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL,
  MCP_REGISTRY_SUBSCRIPTION_CHANNEL,
  MCP_REGISTRY_TEST_CONNECTION_CHANNEL,
  type McpRegistryApi,
  type McpRegistrySubscriptionApi,
} from './mcp-registry/ipc'
import { MANAGED_RUNTIME_LOAD_CHANNEL } from './managed-runtime/ipc'
import {
  getExposedApi,
  getInvokeMock,
  getOffMock,
  getRegisteredOnListener,
  loadPreloadModule,
} from './preload.test-support'
import {
  createMcpRegistrySubscriptionEventFixture,
  createMcpStdioStubServerFixture,
} from './renderer-ipc.test-support'

describe('preload mcp registry bridge', () => {
  it('routes registry CRUD and refresh calls through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const mcpRegistryApi = getExposedApi<McpRegistryApi>('mcpRegistry')
    const managedRuntimeApi = getExposedApi<{ load: () => Promise<unknown> }>('managedRuntime')
    const draft = createMcpStdioStubServerFixture()

    await managedRuntimeApi.load()
    await mcpRegistryApi.loadRegistry({ language: 'zh-CN', includeDisabled: true })
    await mcpRegistryApi.saveServer(draft)
    await mcpRegistryApi.deleteServer(draft.serverId)
    await mcpRegistryApi.setServerEnabled({ serverId: draft.serverId, enabled: false })
    await mcpRegistryApi.testConnection({ draft })
    await mcpRegistryApi.refreshCatalog({ serverId: draft.serverId })

    expect(invokeMock.mock.calls).toEqual([
      [MANAGED_RUNTIME_LOAD_CHANNEL],
      [MCP_REGISTRY_LOAD_CHANNEL, { language: 'zh-CN', includeDisabled: true }],
      [MCP_REGISTRY_SAVE_SERVER_CHANNEL, draft],
      [MCP_REGISTRY_DELETE_SERVER_CHANNEL, draft.serverId],
      [MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL, { serverId: draft.serverId, enabled: false }],
      [MCP_REGISTRY_TEST_CONNECTION_CHANNEL, { draft }],
      [MCP_REGISTRY_REFRESH_CATALOG_CHANNEL, { serverId: draft.serverId }],
    ])
  })

  it('validates registry subscription payloads before forwarding them to the renderer', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await loadPreloadModule()

    const subscriptionApi = getExposedApi<McpRegistrySubscriptionApi>('mcpRegistrySubscription')
    const listener = vi.fn()
    const unsubscribe = subscriptionApi.subscribe(listener)
    const wrappedListener = getRegisteredOnListener<(event: unknown, payload: unknown) => void>(MCP_REGISTRY_SUBSCRIPTION_CHANNEL)
    const validEvent = createMcpRegistrySubscriptionEventFixture('snapshot')

    wrappedListener(undefined, validEvent)
    wrappedListener(undefined, { kind: 'unknown' })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(validEvent)
    expect(errorSpy).toHaveBeenCalledOnce()

    unsubscribe()

    expect(getOffMock().mock.calls).toHaveLength(1)
    expect(getOffMock().mock.calls[0]?.[0]).toBe(MCP_REGISTRY_SUBSCRIPTION_CHANNEL)
    expect(getOffMock().mock.calls[0]?.[1]).toBe(wrappedListener)

    errorSpy.mockRestore()
  })
})
