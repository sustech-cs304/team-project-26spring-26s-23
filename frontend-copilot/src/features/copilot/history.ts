import type {
  CopilotHistoryApi,
  CopilotHistoryBackupDatabaseRequest,
  CopilotHistoryDatabaseBackupResult,
  CopilotHistoryDatabaseRestoreResult,
  CopilotHistoryListThreadsResult,
  CopilotHistoryRestoreDatabaseRequest,
  CopilotHistoryRunReplayResult,
  CopilotHistoryThreadDeleteResult,
  CopilotHistoryThreadDetailResult,
  CopilotHistoryThreadPurgeResult,
} from '../../../electron/copilot-history'

const HISTORY_API_UNAVAILABLE_ERROR = 'window.copilotHistory is unavailable in the renderer process.'

function getCopilotHistoryApi(): CopilotHistoryApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.copilotHistory
}

export async function listCopilotHistoryThreads(): Promise<CopilotHistoryListThreadsResult> {
  const api = getCopilotHistoryApi()

  if (!api) {
    return {
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    }
  }

  return api.listThreads()
}

export async function getCopilotHistoryThreadDetail(
  threadId: string,
): Promise<CopilotHistoryThreadDetailResult> {
  const api = getCopilotHistoryApi()

  if (!api) {
    return {
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    }
  }

  return api.getThreadDetail(threadId)
}

export async function getCopilotHistoryRunReplay(
  runId: string,
): Promise<CopilotHistoryRunReplayResult> {
  const api = getCopilotHistoryApi()

  if (!api) {
    return {
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    }
  }

  return api.getRunReplay(runId)
}

export async function deleteCopilotHistoryThread(
  threadId: string,
): Promise<CopilotHistoryThreadDeleteResult> {
  const api = getCopilotHistoryApi()

  if (!api) {
    return {
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    }
  }

  return api.deleteThread(threadId)
}

export async function purgeCopilotHistoryThread(
  threadId: string,
): Promise<CopilotHistoryThreadPurgeResult> {
  const api = getCopilotHistoryApi()

  if (!api) {
    return {
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    }
  }

  return api.purgeThread(threadId)
}

export async function backupCopilotHistoryDatabase(
  request?: CopilotHistoryBackupDatabaseRequest,
): Promise<CopilotHistoryDatabaseBackupResult> {
  const api = getCopilotHistoryApi()

  if (!api) {
    return {
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    }
  }

  return api.backupDatabase(request)
}

export async function restoreCopilotHistoryDatabase(
  request: CopilotHistoryRestoreDatabaseRequest,
): Promise<CopilotHistoryDatabaseRestoreResult> {
  const api = getCopilotHistoryApi()

  if (!api) {
    return {
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    }
  }

  return api.restoreDatabase(request)
}

export { HISTORY_API_UNAVAILABLE_ERROR }
