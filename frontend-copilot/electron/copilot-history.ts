export const COPILOT_HISTORY_LIST_THREADS_CHANNEL = 'copilot-history:list-threads'
export const COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL = 'copilot-history:get-thread-detail'
export const COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL = 'copilot-history:get-run-replay'
export const COPILOT_HISTORY_DELETE_THREAD_CHANNEL = 'copilot-history:delete-thread'
export const COPILOT_HISTORY_PURGE_THREAD_CHANNEL = 'copilot-history:purge-thread'
export const COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL = 'copilot-history:backup-database'
export const COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL = 'copilot-history:restore-database'

export interface CopilotHistoryApiFailure {
  ok: false
  error: string
}

export interface CopilotHistoryBackupDatabaseRequest {
  targetPath?: string | null
}

export interface CopilotHistoryRestoreDatabaseRequest {
  sourcePath: string
}

export interface CopilotHistoryThreadSummary {
  threadId: string
  boundAgentId: string
  title: string | null
  titleSource: string | null
  summary: string | null
  summarySource: string | null
  createdAt: string
  updatedAt: string
  lastActivityAt: string | null
  lastRunId: string | null
  lastRunStatus: string | null
  lastUserMessagePreview: string | null
  lastAssistantMessagePreview: string | null
  driftSummary: Record<string, unknown> | null
}

export interface CopilotHistoryRunSummary {
  runId: string
  threadId: string
  status: string
  createdAt: string
  updatedAt: string
  startedAt: string | null
  terminalAt: string | null
  resolvedModelId: string | null
  requestedMessageText: string | null
  assistantText: string | null
}

export interface CopilotHistoryRunEvent {
  sequence: number
  eventType: string
  createdAt: string
  payload: Record<string, unknown>
  toolCallId: string | null
  toolId: string | null
  phase: string | null
  isRedacted: boolean
  redactionVersion: number
}

export interface CopilotHistoryListThreadsSuccess {
  ok: true
  version: string
  threads: CopilotHistoryThreadSummary[]
}

export interface CopilotHistoryThreadDetailSuccess {
  ok: true
  version: string
  thread: CopilotHistoryThreadSummary
  timelineItems: Record<string, unknown>[]
  runSummaries: CopilotHistoryRunSummary[]
  latestConfigurationSnapshot: Record<string, unknown> | null
  availabilityDrift: Record<string, unknown> | null
}

export interface CopilotHistoryRunReplaySuccess {
  ok: true
  version: string
  run: CopilotHistoryRunSummary
  historicalSnapshot: Record<string, unknown> | null
  orderedEvents: CopilotHistoryRunEvent[]
  toolCallBlocks: Record<string, unknown>[]
  diagnosticBlocks: Record<string, unknown>[]
  terminalState: Record<string, unknown> | null
  availabilityInterpretation: Record<string, unknown> | null
}

export interface CopilotHistoryThreadDeleteSuccess {
  ok: true
  version: string
  threadId: string
  deletedAt: string
}

export interface CopilotHistoryThreadPurgeSuccess {
  ok: true
  version: string
  threadId: string
  purgedAt: string
  deletedAt: string | null
}

export interface CopilotHistoryDatabaseBackupSuccess {
  ok: true
  version: string
  databasePath: string
  backupPath: string
  createdAt: string
}

export interface CopilotHistoryDatabaseRestoreSuccess {
  ok: true
  version: string
  databasePath: string
  sourcePath: string
  restoredAt: string
}

export type CopilotHistoryListThreadsResult = CopilotHistoryListThreadsSuccess | CopilotHistoryApiFailure
export type CopilotHistoryThreadDetailResult = CopilotHistoryThreadDetailSuccess | CopilotHistoryApiFailure
export type CopilotHistoryRunReplayResult = CopilotHistoryRunReplaySuccess | CopilotHistoryApiFailure
export type CopilotHistoryThreadDeleteResult = CopilotHistoryThreadDeleteSuccess | CopilotHistoryApiFailure
export type CopilotHistoryThreadPurgeResult = CopilotHistoryThreadPurgeSuccess | CopilotHistoryApiFailure
export type CopilotHistoryDatabaseBackupResult = CopilotHistoryDatabaseBackupSuccess | CopilotHistoryApiFailure
export type CopilotHistoryDatabaseRestoreResult = CopilotHistoryDatabaseRestoreSuccess | CopilotHistoryApiFailure

export interface CopilotHistoryApi {
  listThreads: () => Promise<CopilotHistoryListThreadsResult>
  getThreadDetail: (threadId: string) => Promise<CopilotHistoryThreadDetailResult>
  getRunReplay: (runId: string) => Promise<CopilotHistoryRunReplayResult>
  deleteThread: (threadId: string) => Promise<CopilotHistoryThreadDeleteResult>
  purgeThread: (threadId: string) => Promise<CopilotHistoryThreadPurgeResult>
  backupDatabase: (request?: CopilotHistoryBackupDatabaseRequest) => Promise<CopilotHistoryDatabaseBackupResult>
  restoreDatabase: (request: CopilotHistoryRestoreDatabaseRequest) => Promise<CopilotHistoryDatabaseRestoreResult>
}
