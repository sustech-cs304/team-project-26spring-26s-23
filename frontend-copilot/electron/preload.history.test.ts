import { describe, expect, it, vi } from 'vitest'

import type {
  CopilotHistoryApi,
} from './copilot-history'
import {
  COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL,
  COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL,
  COPILOT_HISTORY_LIST_THREADS_CHANNEL,
} from './copilot-history'
import { getExposedApi, getInvokeMock, loadPreloadModule } from './preload.test-support'

describe('preload history bridge', () => {
  it('routes history bridge APIs through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const historyApi = getExposedApi<CopilotHistoryApi>('copilotHistory')

    await historyApi.listThreads()
    await historyApi.getThreadDetail('thread-1')
    await historyApi.getRunReplay('run-1')

    expect(invokeMock.mock.calls).toEqual([
      [COPILOT_HISTORY_LIST_THREADS_CHANNEL],
      [COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL, 'thread-1'],
      [COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL, 'run-1'],
    ])
  })
})
