import type {
  CopilotHistoryBackupDatabaseRequest,
  CopilotHistoryDatabaseBackupResult,
  CopilotHistoryDatabaseRestoreResult,
  CopilotHistoryListThreadsResult,
  CopilotHistoryRestoreDatabaseRequest,
  CopilotHistoryRunReplayResult,
  CopilotHistoryThreadDeleteResult,
  CopilotHistoryThreadDetailResult,
  CopilotHistoryThreadPurgeResult,
} from './copilot-history'
import type { HostedBackendService } from './runtime/hosted-backend-service'

const LOCAL_RUNTIME_TOKEN_HEADER = 'X-Local-Token'

export interface CreateElectronCopilotHistoryServiceOptions {
  ensureHostedBackendService: () => Promise<HostedBackendService>
  getLocalToken: () => string | null
}

export interface ElectronCopilotHistoryService {
  listThreads: () => Promise<CopilotHistoryListThreadsResult>
  getThreadDetail: (threadId: string) => Promise<CopilotHistoryThreadDetailResult>
  getRunReplay: (runId: string) => Promise<CopilotHistoryRunReplayResult>
  deleteThread: (threadId: string) => Promise<CopilotHistoryThreadDeleteResult>
  purgeThread: (threadId: string) => Promise<CopilotHistoryThreadPurgeResult>
  backupDatabase: (request?: CopilotHistoryBackupDatabaseRequest) => Promise<CopilotHistoryDatabaseBackupResult>
  restoreDatabase: (request: CopilotHistoryRestoreDatabaseRequest) => Promise<CopilotHistoryDatabaseRestoreResult>
}

export function createElectronCopilotHistoryService(
  options: CreateElectronCopilotHistoryServiceOptions,
): ElectronCopilotHistoryService {
  return {
    async listThreads() {
      return await requestHistory<CopilotHistoryListThreadsResult>({
        options,
        path: '/history/threads',
        failureLabel: 'Failed to load persisted chat thread list',
      })
    },
    async getThreadDetail(threadId) {
      return await requestHistory<CopilotHistoryThreadDetailResult>({
        options,
        path: `/history/threads/${encodeURIComponent(threadId)}`,
        failureLabel: `Failed to load persisted chat thread detail for "${threadId}"`,
      })
    },
    async getRunReplay(runId) {
      return await requestHistory<CopilotHistoryRunReplayResult>({
        options,
        path: `/history/runs/${encodeURIComponent(runId)}/replay`,
        failureLabel: `Failed to load persisted chat run replay for "${runId}"`,
      })
    },
    async deleteThread(threadId) {
      return await requestHistory<CopilotHistoryThreadDeleteResult>({
        options,
        path: `/history/threads/${encodeURIComponent(threadId)}`,
        method: 'DELETE',
        failureLabel: `Failed to delete persisted chat thread "${threadId}"`,
      })
    },
    async purgeThread(threadId) {
      return await requestHistory<CopilotHistoryThreadPurgeResult>({
        options,
        path: `/history/threads/${encodeURIComponent(threadId)}/purge`,
        method: 'DELETE',
        failureLabel: `Failed to purge persisted chat thread "${threadId}"`,
      })
    },
    async backupDatabase(request) {
      return await requestHistory<CopilotHistoryDatabaseBackupResult>({
        options,
        path: '/history/database/backup',
        method: 'POST',
        body: request,
        failureLabel: 'Failed to back up persisted chat database',
      })
    },
    async restoreDatabase(request) {
      return await requestHistory<CopilotHistoryDatabaseRestoreResult>({
        options,
        path: '/history/database/restore',
        method: 'POST',
        body: request,
        failureLabel: `Failed to restore persisted chat database from "${request.sourcePath}"`,
      })
    },
  }
}

async function requestHistory<TResult extends { ok: boolean } | { ok: false; error: string }>(input: {
  options: CreateElectronCopilotHistoryServiceOptions
  path: string
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  failureLabel: string
}): Promise<TResult> {
  try {
    const service = await input.options.ensureHostedBackendService()
    await service.start()

    const runtimeBaseUrl = service.getRuntimeBaseUrl()
    if (runtimeBaseUrl === null || runtimeBaseUrl.trim() === '') {
      throw new Error('Hosted backend runtime URL is unavailable.')
    }

    const runtimeUrl = new URL(input.path, normalizeRuntimeBaseUrl(runtimeBaseUrl)).toString()
    const token = normalizeOptionalString(input.options.getLocalToken())
    const headers = new Headers()
    if (token !== null) {
      headers.set(LOCAL_RUNTIME_TOKEN_HEADER, token)
    }
    const method = input.method ?? 'GET'
    const body = input.body === undefined ? undefined : JSON.stringify(input.body)
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(runtimeUrl, {
      method,
      headers,
      body,
    })
    const responseText = await response.text()
    const payload = parseJsonResponse(responseText)

    if (!response.ok) {
      return buildFailureResult<TResult>(
        `${input.failureLabel}: ${extractFailureMessage(payload, response.status, response.statusText)}`,
      )
    }

    if (!isPlainRecord(payload) || payload.ok !== true) {
      return buildFailureResult<TResult>(`${input.failureLabel}: backend returned an invalid response payload.`)
    }

    return payload as TResult
  } catch (error) {
    return buildFailureResult<TResult>(`${input.failureLabel}: ${formatUnknownError(error)}`)
  }
}

function normalizeRuntimeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function parseJsonResponse(text: string): unknown | null {
  const normalized = text.trim()
  if (normalized === '') {
    return null
  }

  try {
    return JSON.parse(normalized) as unknown
  } catch {
    return null
  }
}

function extractFailureMessage(payload: unknown, status: number, statusText: string): string {
  if (isPlainRecord(payload)) {
    const detail = payload.detail
    if (isPlainRecord(detail)) {
      const message = normalizeOptionalString(detail.message)
      if (message !== null) {
        return message
      }
    }
    const error = normalizeOptionalString(payload.error)
    if (error !== null) {
      return error
    }
  }

  const normalizedStatusText = normalizeOptionalString(statusText)
  return normalizedStatusText === null ? `HTTP ${status}` : `HTTP ${status} ${normalizedStatusText}`
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildFailureResult<TResult>(error: string): TResult {
  return {
    ok: false,
    error,
  } as TResult
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
