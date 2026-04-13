import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HostedBackendService } from './runtime/hosted-backend-service'
import { createElectronCopilotHistoryService } from './copilot-history-service'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createElectronCopilotHistoryService', () => {
  it('loads thread history through the hosted backend runtime with the local token header', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        ok: true,
        version: 'chat-history-v1',
        threads: [
          {
            threadId: 'thread-1',
            boundAgentId: 'default',
            title: '历史线程',
            titleSource: 'deterministic',
            summary: '已持久化回复',
            summarySource: 'deterministic',
            createdAt: '2026-04-13T14:00:00Z',
            updatedAt: '2026-04-13T14:05:00Z',
            lastActivityAt: '2026-04-13T14:05:00Z',
            lastRunId: 'run-1',
            lastRunStatus: 'completed',
            lastUserMessagePreview: '你好',
            lastAssistantMessagePreview: '已持久化回复',
            driftSummary: {
              status: 'not_evaluated',
            },
          },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = createHostedBackendServiceStub({
      runtimeBaseUrl: 'http://127.0.0.1:8765',
    })
    const service = createElectronCopilotHistoryService({
      ensureHostedBackendService: async () => hostedBackendService,
      getLocalToken: () => 'history-token',
    })

    const result = await service.listThreads()

    expect(result).toEqual({
      ok: true,
      version: 'chat-history-v1',
      threads: [
        {
          threadId: 'thread-1',
          boundAgentId: 'default',
          title: '历史线程',
          titleSource: 'deterministic',
          summary: '已持久化回复',
          summarySource: 'deterministic',
          createdAt: '2026-04-13T14:00:00Z',
          updatedAt: '2026-04-13T14:05:00Z',
          lastActivityAt: '2026-04-13T14:05:00Z',
          lastRunId: 'run-1',
          lastRunStatus: 'completed',
          lastUserMessagePreview: '你好',
          lastAssistantMessagePreview: '已持久化回复',
          driftSummary: {
            status: 'not_evaluated',
          },
        },
      ],
    })
    expect(hostedBackendService.start).toHaveBeenCalledOnce()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8765/history/threads')
    expect(init.method).toBe('GET')
    expect(init.headers).toBeInstanceOf(Headers)
    expect((init.headers as Headers).get('X-Local-Token')).toBe('history-token')
  })

  it('surfaces backend detail messages for failing history detail requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => JSON.stringify({
        detail: {
          code: 'thread_not_found',
          message: 'Thread missing.',
        },
      }),
    })))

    const service = createElectronCopilotHistoryService({
      ensureHostedBackendService: async () => createHostedBackendServiceStub({
        runtimeBaseUrl: 'http://127.0.0.1:8765',
      }),
      getLocalToken: () => null,
    })

    await expect(service.getThreadDetail('missing-thread')).resolves.toEqual({
      ok: false,
      error: 'Failed to load persisted chat thread detail for "missing-thread": Thread missing.',
    })
  })

  it('returns a structured failure when the hosted backend runtime URL is unavailable', async () => {
    const service = createElectronCopilotHistoryService({
      ensureHostedBackendService: async () => createHostedBackendServiceStub({
        runtimeBaseUrl: null,
      }),
      getLocalToken: () => 'history-token',
    })

    await expect(service.getRunReplay('run-1')).resolves.toEqual({
      ok: false,
      error: 'Failed to load persisted chat run replay for "run-1": Hosted backend runtime URL is unavailable.',
    })
  })
})

function createHostedBackendServiceStub(input: {
  runtimeBaseUrl: string | null
}): HostedBackendService {
  return {
    start: vi.fn(async () => ({ status: 'ready' } as never)),
    stop: vi.fn(async () => undefined),
    getState: vi.fn(() => ({ status: 'ready' } as never)),
    getLastFailure: vi.fn(() => null),
    getRuntimeBaseUrl: vi.fn(() => input.runtimeBaseUrl),
    getLocalToken: vi.fn(() => 'history-token'),
  }
}
