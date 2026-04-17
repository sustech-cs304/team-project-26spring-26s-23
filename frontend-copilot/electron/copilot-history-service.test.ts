import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HostedBackendService } from './runtime/hosted-backend-service'
import { createElectronCopilotHistoryService } from './copilot-history-service'

let debugModeEnabled = false

beforeEach(() => {
  debugModeEnabled = false
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createElectronCopilotHistoryService', () => {
  it('loads thread history through the hosted backend runtime with the local token header', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
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
      getDebugModeEnabled: () => debugModeEnabled,
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

    const firstCall = fetchMock.mock.calls[0]
    const init = firstCall?.[1] as RequestInit | undefined
    expect(firstCall?.[0]).toBe('http://127.0.0.1:8765/history/threads')
    expect(init?.method).toBe('GET')
    expect(init?.headers).toBeInstanceOf(Headers)
    expect((init?.headers as Headers).get('X-Local-Token')).toBe('history-token')
  })

  it('prefers the hosted backend local token and falls back only when it is unavailable', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ ok: true, version: 'chat-history-v1', threads: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = createHostedBackendServiceStub({
      runtimeBaseUrl: 'http://127.0.0.1:8765',
      localToken: 'service-token',
    })
    const service = createElectronCopilotHistoryService({
      ensureHostedBackendService: async () => hostedBackendService,
      getLocalToken: () => 'fallback-token',
      getDebugModeEnabled: () => debugModeEnabled,
    })

    await service.listThreads()
    const firstHeaders = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect((firstHeaders?.headers as Headers).get('X-Local-Token')).toBe('service-token')

    hostedBackendService.getLocalToken = vi.fn(() => null)
    await service.listThreads()
    const secondHeaders = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined
    expect((secondHeaders?.headers as Headers).get('X-Local-Token')).toBe('fallback-token')
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
      getDebugModeEnabled: () => debugModeEnabled,
    })

    await expect(service.getThreadDetail('missing-thread')).resolves.toEqual({
      ok: false,
      error: 'Failed to load persisted chat thread detail for "missing-thread": Thread missing.',
    })
  })

  it('issues rename, duplicate, delete, and database mutation requests with the expected methods and payloads', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => {
        if (url.endsWith('/history/threads/thread-1/rename')) {
          return JSON.stringify({
            ok: true,
            version: 'chat-history-v1',
            thread: {
              threadId: 'thread-1',
              boundAgentId: 'default',
              title: '已重命名线程',
              titleSource: 'manual',
              summary: '已持久化回复',
              summarySource: 'deterministic',
              createdAt: '2026-04-13T14:00:00Z',
              updatedAt: '2026-04-13T14:06:00Z',
              lastActivityAt: '2026-04-13T14:05:00Z',
              lastRunId: 'run-1',
              lastRunStatus: 'completed',
              lastUserMessagePreview: '你好',
              lastAssistantMessagePreview: '已持久化回复',
              driftSummary: {
                status: 'not_evaluated',
              },
            },
          })
        }
        if (url.endsWith('/history/threads/thread-1/duplicate')) {
          return JSON.stringify({
            ok: true,
            version: 'chat-history-v1',
            thread: {
              threadId: 'thread-copy-1',
              boundAgentId: 'default',
              title: '历史线程（副本）',
              titleSource: 'manual',
              summary: '已持久化回复',
              summarySource: 'deterministic',
              createdAt: '2026-04-13T14:06:30Z',
              updatedAt: '2026-04-13T14:06:30Z',
              lastActivityAt: '2026-04-13T14:06:30Z',
              lastRunId: 'run-copy-1',
              lastRunStatus: 'completed',
              lastUserMessagePreview: '你好',
              lastAssistantMessagePreview: '已持久化回复',
              driftSummary: {
                status: 'not_evaluated',
              },
            },
          })
        }
        if (url.endsWith('/history/threads/thread-1')) {
          return JSON.stringify({
            ok: true,
            version: 'chat-history-v1',
            threadId: 'thread-1',
            deletedAt: '2026-04-13T14:06:00Z',
          })
        }
        if (url.endsWith('/history/database/backup')) {
          return JSON.stringify({
            ok: true,
            version: 'chat-history-v1',
            databasePath: 'D:/workspace/copilot-data/database/copilot-chat.db',
            backupPath: 'D:/workspace/copilot-data/backups/copilot-chat.backup.db',
            createdAt: '2026-04-13T14:08:00Z',
          })
        }
        return JSON.stringify({
          ok: true,
          version: 'chat-history-v1',
          databasePath: 'D:/workspace/copilot-data/database/copilot-chat.db',
          sourcePath: 'D:/workspace/copilot-data/backups/copilot-chat.backup.db',
          restoredAt: '2026-04-13T14:09:00Z',
        })
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = createHostedBackendServiceStub({
      runtimeBaseUrl: 'http://127.0.0.1:8765',
    })
    const service = createElectronCopilotHistoryService({
      ensureHostedBackendService: async () => hostedBackendService,
      getLocalToken: () => 'history-token',
      getDebugModeEnabled: () => debugModeEnabled,
    })

    await expect(service.renameThread('thread-1', { title: '已重命名线程' })).resolves.toEqual({
      ok: true,
      version: 'chat-history-v1',
      thread: {
        threadId: 'thread-1',
        boundAgentId: 'default',
        title: '已重命名线程',
        titleSource: 'manual',
        summary: '已持久化回复',
        summarySource: 'deterministic',
        createdAt: '2026-04-13T14:00:00Z',
        updatedAt: '2026-04-13T14:06:00Z',
        lastActivityAt: '2026-04-13T14:05:00Z',
        lastRunId: 'run-1',
        lastRunStatus: 'completed',
        lastUserMessagePreview: '你好',
        lastAssistantMessagePreview: '已持久化回复',
        driftSummary: {
          status: 'not_evaluated',
        },
      },
    })
    await expect(service.duplicateThread('thread-1', { title: '历史线程（副本）' })).resolves.toEqual({
      ok: true,
      version: 'chat-history-v1',
      thread: {
        threadId: 'thread-copy-1',
        boundAgentId: 'default',
        title: '历史线程（副本）',
        titleSource: 'manual',
        summary: '已持久化回复',
        summarySource: 'deterministic',
        createdAt: '2026-04-13T14:06:30Z',
        updatedAt: '2026-04-13T14:06:30Z',
        lastActivityAt: '2026-04-13T14:06:30Z',
        lastRunId: 'run-copy-1',
        lastRunStatus: 'completed',
        lastUserMessagePreview: '你好',
        lastAssistantMessagePreview: '已持久化回复',
        driftSummary: {
          status: 'not_evaluated',
        },
      },
    })
    await expect(service.deleteThread('thread-1')).resolves.toEqual({
      ok: true,
      version: 'chat-history-v1',
      threadId: 'thread-1',
      deletedAt: '2026-04-13T14:06:00Z',
    })
    await expect(service.backupDatabase({ targetPath: 'backups/history.db' })).resolves.toEqual({
      ok: true,
      version: 'chat-history-v1',
      databasePath: 'D:/workspace/copilot-data/database/copilot-chat.db',
      backupPath: 'D:/workspace/copilot-data/backups/copilot-chat.backup.db',
      createdAt: '2026-04-13T14:08:00Z',
    })
    await expect(service.restoreDatabase({ sourcePath: 'backups/history.db' })).resolves.toEqual({
      ok: true,
      version: 'chat-history-v1',
      databasePath: 'D:/workspace/copilot-data/database/copilot-chat.db',
      sourcePath: 'D:/workspace/copilot-data/backups/copilot-chat.backup.db',
      restoredAt: '2026-04-13T14:09:00Z',
    })

    expect(hostedBackendService.start).toHaveBeenCalledTimes(5)
    expect(fetchMock.mock.calls).toHaveLength(5)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8765/history/threads/thread-1/rename')
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('POST')
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toBe('{"title":"已重命名线程"}')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:8765/history/threads/thread-1/duplicate')
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('POST')
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).body).toBe('{"title":"历史线程（副本）"}')
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://127.0.0.1:8765/history/threads/thread-1')
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe('DELETE')
    expect(fetchMock.mock.calls[3]?.[0]).toBe('http://127.0.0.1:8765/history/database/backup')
    expect((fetchMock.mock.calls[3]?.[1] as RequestInit).method).toBe('POST')
    expect((fetchMock.mock.calls[3]?.[1] as RequestInit).body).toBe('{"targetPath":"backups/history.db"}')
    expect(fetchMock.mock.calls[4]?.[0]).toBe('http://127.0.0.1:8765/history/database/restore')
    expect((fetchMock.mock.calls[4]?.[1] as RequestInit).method).toBe('POST')
    expect((fetchMock.mock.calls[4]?.[1] as RequestInit).body).toBe('{"sourcePath":"backups/history.db"}')
  })

  it('returns a structured failure when the hosted backend runtime URL is unavailable', async () => {
    const service = createElectronCopilotHistoryService({
      ensureHostedBackendService: async () => createHostedBackendServiceStub({
        runtimeBaseUrl: null,
      }),
      getLocalToken: () => 'history-token',
      getDebugModeEnabled: () => debugModeEnabled,
    })

    await expect(service.getRunReplay('run-1')).resolves.toEqual({
      ok: false,
      error: 'Failed to load persisted chat run replay for "run-1": Hosted backend runtime URL is unavailable.',
    })
  })

  it('emits structured debug logs for successful and failing history requests only when debug mode is enabled', async () => {
    const appendLog = vi.fn(async () => undefined)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => JSON.stringify({
          detail: {
            code: 'thread_not_found',
            message: 'Thread missing.',
          },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = createHostedBackendServiceStub({
      runtimeBaseUrl: 'http://127.0.0.1:8765',
    })
    const service = createElectronCopilotHistoryService({
      ensureHostedBackendService: async () => hostedBackendService,
      getLocalToken: () => 'history-token',
      appendLog,
      getDebugModeEnabled: () => debugModeEnabled,
    })

    await service.listThreads()
    expect(appendLog).not.toHaveBeenCalled()

    debugModeEnabled = true
    await service.listThreads()
    await service.getThreadDetail('missing-thread')

    expect(appendLog.mock.calls).toEqual([
      [
        'debug',
        '[copilot-history] request-started',
        expect.objectContaining({
          operation: 'list-threads',
          path: '/history/threads',
          method: 'GET',
          runtimeUrl: 'http://127.0.0.1:8765/history/threads',
          hasLocalToken: true,
        }),
      ],
      [
        'debug',
        '[copilot-history] request-succeeded',
        expect.objectContaining({
          operation: 'list-threads',
          status: 200,
          threadCount: 1,
        }),
      ],
      [
        'debug',
        '[copilot-history] request-started',
        expect.objectContaining({
          operation: 'get-thread-detail',
          path: '/history/threads/missing-thread',
          method: 'GET',
          runtimeUrl: 'http://127.0.0.1:8765/history/threads/missing-thread',
        }),
      ],
      [
        'debug',
        '[copilot-history] request-failed',
        expect.objectContaining({
          operation: 'get-thread-detail',
          status: 404,
          failureCode: 'thread_not_found',
          failureReason: 'Thread missing.',
        }),
      ],
    ])
  })
})

function createHostedBackendServiceStub(input: {
  runtimeBaseUrl: string | null
  localToken?: string | null
}): HostedBackendService {
  return {
    start: vi.fn(async () => ({ status: 'ready' } as never)),
    stop: vi.fn(async () => undefined),
    getState: vi.fn(() => ({ status: 'ready' } as never)),
    getLastFailure: vi.fn(() => null),
    getRuntimeBaseUrl: vi.fn(() => input.runtimeBaseUrl),
    getLocalToken: vi.fn(() => input.localToken ?? 'history-token'),
  }
}
