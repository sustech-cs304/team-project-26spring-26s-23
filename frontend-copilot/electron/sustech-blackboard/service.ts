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
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${runtimeBaseUrl}/api/blackboard/sync/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        void executeSync()
      },
    })
    scheduler.start()
  }

  async function executeSync() {
    if (syncState.status === 'running') {
      return
    }

    updateSyncState({
      status: 'running',
      progressStage: 'authenticating',
      progressMessage: '开始同步...',
    })

    const result = await fetchBackendSyncTrigger(options.getRuntimeBaseUrl())

    if (result.ok) {
      updateSyncState({
        status: 'completed',
        lastSyncAt: new Date().toISOString(),
        lastSyncError: null,
        progressStage: null,
        progressMessage: null,
      })
    } else {
      updateSyncState({
        status: 'failed',
        lastSyncError: result.error ?? '同步失败',
        progressStage: null,
        progressMessage: null,
      })
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
        await executeSync()
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
      if (scheduler !== null) {
        scheduler.stop()
        scheduler = null
      }
    },
  }

  void loadInitialState()

  return service
}
