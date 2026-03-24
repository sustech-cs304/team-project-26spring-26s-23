import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CopilotRuntimeApi, CopilotRuntimeLoadResult, CopilotRuntimeRetryResult } from '../../../electron/copilot-runtime'
import { loadCopilotRuntime, retryCopilotRuntime } from './runtime'

const runtimeUnavailableError = 'window.copilotRuntime is unavailable in the renderer process.'
const globalWindow = globalThis as typeof globalThis & { window?: Window }
const originalWindow = globalWindow.window

function restoreWindow() {
  if (originalWindow === undefined) {
    delete globalWindow.window
    return
  }

  globalWindow.window = originalWindow
}

afterEach(() => {
  restoreWindow()
})

describe('copilot runtime bridge', () => {
  it('returns a structured failure when window is unavailable', async () => {
    delete globalWindow.window

    await expect(loadCopilotRuntime()).resolves.toEqual({
      ok: false,
      error: runtimeUnavailableError,
    })
    await expect(retryCopilotRuntime()).resolves.toEqual({
      ok: false,
      error: runtimeUnavailableError,
    })
  })

  it('delegates to the injected preload api when available', async () => {
    const loadResult: CopilotRuntimeLoadResult = {
      ok: true,
      snapshot: {
        hosted: {
          status: 'ready',
          expectedMode: 'development',
          resolvedMode: 'development',
          runtimeUrl: 'http://127.0.0.1:8765',
          isPackaged: false,
          failure: null,
        },
      },
    }
    const retryResult: CopilotRuntimeRetryResult = {
      ok: false,
      error: 'retry failed',
    }
    const api: CopilotRuntimeApi = {
      load: vi.fn().mockResolvedValue(loadResult),
      retry: vi.fn().mockResolvedValue(retryResult),
    }

    globalWindow.window = {
      copilotRuntime: api,
    } as Window

    await expect(loadCopilotRuntime()).resolves.toEqual(loadResult)
    await expect(retryCopilotRuntime()).resolves.toEqual(retryResult)
    expect(api.load).toHaveBeenCalledOnce()
    expect(api.retry).toHaveBeenCalledOnce()
  })
})
