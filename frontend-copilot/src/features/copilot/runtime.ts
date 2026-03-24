import type {
  CopilotRendererRuntimeLoadResult,
  CopilotRendererRuntimeRetryResult,
} from './types'

function getCopilotRuntimeApi() {
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
