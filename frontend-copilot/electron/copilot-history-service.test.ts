import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HostedBackendService } from './runtime/hosted-backend-service'
import { createElectronCopilotHistoryService } from './copilot-history-service'

const LOCAL_RUNTIME_TOKEN_HEADER = 'X-Local-Token'
const HISTORY_API_VERSION = 'chat-history-v1'
const HISTORY_RUNTIME_BASE_URL = 'http://127.0.0.1:8765'
const HISTORY_LOCAL_TOKEN = 'history-token'
const HISTORY_THREAD_ID = 'thread-1'
const HISTORY_THREAD_COPY_ID = 'thread-copy-1'
const HISTORY_RUN_ID = 'run-1'
const HISTORY_THREAD_TITLE = '历史线程'
const HISTORY_THREAD_COPY_TITLE = '历史线程（副本）'
const HISTORY_THREAD_SUMMARY = '已持久化回复'
const HISTORY_USER_MESSAGE = '你好'
const HISTORY_CREATED_AT = '2026-04-13T14:00:00Z'
const HISTORY_UPDATED_AT = '2026-04-13T14:05:00Z'
const HISTORY_COPY_CREATED_AT = '2026-04-13T14:06:30Z'
const HISTORY_DB_PATH = 'D:/workspace/copilot-data/database/copilot-chat.db'
const HISTORY_BACKUP_PATH = 'D:/workspace/copilot-data/backups/copilot-chat.backup.db'
const HISTORY_DB_BACKUP_AT = '2026-04-13T14:08:00Z'
const HISTORY_DB_RESTORE_AT = '2026-04-13T14:09:00Z'
const HISTORY_DETAIL_MISSING_MESSAGE = 'Thread missing.'

let debugModeEnabled = false

beforeEach(() => {
  debugModeEnabled = false
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type HistoryThreadFixture = {
  threadId: string
  boundAgentId: string
  title: string
  titleSource: 'deterministic' | 'manual'
  summary: string
  summarySource: 'deterministic'
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  lastRunId: string
  lastRunStatus: 'completed'
  lastUserMessagePreview: string
  lastAssistantMessagePreview: string
  driftSummary: {
    status: 'not_evaluated'
  }
}

function createHistoryThread(overrides: Partial<HistoryThreadFixture> = {}): HistoryThreadFixture {
  const { driftSummary: overrideDrift, ...rest } = overrides

  return {
    threadId: HISTORY_THREAD_ID,
    boundAgentId: 'default',
    title: HISTORY_THREAD_TITLE,
    titleSource: 'deterministic',
    summary: HISTORY_THREAD_SUMMARY,
    summarySource: 'deterministic',
    createdAt: HISTORY_CREATED_AT,
    updatedAt: HISTORY_UPDATED_AT,
    lastActivityAt: HISTORY_UPDATED_AT,
    lastRunId: 'run-1',
    lastRunStatus: 'completed',
    lastUserMessagePreview: HISTORY_USER_MESSAGE,
    lastAssistantMessagePreview: HISTORY_THREAD_SUMMARY,
    ...rest,
    driftSummary: overrideDrift ?? {
      status: 'not_evaluated',
    },
  }
}

function createHistoryListThreadsResult(
  threads: HistoryThreadFixture[] = [createHistoryThread()],
): { ok: true; version: string; threads: HistoryThreadFixture[] } {
  return {
    ok: true,
    version: HISTORY_API_VERSION,
    threads,
  }
}

function createHistoryThreadMutationResult(
  thread: HistoryThreadFixture,
): { ok: true; version: string; thread: HistoryThreadFixture } {
  return {
    ok: true,
    version: HISTORY_API_VERSION,
    thread,
  }
}

function createHistoryDeleteResult(): { ok: true; version: string; threadId: string; deletedAt: string } {
  return {
    ok: true,
    version: HISTORY_API_VERSION,
    threadId: HISTORY_THREAD_ID,
    deletedAt: HISTORY_UPDATED_AT,
  }
}

function createHistoryBackupResult(): {
  ok: true
  version: string
  databasePath: string
  backupPath: string
  createdAt: string
} {
  return {
    ok: true,
    version: HISTORY_API_VERSION,
    databasePath: HISTORY_DB_PATH,
    backupPath: HISTORY_BACKUP_PATH,
    createdAt: HISTORY_DB_BACKUP_AT,
  }
}

function createHistoryRestoreResult(): {
  ok: true
  version: string
  databasePath: string
  sourcePath: string
  restoredAt: string
} {
  return {
    ok: true,
    version: HISTORY_API_VERSION,
    databasePath: HISTORY_DB_PATH,
    sourcePath: HISTORY_BACKUP_PATH,
    restoredAt: HISTORY_DB_RESTORE_AT,
  }
}

function createJsonFetchResponse(
  payload: unknown,
  response?: {
    ok?: boolean
    status?: number
    statusText?: string
  },
) {
  return {
    ok: response?.ok ?? true,
    status: response?.status ?? 200,
    statusText: response?.statusText ?? 'OK',
    text: async () => JSON.stringify(payload),
  }
}

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
    getLocalToken: vi.fn(() => input.localToken ?? HISTORY_LOCAL_TOKEN),
  }
}

function createHistoryService(input: {
  hostedBackendService?: HostedBackendService
  runtimeBaseUrl?: string | null
  localToken?: string | null
  appendLog?: (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown> | null,
  ) => Promise<void> | void
} = {}) {
  const hostedBackendService = input.hostedBackendService ?? createHostedBackendServiceStub({
    runtimeBaseUrl: input.runtimeBaseUrl !== undefined ? input.runtimeBaseUrl : HISTORY_RUNTIME_BASE_URL,
    localToken: input.localToken,
  })

  return createElectronCopilotHistoryService({
    ensureHostedBackendService: async () => hostedBackendService,
    getLocalToken: () => HISTORY_LOCAL_TOKEN,
    appendLog: input.appendLog,
    getDebugModeEnabled: () => debugModeEnabled,
  })
}

// eslint-disable-next-line max-lines-per-function -- This describe groups sub-describes for read/mutation/debug operations; each inner describe stays under the limit, and further splitting would disrupt readability.
describe('createElectronCopilotHistoryService', () => {
  describe('read operations', () => {
    it('loads thread history through the hosted backend runtime with the local token header', async () => {
      const expectedThread = createHistoryThread()
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
        createJsonFetchResponse(createHistoryListThreadsResult([expectedThread])))
      vi.stubGlobal('fetch', fetchMock)

      const hostedBackendService = createHostedBackendServiceStub({
        runtimeBaseUrl: HISTORY_RUNTIME_BASE_URL,
      })
      const service = createHistoryService({ hostedBackendService })

      const result = await service.listThreads()

      expect(result).toEqual(createHistoryListThreadsResult([expectedThread]))
      expect(hostedBackendService.start).toHaveBeenCalledOnce()

      const firstCall = fetchMock.mock.calls[0]
      const init = firstCall?.[1] as RequestInit | undefined
      expect(firstCall?.[0]).toBe(`${HISTORY_RUNTIME_BASE_URL}/history/threads`)
      expect(init?.method).toBe('GET')
      expect(init?.headers).toBeInstanceOf(Headers)
      expect((init?.headers as Headers).get(LOCAL_RUNTIME_TOKEN_HEADER)).toBe(HISTORY_LOCAL_TOKEN)
    })

    it('prefers the hosted backend local token and falls back only when it is unavailable', async () => {
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
        createJsonFetchResponse(createHistoryListThreadsResult([])))
      vi.stubGlobal('fetch', fetchMock)

      const hostedBackendService = createHostedBackendServiceStub({
        runtimeBaseUrl: HISTORY_RUNTIME_BASE_URL,
        localToken: 'service-token',
      })
      const service = createHistoryService({ hostedBackendService })

      await service.listThreads()
      const firstHeaders = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
      expect((firstHeaders?.headers as Headers).get(LOCAL_RUNTIME_TOKEN_HEADER)).toBe('service-token')

      hostedBackendService.getLocalToken = vi.fn(() => null)
      await service.listThreads()
      const secondHeaders = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined
      expect((secondHeaders?.headers as Headers).get(LOCAL_RUNTIME_TOKEN_HEADER)).toBe(HISTORY_LOCAL_TOKEN)
    })

    it('surfaces backend detail messages for failing history detail requests', async () => {
      vi.stubGlobal('fetch', vi.fn(async () =>
        createJsonFetchResponse(
          {
            detail: {
              code: 'thread_not_found',
              message: HISTORY_DETAIL_MISSING_MESSAGE,
            },
          },
          {
            ok: false,
            status: 404,
            statusText: 'Not Found',
          },
        )))

      const service = createHistoryService({
        runtimeBaseUrl: HISTORY_RUNTIME_BASE_URL,
        localToken: null,
      })

      await expect(service.getThreadDetail('missing-thread')).resolves.toEqual({
        ok: false,
        error: 'Failed to load persisted chat thread detail for "missing-thread": Thread missing.',
      })
    })
  })

  describe('mutations and database operations', () => {
    it('issues rename, duplicate, delete, and database mutation requests with the expected methods and payloads', async () => {
      const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
        if (url.endsWith('/history/threads/thread-1/rename')) {
          return createJsonFetchResponse(
            createHistoryThreadMutationResult(
              createHistoryThread({
                title: '已重命名线程',
                titleSource: 'manual',
              }),
            ),
          )
        }
        if (url.endsWith('/history/threads/thread-1/duplicate')) {
          return createJsonFetchResponse(
            createHistoryThreadMutationResult(
              createHistoryThread({
                threadId: HISTORY_THREAD_COPY_ID,
                title: HISTORY_THREAD_COPY_TITLE,
                titleSource: 'manual',
                createdAt: HISTORY_COPY_CREATED_AT,
                updatedAt: HISTORY_COPY_CREATED_AT,
                lastActivityAt: HISTORY_COPY_CREATED_AT,
                lastRunId: 'run-copy-1',
              }),
            ),
          )
        }
        if (url.endsWith('/history/threads/thread-1')) {
          return createJsonFetchResponse(createHistoryDeleteResult())
        }
        if (url.endsWith('/history/database/backup')) {
          return createJsonFetchResponse(createHistoryBackupResult())
        }
        return createJsonFetchResponse(createHistoryRestoreResult())
      })
      vi.stubGlobal('fetch', fetchMock)

      const hostedBackendService = createHostedBackendServiceStub({
        runtimeBaseUrl: HISTORY_RUNTIME_BASE_URL,
      })
      const service = createHistoryService({ hostedBackendService })

      await expect(service.renameThread(HISTORY_THREAD_ID, { title: '已重命名线程' })).resolves.toEqual({
        ok: true,
        version: HISTORY_API_VERSION,
        thread: createHistoryThread({
          title: '已重命名线程',
          titleSource: 'manual',
        }),
      })
      await expect(service.duplicateThread(HISTORY_THREAD_ID, { title: HISTORY_THREAD_COPY_TITLE })).resolves.toEqual({
        ok: true,
        version: HISTORY_API_VERSION,
        thread: createHistoryThread({
          threadId: HISTORY_THREAD_COPY_ID,
          title: HISTORY_THREAD_COPY_TITLE,
          titleSource: 'manual',
          createdAt: HISTORY_COPY_CREATED_AT,
          updatedAt: HISTORY_COPY_CREATED_AT,
          lastActivityAt: HISTORY_COPY_CREATED_AT,
          lastRunId: 'run-copy-1',
        }),
      })
      await expect(service.deleteThread(HISTORY_THREAD_ID)).resolves.toEqual(createHistoryDeleteResult())
      await expect(service.backupDatabase({ targetPath: 'backups/history.db' })).resolves.toEqual(createHistoryBackupResult())
      await expect(service.restoreDatabase({ sourcePath: 'backups/history.db' })).resolves.toEqual(createHistoryRestoreResult())

      expect(hostedBackendService.start).toHaveBeenCalledTimes(5)
      expect(fetchMock.mock.calls).toHaveLength(5)
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`${HISTORY_RUNTIME_BASE_URL}/history/threads/thread-1/rename`)
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('POST')
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toBe('{"title":"已重命名线程"}')
      expect(fetchMock.mock.calls[1]?.[0]).toBe(`${HISTORY_RUNTIME_BASE_URL}/history/threads/thread-1/duplicate`)
      expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('POST')
      expect((fetchMock.mock.calls[1]?.[1] as RequestInit).body).toBe(`{"title":"${HISTORY_THREAD_COPY_TITLE}"}`)
      expect(fetchMock.mock.calls[2]?.[0]).toBe(`${HISTORY_RUNTIME_BASE_URL}/history/threads/thread-1`)
      expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe('DELETE')
      expect(fetchMock.mock.calls[3]?.[0]).toBe(`${HISTORY_RUNTIME_BASE_URL}/history/database/backup`)
      expect((fetchMock.mock.calls[3]?.[1] as RequestInit).method).toBe('POST')
      expect((fetchMock.mock.calls[3]?.[1] as RequestInit).body).toBe('{"targetPath":"backups/history.db"}')
      expect(fetchMock.mock.calls[4]?.[0]).toBe(`${HISTORY_RUNTIME_BASE_URL}/history/database/restore`)
      expect((fetchMock.mock.calls[4]?.[1] as RequestInit).method).toBe('POST')
      expect((fetchMock.mock.calls[4]?.[1] as RequestInit).body).toBe('{"sourcePath":"backups/history.db"}')
    })
  })

  describe('runtime availability and debug logging', () => {
    it('returns a structured failure when the hosted backend runtime URL is unavailable', async () => {
      const service = createHistoryService({
        runtimeBaseUrl: null,
      })

      await expect(service.getRunReplay(HISTORY_RUN_ID)).resolves.toEqual({
        ok: false,
        error: 'Failed to load persisted chat run replay for "run-1": Hosted backend runtime URL is unavailable.',
      })
    })

    it('emits structured debug logs for successful and failing history requests only when debug mode is enabled', async () => {
      const appendLog = vi.fn(async () => undefined)
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(createJsonFetchResponse(createHistoryListThreadsResult([createHistoryThread()])))
        .mockResolvedValueOnce(createJsonFetchResponse(createHistoryListThreadsResult([createHistoryThread()])))
        .mockResolvedValueOnce(
          createJsonFetchResponse(
            {
              detail: {
                code: 'thread_not_found',
                message: HISTORY_DETAIL_MISSING_MESSAGE,
              },
            },
            {
              ok: false,
              status: 404,
              statusText: 'Not Found',
            },
          ),
        )
      vi.stubGlobal('fetch', fetchMock)

      const hostedBackendService = createHostedBackendServiceStub({
        runtimeBaseUrl: HISTORY_RUNTIME_BASE_URL,
      })
      const service = createHistoryService({
        hostedBackendService,
        appendLog,
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
            runtimeUrl: `${HISTORY_RUNTIME_BASE_URL}/history/threads`,
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
            runtimeUrl: `${HISTORY_RUNTIME_BASE_URL}/history/threads/missing-thread`,
          }),
        ],
        [
          'debug',
          '[copilot-history] request-failed',
          expect.objectContaining({
            operation: 'get-thread-detail',
            status: 404,
            failureCode: 'thread_not_found',
            failureReason: HISTORY_DETAIL_MISSING_MESSAGE,
          }),
        ],
      ])
    })
  })
})
