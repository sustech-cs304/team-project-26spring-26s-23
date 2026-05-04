import type { BrowserWindow } from 'electron'

interface IpcMainLike {
  handle(channel: string, listener: (...args: any[]) => any): void
  removeHandler(channel: string): void
}

import type { SettingsWorkspaceStateSaveInput } from '../settings-workspace/state-schema'
import {
  SUSTECH_BLACKBOARD_GET_STATUS_CHANNEL,
  SUSTECH_BLACKBOARD_SYNC_STATE_CHANGED_CHANNEL,
  SUSTECH_BLACKBOARD_TRIGGER_SYNC_CHANNEL,
  SUSTECH_BLACKBOARD_UPDATE_SETTINGS_CHANNEL,
} from './ipc'
import { createBlackboardScheduler, type BlackboardScheduler } from './scheduler'
import {
  DEFAULT_BLACKBOARD_SYNC_STATE,
  type BlackboardSyncInterval,
  type BlackboardSyncSettingsUpdateResult,
  type BlackboardSyncState,
  type BlackboardSyncStatusResult,
  type BlackboardSyncTriggerResult,
} from './types'

async function fetchBackendSyncTrigger(
  runtimeBaseUrl: string,
  parallelWorkers: number,
  currentTermOnly: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${runtimeBaseUrl}/api/blackboard/sync/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parallelWorkers, currentTermOnly }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      return { ok: false, error: (body as Record<string, unknown>).error as string | undefined }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

interface SyncStatusPayload {
  status: string
  lastSyncAt?: string | null
  lastSyncError?: string | null
  progressStage?: string | null
  progressMessage?: string | null
  canCancel?: boolean
}

async function fetchBackendSyncStatus(
  runtimeBaseUrl: string,
): Promise<SyncStatusPayload | null> {
  try {
    const response = await fetch(`${runtimeBaseUrl}/api/blackboard/sync/status`)
    if (!response.ok) {
      return null
    }
    const body = await response.json()
    return body as SyncStatusPayload
  } catch {
    return null
  }
}

function normalizeParallelWorkers(value: unknown, fallback = 1): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(6, Math.max(1, parsed))
}

export interface ElectronSustechBlackboardServiceOptions {
  getRuntimeBaseUrl: () => string
  getLiveWindows: () => BrowserWindow[]
  loadSettings: () => Promise<SettingsWorkspaceStateSaveInput | null>
}

export interface ElectronSustechBlackboardService {
  registerIpcHandlers: (ipcMain: IpcMainLike) => void
  removeIpcHandlers: (ipcMain: IpcMainLike) => void
  getSyncState: () => BlackboardSyncState
  onSettingsChanged: (settings: SettingsWorkspaceStateSaveInput) => void
  dispose: () => void
}

export function createElectronSustechBlackboardService(
  options: ElectronSustechBlackboardServiceOptions,
): ElectronSustechBlackboardService {
  let syncState: BlackboardSyncState = { ...DEFAULT_BLACKBOARD_SYNC_STATE }
  let scheduler: BlackboardScheduler | null = null
  let disposed = false

  function broadcastState() {
    const state = { ...syncState }
    for (const win of options.getLiveWindows()) {
      try {
        if (!win.isDestroyed()) {
          win.webContents.send(SUSTECH_BLACKBOARD_SYNC_STATE_CHANGED_CHANNEL, state)
        }
      } catch {
        // window may be in a transitional state
      }
    }
  }

  function updateSyncState(patch: Partial<BlackboardSyncState>) {
    syncState = { ...syncState, ...patch }
    broadcastState()
  }

  let pollAbortController: AbortController | null = null

  async function loadInitialState() {
    const settings = await options.loadSettings()
    if (settings && !disposed) {
      const interval = settings.sustech.blackboardSyncInterval
      updateSyncState({
        syncInterval: interval,
        lastSyncAt: settings.sustech.blackboardLastAutoSyncAt ?? null,
        nextSyncAt: settings.sustech.blackboardNextAutoSyncAt ?? null,
      })
      applySchedulerInterval(interval)
    }
  }

  function applySchedulerInterval(interval: BlackboardSyncInterval) {
    if (scheduler !== null) {
      scheduler.stop()
      scheduler = null
    }

    if (interval === 'off') {
      return
    }

    scheduler = createBlackboardScheduler({
      getSyncInterval: () => syncState.syncInterval,
      onTick: () => {
        void options.loadSettings().then((settings) => {
          const parallelWorkers = normalizeParallelWorkers(settings?.sustech.blackboardParallelSyncWorkers, 1)
          const currentTermOnly = settings?.sustech.blackboardCurrentTermOnly === true
          return executeSync(parallelWorkers, currentTermOnly)
        })
      },
    })
    scheduler.start()
  }

  async function executeSync(parallelWorkers = 1, currentTermOnly = false) {
    if (syncState.status === 'running') {
      return
    }

    updateSyncState({
      status: 'running',
      progressStage: 'authenticating',
      progressMessage: '开始同步...',
    })

    const result = await fetchBackendSyncTrigger(options.getRuntimeBaseUrl(), parallelWorkers, currentTermOnly)

    if (!result.ok) {
      updateSyncState({
        status: 'failed',
        lastSyncError: result.error ?? '同步失败',
        progressStage: null,
        progressMessage: null,
      })
      return
    }

    // Poll /api/blackboard/sync/status until the background job finishes
    pollAbortController = new AbortController()
    const signal = pollAbortController.signal

    const POLL_INTERVAL_MS = 1000
    const MAX_POLL_DURATION_MS = 10 * 60 * 1000 // 10 minutes
    const startedAt = Date.now()

    try {
      while (true) {
        if (signal.aborted || disposed) {
          return
        }

        if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
          updateSyncState({
            status: 'failed',
            lastSyncError: '同步超时',
            progressStage: null,
            progressMessage: null,
          })
          return
        }

        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, POLL_INTERVAL_MS)
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
        })

        if (signal.aborted || disposed) {
          return
        }

        // eslint-disable-next-line no-await-in-loop
        const status = await fetchBackendSyncStatus(options.getRuntimeBaseUrl())

        if (status === null) {
          updateSyncState({
            status: 'failed',
            lastSyncError: '无法获取同步状态',
            progressStage: null,
            progressMessage: null,
          })
          return
        }

        const backendStatus = status.status

        if (backendStatus === 'running') {
          updateSyncState({
            progressStage: status.progressStage ?? syncState.progressStage,
            progressMessage: status.progressMessage ?? syncState.progressMessage,
          })
          continue
        }

        if (backendStatus === 'completed') {
          updateSyncState({
            status: 'completed',
            lastSyncAt: status.lastSyncAt ?? new Date().toISOString(),
            lastSyncError: null,
            progressStage: null,
            progressMessage: null,
          })
          return
        }

        // failed, idle, or any other terminal state
        updateSyncState({
          status: 'failed',
          lastSyncError: status.lastSyncError ?? '同步失败',
          progressStage: null,
          progressMessage: null,
        })
        return
      }
    } finally {
      pollAbortController = null
    }
  }

  const service: ElectronSustechBlackboardService = {
    registerIpcHandlers(ipcMain: IpcMainLike) {
      ipcMain.handle(SUSTECH_BLACKBOARD_GET_STATUS_CHANNEL, async (): Promise<BlackboardSyncStatusResult> => {
        return { ok: true, state: { ...syncState } }
      })

      ipcMain.handle(SUSTECH_BLACKBOARD_TRIGGER_SYNC_CHANNEL, async (): Promise<BlackboardSyncTriggerResult> => {
        if (syncState.status === 'running') {
          return { ok: true, state: { ...syncState } }
        }
        const settings = await options.loadSettings()
        const parallelWorkers = normalizeParallelWorkers(settings?.sustech.blackboardParallelSyncWorkers, 1)
        const currentTermOnly = settings?.sustech.blackboardCurrentTermOnly === true
        await executeSync(parallelWorkers, currentTermOnly)
        return { ok: true, state: { ...syncState } }
      })

      ipcMain.handle(SUSTECH_BLACKBOARD_UPDATE_SETTINGS_CHANNEL, async (_event: unknown, interval: string): Promise<BlackboardSyncSettingsUpdateResult> => {
        const validIntervals: BlackboardSyncInterval[] = ['off', 'two_hours', 'daily']
        const normalizedInterval: BlackboardSyncInterval = validIntervals.includes(interval as BlackboardSyncInterval)
          ? (interval as BlackboardSyncInterval)
          : 'off'

        updateSyncState({ syncInterval: normalizedInterval })
        applySchedulerInterval(normalizedInterval)
        return { ok: true, state: { ...syncState } }
      })
    },

    removeIpcHandlers(ipcMain: IpcMainLike) {
      ipcMain.removeHandler(SUSTECH_BLACKBOARD_GET_STATUS_CHANNEL)
      ipcMain.removeHandler(SUSTECH_BLACKBOARD_TRIGGER_SYNC_CHANNEL)
      ipcMain.removeHandler(SUSTECH_BLACKBOARD_UPDATE_SETTINGS_CHANNEL)
    },

    getSyncState() {
      return { ...syncState }
    },

    onSettingsChanged(settings: SettingsWorkspaceStateSaveInput) {
      if (disposed) {
        return
      }
      const interval = settings.sustech.blackboardSyncInterval
      if (interval !== syncState.syncInterval) {
        updateSyncState({ syncInterval: interval })
        applySchedulerInterval(interval)
      }
    },

    dispose() {
      disposed = true
      if (pollAbortController !== null) {
        pollAbortController.abort()
        pollAbortController = null
      }
      if (scheduler !== null) {
        scheduler.stop()
        scheduler = null
      }
    },
  }

  void loadInitialState()

  return service
}
