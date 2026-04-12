import { describe, expect, it } from 'vitest'

import { COPILOT_RUNTIME_LOAD_CHANNEL, COPILOT_RUNTIME_RETRY_CHANNEL, type CopilotRuntimeApi } from './copilot-runtime'
import { getExposedApi, getInvokeMock, loadPreloadModule } from './preload.test-support'

describe('preload runtime bridge', () => {
  it('routes runtime bridge APIs through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const runtimeApi = getExposedApi<CopilotRuntimeApi>('copilotRuntime')

    await runtimeApi.load()
    await runtimeApi.retry()

    expect(invokeMock.mock.calls).toEqual([
      [COPILOT_RUNTIME_LOAD_CHANNEL],
      [COPILOT_RUNTIME_RETRY_CHANNEL],
    ])
  })
})
