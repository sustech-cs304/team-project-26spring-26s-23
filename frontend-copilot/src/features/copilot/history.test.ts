import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CopilotHistoryApi,
  CopilotHistoryDatabaseBackupResult,
  CopilotHistoryDatabaseRestoreResult,
  CopilotHistoryListThreadsResult,
  CopilotHistoryRunReplayResult,
  CopilotHistoryThreadDeleteResult,
  CopilotHistoryThreadDetailResult,
  CopilotHistoryThreadDuplicateResult,
  CopilotHistoryThreadRenameResult,
} from '../../../electron/copilot-history'
import {
  backupCopilotHistoryDatabase,
  deleteCopilotHistoryThread,
  duplicateCopilotHistoryThread,
  getCopilotHistoryRunReplay,
  getCopilotHistoryThreadDetail,
  HISTORY_API_UNAVAILABLE_ERROR,
  listCopilotHistoryThreads,
  renameCopilotHistoryThread,
  restoreCopilotHistoryDatabase,
} from './history'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const LABEL_2026_13T15 = '2026-04-13T15:05:00Z'
const LABEL_BACKUPS_HISTORY = 'backups/history.db'
const SELECTOR_CHAT_HISTORY = 'chat-history-v1'


afterEach(() => {
  vi.unstubAllGlobals()
})

/* eslint-disable-next-line max-lines-per-function -- 测试桥接器需要集中覆盖所有 API 函数，拆分削弱端到端可读性 */
describe('copilot history bridge', () => {
  describe('unavailable api', () => {
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
    await expect(renameCopilotHistoryThread('thread-1', { title: '已重命名线程' })).resolves.toEqual({
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    })
    await expect(duplicateCopilotHistoryThread('thread-1', { title: '历史线程（副本）' })).resolves.toEqual({
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    })
    await expect(deleteCopilotHistoryThread('thread-1')).resolves.toEqual({
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    })
    await expect(backupCopilotHistoryDatabase({ targetPath: LABEL_BACKUPS_HISTORY })).resolves.toEqual({
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    })
    await expect(restoreCopilotHistoryDatabase({ sourcePath: LABEL_BACKUPS_HISTORY })).resolves.toEqual({
      ok: false,
      error: HISTORY_API_UNAVAILABLE_ERROR,
    })
    })
  })

  /* eslint-disable-next-line max-lines-per-function -- fixture 构造和断言验证集中于此，拆分不改变语义完整性 */
  describe('delegation to preload api', () => {
    /* eslint-disable-next-line max-lines-per-function -- 全部 API 调用和验证内聚于单测，强行拆分破坏行为原子性 */
    it('delegates to the injected preload api when available', async () => {
    const listResult: CopilotHistoryListThreadsResult = {
      ok: true,
      version: SELECTOR_CHAT_HISTORY,
      threads: [],
    }
    const detailResult: CopilotHistoryThreadDetailResult = {
      ok: true,
      version: SELECTOR_CHAT_HISTORY,
      thread: {
        threadId: 'thread-1',
        boundAgentId: 'general',
        title: '历史线程',
        titleSource: 'deterministic',
        summary: '历史摘要',
        summarySource: 'deterministic',
        createdAt: '2026-04-13T15:00:00Z',
        updatedAt: LABEL_2026_13T15,
        lastActivityAt: LABEL_2026_13T15,
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
      version: SELECTOR_CHAT_HISTORY,
      run: {
        runId: 'run-1',
        threadId: 'thread-1',
        status: 'completed',
        createdAt: '2026-04-13T15:00:00Z',
        updatedAt: LABEL_2026_13T15,
        startedAt: '2026-04-13T15:00:01Z',
        terminalAt: LABEL_2026_13T15,
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
    const renameResult: CopilotHistoryThreadRenameResult = {
      ok: true,
      version: SELECTOR_CHAT_HISTORY,
      thread: {
        ...detailResult.thread,
        title: '已重命名线程',
        titleSource: 'manual',
        updatedAt: '2026-04-13T15:06:00Z',
      },
    }
    const duplicateResult: CopilotHistoryThreadDuplicateResult = {
      ok: true,
      version: SELECTOR_CHAT_HISTORY,
      thread: {
        ...detailResult.thread,
        threadId: 'thread-copy-1',
        title: '历史线程（副本）',
        titleSource: 'manual',
        createdAt: '2026-04-13T15:06:30Z',
        updatedAt: '2026-04-13T15:06:30Z',
        lastActivityAt: '2026-04-13T15:06:30Z',
        lastRunId: 'run-copy-1',
      },
    }
    const deleteResult: CopilotHistoryThreadDeleteResult = {
      ok: true,
      version: SELECTOR_CHAT_HISTORY,
      threadId: 'thread-1',
      deletedAt: '2026-04-13T15:06:00Z',
    }
    const backupResult: CopilotHistoryDatabaseBackupResult = {
      ok: true,
      version: SELECTOR_CHAT_HISTORY,
      databasePath: 'D:/workspace/copilot-data/database/copilot-chat.db',
      backupPath: 'D:/workspace/copilot-data/backups/copilot-chat.backup.db',
      createdAt: '2026-04-13T15:08:00Z',
    }
    const restoreResult: CopilotHistoryDatabaseRestoreResult = {
      ok: true,
      version: SELECTOR_CHAT_HISTORY,
      databasePath: 'D:/workspace/copilot-data/database/copilot-chat.db',
      sourcePath: 'D:/workspace/copilot-data/backups/copilot-chat.backup.db',
      restoredAt: '2026-04-13T15:09:00Z',
    }
    const api: CopilotHistoryApi = {
      listThreads: vi.fn().mockResolvedValue(listResult),
      getThreadDetail: vi.fn().mockResolvedValue(detailResult),
      getRunReplay: vi.fn().mockResolvedValue(replayResult),
      renameThread: vi.fn().mockResolvedValue(renameResult),
      duplicateThread: vi.fn().mockResolvedValue(duplicateResult),
      deleteThread: vi.fn().mockResolvedValue(deleteResult),
      backupDatabase: vi.fn().mockResolvedValue(backupResult),
      restoreDatabase: vi.fn().mockResolvedValue(restoreResult),
    }

    vi.stubGlobal('window', {
      copilotHistory: api,
    } satisfies Pick<Window, 'copilotHistory'>)

    await expect(listCopilotHistoryThreads()).resolves.toEqual(listResult)
    await expect(getCopilotHistoryThreadDetail('thread-1')).resolves.toEqual(detailResult)
    await expect(getCopilotHistoryRunReplay('run-1')).resolves.toEqual(replayResult)
    await expect(renameCopilotHistoryThread('thread-1', { title: '已重命名线程' })).resolves.toEqual(renameResult)
    await expect(duplicateCopilotHistoryThread('thread-1', { title: '历史线程（副本）' })).resolves.toEqual(duplicateResult)
    await expect(deleteCopilotHistoryThread('thread-1')).resolves.toEqual(deleteResult)
    await expect(backupCopilotHistoryDatabase({ targetPath: LABEL_BACKUPS_HISTORY })).resolves.toEqual(backupResult)
    await expect(restoreCopilotHistoryDatabase({ sourcePath: LABEL_BACKUPS_HISTORY })).resolves.toEqual(restoreResult)
    expect(api.listThreads).toHaveBeenCalledOnce()
    expect(api.getThreadDetail).toHaveBeenCalledWith('thread-1')
    expect(api.getRunReplay).toHaveBeenCalledWith('run-1')
    expect(api.renameThread).toHaveBeenCalledWith('thread-1', { title: '已重命名线程' })
    expect(api.duplicateThread).toHaveBeenCalledWith('thread-1', { title: '历史线程（副本）' })
    expect(api.deleteThread).toHaveBeenCalledWith('thread-1')
    expect(api.backupDatabase).toHaveBeenCalledWith({ targetPath: LABEL_BACKUPS_HISTORY })
    expect(api.restoreDatabase).toHaveBeenCalledWith({ sourcePath: LABEL_BACKUPS_HISTORY })
    })
  })
})
