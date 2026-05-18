import { describe, expect, it } from 'vitest'

import type {
  CopilotHistoryApi,
} from './copilot-history'
import {
  COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL,
  COPILOT_HISTORY_DELETE_THREAD_CHANNEL,
  COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL,
  COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL,
  COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL,
  COPILOT_HISTORY_LIST_THREADS_CHANNEL,
  COPILOT_HISTORY_RENAME_THREAD_CHANNEL,
  COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL,
} from './copilot-history'
import { getExposedApi, getInvokeMock, loadPreloadModule } from './preload.test-support'

const THREAD_1 = 'thread-1'
const RUN_1 = 'run-1'
const RENAMED_TITLE = '已重命名线程'
const DUPLICATE_TITLE = '历史线程（副本）'
const BACKUP_PATH = 'backups/history.db'

describe('preload history bridge', () => {
  it('routes history bridge APIs through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const historyApi = getExposedApi<CopilotHistoryApi>('copilotHistory')

    await historyApi.listThreads()
    await historyApi.getThreadDetail(THREAD_1)
    await historyApi.getRunReplay(RUN_1)
    await historyApi.renameThread(THREAD_1, { title: RENAMED_TITLE })
    await historyApi.duplicateThread(THREAD_1, { title: DUPLICATE_TITLE })
    await historyApi.deleteThread(THREAD_1)
    await historyApi.backupDatabase({ targetPath: BACKUP_PATH })
    await historyApi.restoreDatabase({ sourcePath: BACKUP_PATH })

    expect(invokeMock.mock.calls).toEqual([
      [COPILOT_HISTORY_LIST_THREADS_CHANNEL],
      [COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL, THREAD_1],
      [COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL, RUN_1],
      [COPILOT_HISTORY_RENAME_THREAD_CHANNEL, THREAD_1, { title: RENAMED_TITLE }],
      [COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL, THREAD_1, { title: DUPLICATE_TITLE }],
      [COPILOT_HISTORY_DELETE_THREAD_CHANNEL, THREAD_1],
      [COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL, { targetPath: BACKUP_PATH }],
      [COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL, { sourcePath: BACKUP_PATH }],
    ])
  })
})
