import type { BrowserWindow } from 'electron'

interface IpcMainLike {
  handle(channel: string, listener: (...args: unknown[]) => unknown): void
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
    if (!response.ok) return null
    const body = await response.json()
    return body as SyncStatusPayload
  } catch {
    return null
  }
}

function normalizeParallelWorkers(value: unknown, fallback = 1): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(6, Math.max(1, parsed))
}

function intervalMs(interval: BlackboardSyncInterval): number | null {
  switch (interval) {
    case 'two_hours': return 2 * 60 * 60 * 1000
    case 'daily': return 24 * 60 * 60 * 1000
    default: return null
  }
}

function resolveNextSyncAt(interval: BlackboardSyncInterval, referenceTime: string | null): string | null {
  const delayMs = intervalMs(interval)
  if (delayMs === null || referenceTime === null) return null
  const referenceTimestamp = Date.parse(referenceTime)
  if (!Number.isFinite(referenceTimestamp)) return null
  return new Date(referenceTimestamp + delayMs).toISOString()
}

export interface ElectronSustechBlackboardServiceOptions {
  getRuntimeBaseUrl: () => string
  getLiveWindows: () => BrowserWindow[]
  loadSettings: () => Promise<SettingsWorkspaceStateSaveInput | null>
  saveSettings?: (input: SettingsWorkspaceStateSaveInput) => Promise<void>
}

export interface ElectronSustechBlackboardService {
  registerIpcHandlers: (ipcMain: IpcMainLike) => void
  removeIpcHandlers: (ipcMain: IpcMainLike) => void
  getSyncState: () => BlackboardSyncState
  onSettingsChanged: (settings: SettingsWorkspaceStateSaveInput) => void
  dispose: () => void
}

interface ServiceState {
  syncState: BlackboardSyncState
  scheduler: BlackboardScheduler | null
  disposed: boolean
  pollAbortController: AbortController | null
}

type Broadcaster = () => void
type Updater = (patch: Partial<BlackboardSyncState>) => void

async function persistAutoSyncTimestamps(
  options: ElectronSustechBlackboardServiceOptions,
  patch: { blackboardLastAutoSyncAt?: string | null; blackboardNextAutoSyncAt?: string | null },
): Promise<void> {
  if (options.saveSettings === undefined) return
  const settings = await options.loadSettings()
  if (settings === null) return
  await options.saveSettings({
    ...settings,
    sustech: {
      ...settings.sustech,
      ...(Object.prototype.hasOwnProperty.call(patch, 'blackboardLastAutoSyncAt')
        ? { blackboardLastAutoSyncAt: patch.blackboardLastAutoSyncAt ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'blackboardNextAutoSyncAt')
        ? { blackboardNextAutoSyncAt: patch.blackboardNextAutoSyncAt ?? null }
        : {}),
    },
  })
}

async function pollSyncStatus(
  state: ServiceState,
  updater: Updater,
  options: ElectronSustechBlackboardServiceOptions,
) {
  const signal = state.pollAbortController!.signal
  const POLL_INTERVAL_MS = 1000
  const MAX_POLL_DURATION_MS = 10 * 60 * 1000
  const startedAt = Date.now()

  for (;;) {
    if (signal.aborted || state.disposed) return
    if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
      updater({ status: 'failed', lastSyncError: '同步超时', progressStage: null, progressMessage: null })
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, POLL_INTERVAL_MS)
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
    })
    if (signal.aborted || state.disposed) return
    const status = await fetchBackendSyncStatus(options.getRuntimeBaseUrl())
    if (status === null) {
      updater({ status: 'failed', lastSyncError: '无法获取同步状态', progressStage: null, progressMessage: null })
      return
    }
    if (status.status === 'running') {
      updater({ progressStage: status.progressStage ?? state.syncState.progressStage, progressMessage: status.progressMessage ?? state.syncState.progressMessage })
      continue
    }
    if (status.status === 'completed') {
      const completedAt = status.lastSyncAt ?? new Date().toISOString()
      const nextSyncAt = resolveNextSyncAt(state.syncState.syncInterval, completedAt)
      updater({ status: 'completed', lastSyncAt: completedAt, nextSyncAt, lastSyncError: null, progressStage: null, progressMessage: null })
      await persistAutoSyncTimestamps(options, { blackboardLastAutoSyncAt: completedAt, blackboardNextAutoSyncAt: nextSyncAt })
      return
    }
    updater({ status: 'failed', lastSyncError: status.lastSyncError ?? '同步失败', progressStage: null, progressMessage: null })
    return
  }
}

interface SyncOptions { parallelWorkers?: number; currentTermOnly?: boolean }

async function executeSync(
  state: ServiceState,
  updater: Updater,
  options: ElectronSustechBlackboardServiceOptions,
  syncOptions: SyncOptions = {},
) {
  const parallelWorkers = syncOptions.parallelWorkers ?? 1
  const currentTermOnly = syncOptions.currentTermOnly ?? false
  if (state.syncState.status === 'running') return
  updater({ status: 'running', lastSyncError: null, progressStage: 'authenticating', progressMessage: '开始同步...' })
  const result = await fetchBackendSyncTrigger(options.getRuntimeBaseUrl(), parallelWorkers, currentTermOnly)
  if (!result.ok) {
    updater({ status: 'failed', lastSyncError: result.error ?? '同步失败', progressStage: null, progressMessage: null })
    return
  }
  state.pollAbortController = new AbortController()
  try {
    await pollSyncStatus(state, updater, options)
  } finally {
    state.pollAbortController = null
  }
}

interface SchedulerIntervalOptions {
  referenceTime?: string | null
  preservedNextSyncAt?: string | null
  persist?: boolean
  interval: BlackboardSyncInterval
}

function applySchedulerInterval(
  state: ServiceState,
  updater: Updater,
  options: ElectronSustechBlackboardServiceOptions,
  schedulerOpts: SchedulerIntervalOptions,
) {
  const interval = schedulerOpts.interval
  if (state.scheduler !== null) { state.scheduler.stop(); state.scheduler = null }
  if (interval === 'off') {
    updater({ nextSyncAt: schedulerOpts.preservedNextSyncAt ?? null })
    if (schedulerOpts.persist === true) {
      void persistAutoSyncTimestamps(options, { blackboardNextAutoSyncAt: null })
    }
    return
  }
  state.scheduler = createBlackboardScheduler({
    getSyncInterval: () => state.syncState.syncInterval,
    onTick: () => {
      void options.loadSettings().then((settings) => {
        const workers = normalizeParallelWorkers(settings?.sustech.blackboardParallelSyncWorkers, 1)
        const termOnly = settings?.sustech.blackboardCurrentTermOnly === true
        return executeSync(state, updater, options, { parallelWorkers: workers, currentTermOnly: termOnly })
      })
    },
  })
  state.scheduler.start()
  const nextSyncAt = resolveNextSyncAt(interval, schedulerOpts.referenceTime ?? new Date().toISOString())
  updater({ nextSyncAt })
  if (schedulerOpts.persist === true) {
    void persistAutoSyncTimestamps(options, { blackboardNextAutoSyncAt: nextSyncAt })
  }
}

function createIpcHandlers(
  state: ServiceState,
  updater: Updater,
  options: ElectronSustechBlackboardServiceOptions,
  initPromise: Promise<void>,
) {
  return {
    register(ipcMain: IpcMainLike) {
      ipcMain.handle(SUSTECH_BLACKBOARD_GET_STATUS_CHANNEL, async (): Promise<BlackboardSyncStatusResult> => {
        await initPromise
        return { ok: true, state: { ...state.syncState } }
      })
      ipcMain.handle(SUSTECH_BLACKBOARD_TRIGGER_SYNC_CHANNEL, async (): Promise<BlackboardSyncTriggerResult> => {
        await initPromise
        if (state.syncState.status === 'running') return { ok: true, state: { ...state.syncState } }
        const settings = await options.loadSettings()
        const workers = normalizeParallelWorkers(settings?.sustech.blackboardParallelSyncWorkers, 1)
        const termOnly = settings?.sustech.blackboardCurrentTermOnly === true
        void executeSync(state, updater, options, { parallelWorkers: workers, currentTermOnly: termOnly })
        return { ok: true, state: { ...state.syncState } }
      })
      ipcMain.handle(SUSTECH_BLACKBOARD_UPDATE_SETTINGS_CHANNEL, async (...args: unknown[]) => {
        const interval = args[1] as string
        await initPromise
        const validIntervals: BlackboardSyncInterval[] = ['off', 'two_hours', 'daily']
        const normalizedInterval: BlackboardSyncInterval = validIntervals.includes(interval as BlackboardSyncInterval) ? (interval as BlackboardSyncInterval) : 'off'
        updater({ syncInterval: normalizedInterval })
        applySchedulerInterval(state, updater, options, { interval: normalizedInterval, referenceTime: state.syncState.lastSyncAt, persist: true })
        return { ok: true, state: { ...state.syncState } }
      })
    },
    remove(ipcMain: IpcMainLike) {
      ipcMain.removeHandler(SUSTECH_BLACKBOARD_GET_STATUS_CHANNEL)
      ipcMain.removeHandler(SUSTECH_BLACKBOARD_TRIGGER_SYNC_CHANNEL)
      ipcMain.removeHandler(SUSTECH_BLACKBOARD_UPDATE_SETTINGS_CHANNEL)
    },
  }
}

export function createElectronSustechBlackboardService(
  options: ElectronSustechBlackboardServiceOptions,
): ElectronSustechBlackboardService {
  const state: ServiceState = {
    syncState: { ...DEFAULT_BLACKBOARD_SYNC_STATE },
    scheduler: null,
    disposed: false,
    pollAbortController: null,
  }

  const broadcastState: Broadcaster = () => {
    const snapshot = { ...state.syncState }
    for (const win of options.getLiveWindows()) {
      try { if (!win.isDestroyed()) win.webContents.send(SUSTECH_BLACKBOARD_SYNC_STATE_CHANGED_CHANNEL, snapshot) } catch { /* window transitional state */ }
    }
  }

  const updateSyncState: Updater = (patch) => {
    state.syncState = { ...state.syncState, ...patch }
    broadcastState()
  }

  const initializationPromise = (async () => {
    const settings = await options.loadSettings()
    if (settings && !state.disposed) {
      const interval = settings.sustech.blackboardSyncInterval
      updateSyncState({ syncInterval: interval, lastSyncAt: settings.sustech.blackboardLastAutoSyncAt ?? null, nextSyncAt: settings.sustech.blackboardNextAutoSyncAt ?? null })
      applySchedulerInterval(state, updateSyncState, options, { interval, referenceTime: settings.sustech.blackboardLastAutoSyncAt ?? null, preservedNextSyncAt: settings.sustech.blackboardNextAutoSyncAt ?? null, persist: false })
    }
  })()

  const ipcHandlers = createIpcHandlers(state, updateSyncState, options, initializationPromise)

  return {
    registerIpcHandlers: (ipcMain) => ipcHandlers.register(ipcMain),
    removeIpcHandlers: (ipcMain) => ipcHandlers.remove(ipcMain),
    getSyncState: () => ({ ...state.syncState }),
    onSettingsChanged(settings) {
      if (state.disposed) return
      const previousInterval = state.syncState.syncInterval
      const interval = settings.sustech.blackboardSyncInterval
      const nextSyncAt = settings.sustech.blackboardNextAutoSyncAt ?? resolveNextSyncAt(interval, settings.sustech.blackboardLastAutoSyncAt ?? null)
      updateSyncState({ syncInterval: interval, lastSyncAt: settings.sustech.blackboardLastAutoSyncAt ?? state.syncState.lastSyncAt, nextSyncAt })
      if (interval !== previousInterval) {
        applySchedulerInterval(state, updateSyncState, options, { interval, referenceTime: settings.sustech.blackboardLastAutoSyncAt ?? null, preservedNextSyncAt: settings.sustech.blackboardNextAutoSyncAt ?? null, persist: false })
      }
    },
    dispose() {
      state.disposed = true
      if (state.pollAbortController !== null) { state.pollAbortController.abort(); state.pollAbortController = null }
      if (state.scheduler !== null) { state.scheduler.stop(); state.scheduler = null }
    },
  }
}
