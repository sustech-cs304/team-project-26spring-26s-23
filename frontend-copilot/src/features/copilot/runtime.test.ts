import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CopilotRuntimeApi,
  CopilotRuntimeLoadResult,
  CopilotRuntimeRetryResult,
} from '../../../electron/copilot-runtime'
import { loadCopilotRuntime, loadCopilotRuntimeLocalToken, retryCopilotRuntime } from './runtime'

const runtimeUnavailableError = 'window.copilotRuntime is unavailable in the renderer process.'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('copilot runtime bridge', () => {
  it('returns a structured failure when window is unavailable', async () => {
    vi.stubGlobal('window', undefined)

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
      getLocalToken: vi.fn().mockResolvedValue('runtime-token'),
    }

    vi.stubGlobal('window', {
      copilotRuntime: api,
    } satisfies Pick<Window, 'copilotRuntime'>)

    await expect(loadCopilotRuntime()).resolves.toEqual(loadResult)
    await expect(retryCopilotRuntime()).resolves.toEqual(retryResult)
    await expect(loadCopilotRuntimeLocalToken()).resolves.toBe('runtime-token')
    expect(api.load).toHaveBeenCalledOnce()
    expect(api.retry).toHaveBeenCalledOnce()
  })
})
