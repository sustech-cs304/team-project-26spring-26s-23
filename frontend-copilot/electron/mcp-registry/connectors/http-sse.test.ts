import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMcpHttpSseStubServerFixture } from '../test-support'
import { createHttpSseMcpServerConnector } from './http-sse'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createHttpSseMcpServerConnector', () => {
  it('performs initialize, SSE probe, and tools/list over fetch', async () => {
    const server = createMcpHttpSseStubServerFixture()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'fixture' } } }))
      .mockResolvedValueOnce(createEmptyResponse())
      .mockResolvedValueOnce(createSseProbeResponse())
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [{
            name: 'fetch-calendar',
            title: 'Fetch Calendar',
            description: 'Fetch the course calendar.',
            inputSchema: { type: 'object' },
          }],
        },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const states: string[] = []
    const connector = createHttpSseMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 1_000,
        onStateChange(state) {
          states.push(state.connectionState)
        },
      },
    })

    const transportConfig = server.transportConfig.kind === 'http-sse' ? server.transportConfig : null
    if (transportConfig === null) {
      throw new Error('Expected an http-sse transport config for the fixture server.')
    }

    const result = await connector.start()

    expect(result.ok).toBe(true)
    expect(result.tools).toHaveLength(1)
    expect(result.state.connectionState).toBe('connected')
    expect(states).toEqual(['connecting', 'connected'])
    expect(fetchMock).toHaveBeenNthCalledWith(1, transportConfig.baseUrl, expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:34081/events', expect.objectContaining({ method: 'GET' }))
  })

  it('calls MCP tools over HTTP/SSE once the session is ready', async () => {
    const server = createMcpHttpSseStubServerFixture()
    const transportConfig = server.transportConfig.kind === 'http-sse' ? server.transportConfig : null
    if (transportConfig === null) {
      throw new Error('Expected an http-sse transport config for the fixture server.')
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'fixture' } } }))
      .mockResolvedValueOnce(createEmptyResponse())
      .mockResolvedValueOnce(createSseProbeResponse())
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [{
            name: 'fetch-calendar',
            title: 'Fetch Calendar',
            description: 'Fetch the course calendar.',
            inputSchema: { type: 'object' },
          }],
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: '2.0',
        id: 3,
        result: {
          content: [{ type: 'text', text: 'fetch-calendar completed' }],
          structuredContent: { echoedArguments: { course: 'CS304' } },
          isError: false,
        },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const connector = createHttpSseMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 1_000,
      },
    })

    await connector.start()
    const result = await connector.callTool({
      toolId: 'mcp.test.fetch-calendar',
      serverId: server.serverId,
      remoteToolName: 'fetch-calendar',
      arguments: { course: 'CS304' },
      snapshotRevision: 10,
    })

    expect(result).toEqual({
      ok: true,
      toolId: 'mcp.test.fetch-calendar',
      serverId: server.serverId,
      remoteToolName: 'fetch-calendar',
      content: [{ type: 'text', text: 'fetch-calendar completed' }],
      structuredContent: { echoedArguments: { course: 'CS304' } },
      snapshotRevision: 10,
      isError: false,
    })
    expect(fetchMock).toHaveBeenLastCalledWith(transportConfig.baseUrl, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'fetch-calendar',
          arguments: { course: 'CS304' },
        },
      }),
    }))

    await connector.stop()
  })

  it('classifies 401 responses as non-retryable configuration errors', async () => {
    const server = createMcpHttpSseStubServerFixture()
    const fetchMock = vi.fn().mockResolvedValue(createUnauthorizedResponse())
    vi.stubGlobal('fetch', fetchMock)

    const connector = createHttpSseMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 1_000,
      },
    })

    const result = await connector.start()

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected failure result.')
    }
    expect(result.error).toMatchObject({
      code: 'http_unauthorized',
      retryable: false,
    })
    expect(result.state.connectionState).toBe('error')
  })

  it('marks refresh failures as degraded while keeping the last successful tool snapshot', async () => {
    const server = createMcpHttpSseStubServerFixture()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'fixture' } } }))
      .mockResolvedValueOnce(createEmptyResponse())
      .mockResolvedValueOnce(createSseProbeResponse())
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [{
            name: 'fetch-calendar',
            title: 'Fetch Calendar',
            description: 'Fetch the course calendar.',
            inputSchema: { type: 'object' },
          }],
        },
      }))
      .mockResolvedValueOnce(createUnavailableResponse())
    vi.stubGlobal('fetch', fetchMock)

    const connector = createHttpSseMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 1_000,
      },
    })

    await connector.start()
    const refreshed = await connector.refreshCatalog()

    expect(refreshed.ok).toBe(false)
    if (refreshed.ok) {
      throw new Error('Expected refresh failure result.')
    }
    expect(refreshed.state.connectionState).toBe('degraded')
    expect(refreshed.tools).toHaveLength(1)
    expect(refreshed.error).toMatchObject({
      code: 'http_server_error',
      retryable: true,
    })
  })

  it('rejects duplicate tool names from HTTP/SSE servers as protocol failures', async () => {
    const server = createMcpHttpSseStubServerFixture()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'fixture' } } }))
      .mockResolvedValueOnce(createEmptyResponse())
      .mockResolvedValueOnce(createSseProbeResponse())
      .mockResolvedValueOnce(createJsonResponse({
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [
            {
              name: 'fetch-calendar',
              title: 'Fetch Calendar',
              description: 'Fetch the course calendar.',
              inputSchema: { type: 'object' },
            },
            {
              name: 'fetch-calendar',
              title: 'Fetch Calendar Duplicate',
              description: 'Duplicate metadata.',
              inputSchema: { type: 'object' },
            },
          ],
        },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const connector = createHttpSseMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 1_000,
      },
    })

    const result = await connector.start()

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected duplicate tool metadata failure result.')
    }
    expect(result.error).toMatchObject({
      code: 'protocol_parse_failed',
      retryable: false,
      details: { remoteToolName: 'fetch-calendar' },
    })
    expect(result.state.connectionState).toBe('error')
    expect(result.tools).toEqual([])
    expect(connector.getTools()).toEqual([])
  })
})

function createJsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(payload),
  }
}

function createEmptyResponse() {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => '',
  }
}

function createSseProbeResponse() {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: { cancel: async () => undefined },
  }
}

function createUnauthorizedResponse() {
  return {
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({ error: 'unauthorized' }),
  }
}

function createUnavailableResponse() {
  return {
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({ error: 'temporary outage' }),
  }
}
