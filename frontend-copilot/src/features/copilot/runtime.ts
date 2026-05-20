import type {
  CopilotRendererRuntimeLoadResult,
  CopilotRendererRuntimeRetryResult,
} from './types'

function getCopilotRuntimeApi() {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.copilotRuntime
}

export async function loadCopilotRuntime(): Promise<CopilotRendererRuntimeLoadResult> {
  const api = getCopilotRuntimeApi()

  if (!api) {
    return {
      ok: false,
      error: 'window.copilotRuntime is unavailable in the renderer process.',
    }
  }

  return api.load()
}

export async function retryCopilotRuntime(): Promise<CopilotRendererRuntimeRetryResult> {
  const api = getCopilotRuntimeApi()

  if (!api) {
    return {
      ok: false,
      error: 'window.copilotRuntime is unavailable in the renderer process.',
    }
  }

  return api.retry()
}

export async function loadCopilotRuntimeLocalToken(): Promise<string | null> {
  const api = getCopilotRuntimeApi()
  if (!api) {
    return null
  }

  return await api.getLocalToken()
}
