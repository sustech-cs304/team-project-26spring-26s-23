import type {
  CopilotHistoryBackupDatabaseRequest,
  CopilotHistoryDatabaseBackupResult,
  CopilotHistoryDatabaseRestoreResult,
  CopilotHistoryDuplicateThreadRequest,
  CopilotHistoryListThreadsResult,
  CopilotHistoryRenameThreadRequest,
  CopilotHistoryRestoreDatabaseRequest,
  CopilotHistoryRunReplayResult,
  CopilotHistoryThreadDeleteResult,
  CopilotHistoryThreadDetailResult,
  CopilotHistoryThreadDuplicateResult,
  CopilotHistoryThreadRenameResult,
} from './copilot-history'
import type { HostedBackendService } from './runtime/hosted-backend-service'

const LOCAL_RUNTIME_TOKEN_HEADER = 'X-Local-Token'

type ElectronCopilotHistoryLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface CreateElectronCopilotHistoryServiceOptions {
  ensureHostedBackendService: () => Promise<HostedBackendService>
  getLocalToken: () => string | null
  appendLog?: (
    level: ElectronCopilotHistoryLogLevel,
    message: string,
    context: Record<string, unknown> | null,
  ) => Promise<void> | void
  getDebugModeEnabled?: () => Promise<boolean> | boolean
}

export interface ElectronCopilotHistoryService {
  listThreads: () => Promise<CopilotHistoryListThreadsResult>
  getThreadDetail: (threadId: string) => Promise<CopilotHistoryThreadDetailResult>
  getRunReplay: (runId: string) => Promise<CopilotHistoryRunReplayResult>
  renameThread: (
    threadId: string,
    request: CopilotHistoryRenameThreadRequest,
  ) => Promise<CopilotHistoryThreadRenameResult>
  duplicateThread: (
    threadId: string,
    request?: CopilotHistoryDuplicateThreadRequest,
  ) => Promise<CopilotHistoryThreadDuplicateResult>
  deleteThread: (threadId: string) => Promise<CopilotHistoryThreadDeleteResult>
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
        operation: 'list-threads',
        path: '/history/threads',
        failureLabel: 'Failed to load persisted chat thread list',
      })
    },
    async getThreadDetail(threadId) {
      return await requestHistory<CopilotHistoryThreadDetailResult>({
        options,
        operation: 'get-thread-detail',
        path: `/history/threads/${encodeURIComponent(threadId)}`,
        failureLabel: `Failed to load persisted chat thread detail for "${threadId}"`,
      })
    },
    async getRunReplay(runId) {
      return await requestHistory<CopilotHistoryRunReplayResult>({
        options,
        operation: 'get-run-replay',
        path: `/history/runs/${encodeURIComponent(runId)}/replay`,
        failureLabel: `Failed to load persisted chat run replay for "${runId}"`,
      })
    },
    async renameThread(threadId, request) {
      return await requestHistory<CopilotHistoryThreadRenameResult>({
        options,
        operation: 'rename-thread',
        path: `/history/threads/${encodeURIComponent(threadId)}/rename`,
        method: 'POST',
        body: request,
        failureLabel: `Failed to rename persisted chat thread "${threadId}"`,
      })
    },
    async duplicateThread(threadId, request) {
      return await requestHistory<CopilotHistoryThreadDuplicateResult>({
        options,
        operation: 'duplicate-thread',
        path: `/history/threads/${encodeURIComponent(threadId)}/duplicate`,
        method: 'POST',
        body: request,
        failureLabel: `Failed to duplicate persisted chat thread "${threadId}"`,
      })
    },
    async deleteThread(threadId) {
      return await requestHistory<CopilotHistoryThreadDeleteResult>({
        options,
        operation: 'delete-thread',
        path: `/history/threads/${encodeURIComponent(threadId)}`,
        method: 'DELETE',
        failureLabel: `Failed to delete persisted chat thread "${threadId}"`,
      })
    },
    async backupDatabase(request) {
      return await requestHistory<CopilotHistoryDatabaseBackupResult>({
        options,
        operation: 'backup-database',
        path: '/history/database/backup',
        method: 'POST',
        body: request,
        failureLabel: 'Failed to back up persisted chat database',
      })
    },
    async restoreDatabase(request) {
      return await requestHistory<CopilotHistoryDatabaseRestoreResult>({
        options,
        operation: 'restore-database',
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
  operation: string
  path: string
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  failureLabel: string
}): Promise<TResult> {
  const method = input.method ?? 'GET'
  const body = input.body === undefined ? undefined : JSON.stringify(input.body)
  const debugLoggingEnabled = await resolveHistoryDebugModeEnabled(input.options)
  const requestContext = {
    operation: input.operation,
    path: input.path,
    method,
    hasBody: body !== undefined,
  }

  try {
    const service = await input.options.ensureHostedBackendService()
    await service.start()

    const runtimeBaseUrl = service.getRuntimeBaseUrl()
    if (runtimeBaseUrl === null || runtimeBaseUrl.trim() === '') {
      throw new Error('Hosted backend runtime URL is unavailable.')
    }

    const runtimeUrl = new URL(input.path, normalizeRuntimeBaseUrl(runtimeBaseUrl)).toString()
    const token = normalizeOptionalString(service.getLocalToken())
      ?? normalizeOptionalString(input.options.getLocalToken())
    const headers = new Headers()
    if (token !== null) {
      headers.set(LOCAL_RUNTIME_TOKEN_HEADER, token)
    }
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }

    await appendHistoryDebugLog(input.options, debugLoggingEnabled, 'request-started', {
      ...requestContext,
      runtimeUrl,
      hasLocalToken: token !== null,
    })

    const response = await fetch(runtimeUrl, {
      method,
      headers,
      body,
    })
    const responseText = await response.text()
    const payload = parseJsonResponse(responseText)

    if (!response.ok) {
      const failure = extractFailureDetail(payload, response.status, response.statusText)
      await appendHistoryDebugLog(input.options, debugLoggingEnabled, 'request-failed', {
        ...requestContext,
        runtimeUrl,
        status: response.status,
        statusText: normalizeOptionalString(response.statusText),
        failureCode: failure.code,
        failureReason: failure.message,
      })
      return buildFailureResult<TResult>(`${input.failureLabel}: ${failure.message}`)
    }

    if (!isPlainRecord(payload) || payload.ok !== true) {
      await appendHistoryDebugLog(input.options, debugLoggingEnabled, 'request-failed', {
        ...requestContext,
        runtimeUrl,
        status: response.status,
        statusText: normalizeOptionalString(response.statusText),
        failureCode: 'invalid_payload',
        failureReason: 'backend returned an invalid response payload.',
      })
      return buildFailureResult<TResult>(`${input.failureLabel}: backend returned an invalid response payload.`)
    }

    await appendHistoryDebugLog(input.options, debugLoggingEnabled, 'request-succeeded', {
      ...requestContext,
      runtimeUrl,
      status: response.status,
      ...summarizeHistorySuccessPayload(input.operation, payload),
    })

    return payload as TResult
  } catch (error) {
    await appendHistoryDebugLog(input.options, debugLoggingEnabled, 'request-failed', {
      ...requestContext,
      failureCode: 'exception',
      failureReason: formatUnknownError(error),
    })
    return buildFailureResult<TResult>(`${input.failureLabel}: ${formatUnknownError(error)}`)
  }
}

async function resolveHistoryDebugModeEnabled(
  options: CreateElectronCopilotHistoryServiceOptions,
): Promise<boolean> {
  if (options.getDebugModeEnabled === undefined) {
    return false
  }

  try {
    return await options.getDebugModeEnabled() === true
  } catch {
    return false
  }
}

async function appendHistoryDebugLog(
  options: CreateElectronCopilotHistoryServiceOptions,
  debugLoggingEnabled: boolean,
  event: string,
  context: Record<string, unknown>,
): Promise<void> {
  if (!debugLoggingEnabled || options.appendLog === undefined) {
    return
  }

  try {
    await options.appendLog('debug', `[copilot-history] ${event}`, context)
  } catch {
    // Debug-only logging must never break history requests.
  }
}

// eslint-disable-next-line sonarjs/cognitive-complexity
function summarizeHistorySuccessPayload(
  operation: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  switch (operation) {
    case 'list-threads':
      return {
        threadCount: Array.isArray(payload.threads) ? payload.threads.length : null,
      }
    case 'get-thread-detail':
      return {
        threadId: readOptionalString(isPlainRecord(payload.thread) ? payload.thread.threadId : null),
        runCount: Array.isArray(payload.runSummaries) ? payload.runSummaries.length : null,
        timelineItemCount: Array.isArray(payload.timelineItems) ? payload.timelineItems.length : null,
      }
    case 'get-run-replay':
      return {
        runId: readOptionalString(isPlainRecord(payload.run) ? payload.run.runId : null),
        orderedEventCount: Array.isArray(payload.orderedEvents) ? payload.orderedEvents.length : null,
        toolCallBlockCount: Array.isArray(payload.toolCallBlocks) ? payload.toolCallBlocks.length : null,
        diagnosticBlockCount: Array.isArray(payload.diagnosticBlocks) ? payload.diagnosticBlocks.length : null,
      }
    case 'rename-thread':
    case 'duplicate-thread':
      return {
        threadId: readOptionalString(isPlainRecord(payload.thread) ? payload.thread.threadId : null),
      }
    default:
      return {}
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

function readOptionalString(value: unknown): string | null {
  return normalizeOptionalString(value)
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

function extractFailureDetail(
  payload: unknown,
  status: number,
  statusText: string,
): { code: string | null; message: string } {
  if (isPlainRecord(payload)) {
    const detail = payload.detail
    if (isPlainRecord(detail)) {
      const message = normalizeOptionalString(detail.message)
      if (message !== null) {
        return {
          code: normalizeOptionalString(detail.code),
          message,
        }
      }
    }

    const error = normalizeOptionalString(payload.error)
    if (error !== null) {
      return {
        code: normalizeOptionalString(payload.code),
        message: error,
      }
    }
  }

  const normalizedStatusText = normalizeOptionalString(statusText)
  return {
    code: `http_${status}`,
    message: normalizedStatusText === null ? `HTTP ${status}` : `HTTP ${status} ${normalizedStatusText}`,
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
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
