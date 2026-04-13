import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CopilotHistoryApi,
  CopilotHistoryListThreadsResult,
  CopilotHistoryRunReplayResult,
  CopilotHistoryThreadDetailResult,
} from '../../../electron/copilot-history'
import {
  getCopilotHistoryRunReplay,
  getCopilotHistoryThreadDetail,
  HISTORY_API_UNAVAILABLE_ERROR,
  listCopilotHistoryThreads,
} from './history'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('copilot history bridge', () => {
  it('returns a structured failure when window is unavailable', async () => {
    vi.stubGlobal('window', undefined)

    await expect(listCopilotHistoryThreads()).resolves.toEqual({
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    })
    await expect(getCopilotHistoryThreadDetail('thread-1')).resolves.toEqual({
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    })
    await expect(getCopilotHistoryRunReplay('run-1')).resolves.toEqual({
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    })
  })

  it('delegates to the injected preload api when available', async () => {
    const listResult: CopilotHistoryListThreadsResult = {
      ok: true,
      version: 'chat-history-v1',
      threads: [],
    }
    const detailResult: CopilotHistoryThreadDetailResult = {
      ok: true,
      version: 'chat-history-v1',
      thread: {
        threadId: 'thread-1',
        boundAgentId: 'general',
        title: '历史线程',
        titleSource: 'deterministic',
        summary: '历史摘要',
        summarySource: 'deterministic',
        createdAt: '2026-04-13T15:00:00Z',
        updatedAt: '2026-04-13T15:05:00Z',
        lastActivityAt: '2026-04-13T15:05:00Z',
        lastRunId: 'run-1',
        lastRunStatus: 'completed',
        lastUserMessagePreview: '你好',
        lastAssistantMessagePreview: '历史摘要',
        driftSummary: {
          status: 'not_evaluated',
        },
      },
      timelineItems: [],
      runSummaries: [],
      latestConfigurationSnapshot: null,
      availabilityDrift: null,
    }
    const replayResult: CopilotHistoryRunReplayResult = {
      ok: true,
      version: 'chat-history-v1',
      run: {
        runId: 'run-1',
        threadId: 'thread-1',
        status: 'completed',
        createdAt: '2026-04-13T15:00:00Z',
        updatedAt: '2026-04-13T15:05:00Z',
        startedAt: '2026-04-13T15:00:01Z',
        terminalAt: '2026-04-13T15:05:00Z',
        resolvedModelId: 'openai/gpt-4.1',
        requestedMessageText: '你好',
        assistantText: '历史摘要',
      },
      historicalSnapshot: null,
      orderedEvents: [],
      toolCallBlocks: [],
      diagnosticBlocks: [],
      terminalState: null,
      availabilityInterpretation: null,
    }
    const api: CopilotHistoryApi = {
      listThreads: vi.fn().mockResolvedValue(listResult),
      getThreadDetail: vi.fn().mockResolvedValue(detailResult),
      getRunReplay: vi.fn().mockResolvedValue(replayResult),
    }

    vi.stubGlobal('window', {
      copilotHistory: api,
    } satisfies Pick<Window, 'copilotHistory'>)

    await expect(listCopilotHistoryThreads()).resolves.toEqual(listResult)
    await expect(getCopilotHistoryThreadDetail('thread-1')).resolves.toEqual(detailResult)
    await expect(getCopilotHistoryRunReplay('run-1')).resolves.toEqual(replayResult)
    expect(api.listThreads).toHaveBeenCalledOnce()
    expect(api.getThreadDetail).toHaveBeenCalledWith('thread-1')
    expect(api.getRunReplay).toHaveBeenCalledWith('run-1')
  })
})
