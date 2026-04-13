import type {
  CopilotHistoryApi,
  CopilotHistoryListThreadsResult,
  CopilotHistoryRunReplayResult,
  CopilotHistoryThreadDetailResult,
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

export { HISTORY_API_UNAVAILABLE_ERROR }
