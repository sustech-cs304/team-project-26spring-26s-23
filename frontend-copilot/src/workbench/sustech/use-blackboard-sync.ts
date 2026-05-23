import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkbenchLanguage } from '../_locale/types'

export interface SyncState {
  status: 'idle' | 'running' | 'completed' | 'failed'
  lastSyncAt: string | null
  nextSyncAt: string | null
  lastSyncError: string | null
  syncInterval: 'off' | 'two_hours' | 'daily'
  progressMessage: string | null
  progressStage: string | null
  progressLogs: string[]
  canCancel?: boolean
  timeoutSeconds?: number | null
}

export const DEFAULT_SYNC_STATE: SyncState = {
  status: 'idle', lastSyncAt: null, nextSyncAt: null,
  lastSyncError: null, syncInterval: 'off', progressMessage: null, progressStage: null, progressLogs: [], canCancel: false, timeoutSeconds: null,
}

export interface UseBlackboardSyncInput {
  runtimeBaseUrl: string
  language: WorkbenchLanguage
}

export interface UseBlackboardSyncOutput {
  syncState: SyncState
  isSyncRunning: boolean
  dataRefreshToken: number
  setSyncState: React.Dispatch<React.SetStateAction<SyncState>>
  fetchStatus: () => Promise<void>
  handleTriggerSync: () => Promise<void>
  handleCancelSync: () => Promise<void>
  handleSyncIntervalChange: (nextInterval: SyncState['syncInterval']) => Promise<void>
}

// eslint-disable-next-line max-lines-per-function
export function useBlackboardSync(input: UseBlackboardSyncInput): UseBlackboardSyncOutput {
  const { runtimeBaseUrl, language } = input
  const isEnglish = language === 'en-US'
  const [syncState, setSyncState] = useState<SyncState>(DEFAULT_SYNC_STATE)
  const previousSyncStatusRef = useRef<SyncState['status']>('idle')
  const [dataRefreshToken, setDataRefreshToken] = useState(0)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${runtimeBaseUrl}/api/blackboard/sync/status`)
      if (!res.ok) {
        const message = `HTTP ${res.status}`
        setSyncState((prev) => ({
          ...prev,
          lastSyncError: message,
          progressLogs: [...prev.progressLogs, message],
        }))
        return
      }
      const data = await res.json()
      setSyncState((prev) => {
        const status = data.status ?? prev.status
        const progressLogs = Array.isArray(data.progressLogs) ? data.progressLogs : prev.progressLogs
        return {
          ...prev, status,
          lastSyncAt: data.lastSyncAt ?? prev.lastSyncAt,
          lastSyncError: data.lastSyncError ?? prev.lastSyncError,
          progressMessage: data.progressMessage ?? (status === 'completed' ? null : prev.progressMessage),
          progressStage: data.progressStage ?? (status === 'completed' ? null : prev.progressStage),
          progressLogs,
          canCancel: data.canCancel ?? prev.canCancel,
          timeoutSeconds: data.timeoutSeconds ?? prev.timeoutSeconds,
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSyncState((prev) => ({
        ...prev,
        lastSyncError: message,
        progressLogs: [...prev.progressLogs, message],
      }))
    }
  }, [runtimeBaseUrl])

  const handleTriggerSync = useCallback(async () => {
    setSyncState((prev) => ({
      ...prev,
      status: 'running',
      lastSyncError: null,
      progressMessage: isEnglish ? 'Starting sync…' : '开始同步...',
      progressStage: 'authenticating',
      progressLogs: [isEnglish ? 'Starting sync…' : '开始同步...'],
      canCancel: true,
    }))
    try {
      const { loadSettingsWorkspaceState } = await import('../settings/workspace-state')
      const settingsResult = await loadSettingsWorkspaceState()
      const parallelWorkersRaw = settingsResult.ok
        ? settingsResult.state.sustech.blackboardParallelSyncWorkers
        : '1'
      const currentTermOnly = settingsResult.ok
        ? settingsResult.state.sustech.blackboardCurrentTermOnly === true
        : false
      const parallelWorkers = Math.min(6, Math.max(1, Number.parseInt(parallelWorkersRaw, 10) || 1))

      const res = await fetch(`${runtimeBaseUrl}/api/blackboard/sync/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parallelWorkers, currentTermOnly }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const serverError = (body as { error?: string }).error ?? `HTTP ${res.status}`
        setSyncState((prev) => ({ ...prev, status: 'failed', lastSyncError: serverError }))
        return
      }
      const data = await res.json()
      const status = data.status ?? 'idle'
      setSyncState((prev) => ({
        ...prev, status,
        lastSyncAt: data.lastSyncAt ?? prev.lastSyncAt,
        lastSyncError: data.lastSyncError ?? null,
        progressMessage: data.progressMessage ?? (status === 'completed' ? null : prev.progressMessage),
        progressStage: data.progressStage ?? (status === 'completed' ? null : prev.progressStage),
        progressLogs: Array.isArray(data.progressLogs) ? data.progressLogs : prev.progressLogs,
        canCancel: data.canCancel ?? prev.canCancel,
        timeoutSeconds: data.timeoutSeconds ?? prev.timeoutSeconds,
      }))
    } catch (err) {
      const message = err instanceof TypeError && err.message === 'Failed to fetch'
        ? (isEnglish
          ? `Unable to connect to backend at ${runtimeBaseUrl}. Please ensure the desktop runtime is running.`
          : `无法连接到后端 ${runtimeBaseUrl}，请确认桌面运行时已启动。`)
        : String(err)
      setSyncState((prev) => ({
        ...prev,
        status: 'failed',
        lastSyncError: message,
        progressMessage: message,
        progressLogs: [...prev.progressLogs, message],
        canCancel: false,
      }))
    }
  }, [runtimeBaseUrl, isEnglish])

  const handleCancelSync = useCallback(async () => {
    try {
      const res = await fetch(`${runtimeBaseUrl}/api/blackboard/sync/cancel`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      setSyncState((prev) => ({
        ...prev,
        status: data.status ?? prev.status,
        progressMessage: data.progressMessage ?? prev.progressMessage,
        progressStage: data.progressStage ?? prev.progressStage,
        progressLogs: Array.isArray(data.progressLogs) ? data.progressLogs : prev.progressLogs,
        canCancel: data.canCancel ?? false,
        timeoutSeconds: data.timeoutSeconds ?? prev.timeoutSeconds,
      }))
    } catch (err) {
      const message = err instanceof TypeError && err.message === 'Failed to fetch'
        ? (isEnglish
          ? `Unable to connect to backend at ${runtimeBaseUrl}. Please ensure the desktop runtime is running.`
          : `无法连接到后端 ${runtimeBaseUrl}，请确认桌面运行时已启动。`)
        : String(err)
      setSyncState((prev) => ({
        ...prev,
        status: 'failed',
        lastSyncError: message,
        progressMessage: message,
        progressLogs: [...prev.progressLogs, message],
        canCancel: false,
      }))
    }
  }, [runtimeBaseUrl, isEnglish])

  const handleSyncIntervalChange = useCallback(async (nextInterval: SyncState['syncInterval']) => {
    setSyncState((prev) => ({ ...prev, syncInterval: nextInterval }))
    const { loadSettingsWorkspaceState, saveSettingsWorkspaceState } = await import('../settings/workspace-state')
    const { createSettingsWorkspaceFormStateFromEditableState } = await import('../settings/settings-workspace-form-state')
    const { createSettingsWorkspaceStateSaveInput } = await import('../settings/settings-workspace-save-input')
    const settingsResult = await loadSettingsWorkspaceState()
    if (!settingsResult.ok) {
      return
    }
    const formState = createSettingsWorkspaceFormStateFromEditableState(settingsResult.state)
    await saveSettingsWorkspaceState(createSettingsWorkspaceStateSaveInput({
      ...formState,
      blackboardSyncInterval: nextInterval,
    }))
  }, [])

  const isSyncRunning = syncState.status === 'running'

  useEffect(() => {
    if (syncState.status === 'completed' && previousSyncStatusRef.current !== 'completed') {
      setDataRefreshToken((value) => value + 1)
    }
    previousSyncStatusRef.current = syncState.status
  }, [syncState.status])

  useEffect(() => {
    const intervalMs = syncState.status === 'running' ? 2000 : 5000
    const i = setInterval(() => { void fetchStatus() }, intervalMs)
    return () => clearInterval(i)
  }, [syncState.status, fetchStatus])

  return {
    syncState,
    isSyncRunning,
    dataRefreshToken,
    setSyncState,
    fetchStatus,
    handleTriggerSync,
    handleCancelSync,
    handleSyncIntervalChange,
  }
}
