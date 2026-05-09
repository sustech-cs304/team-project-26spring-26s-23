export type BlackboardSyncInterval = 'off' | 'two_hours' | 'daily'

export type BlackboardSyncStatus = 'idle' | 'running' | 'completed' | 'failed'

export interface BlackboardSyncState {
  status: BlackboardSyncStatus
  lastSyncAt: string | null
  nextSyncAt: string | null
  lastSyncError: string | null
  syncInterval: BlackboardSyncInterval
  progressMessage: string | null
  progressStage: string | null
}

export const DEFAULT_BLACKBOARD_SYNC_STATE: BlackboardSyncState = {
  status: 'idle',
  lastSyncAt: null,
  nextSyncAt: null,
  lastSyncError: null,
  syncInterval: 'off',
  progressMessage: null,
  progressStage: null,
}

export interface BlackboardSyncStatusResult {
  ok: true
  state: BlackboardSyncState
}

export interface BlackboardSyncTriggerResult {
  ok: true
  state: BlackboardSyncState
}

export interface BlackboardSyncSettingsUpdateResult {
  ok: true
  state: BlackboardSyncState
}

export interface BlackboardSyncApiFailure {
  ok: false
  error: {
    message: string
    code?: string
  }
}

export type BlackboardSyncStatusResponse = BlackboardSyncStatusResult | BlackboardSyncApiFailure
export type BlackboardSyncTriggerResponse = BlackboardSyncTriggerResult | BlackboardSyncApiFailure
export type BlackboardSyncSettingsUpdateResponse = BlackboardSyncSettingsUpdateResult | BlackboardSyncApiFailure

export type BlackboardSyncStateListener = (state: BlackboardSyncState) => void

export const SECONDS_PER_HOUR = 3600
