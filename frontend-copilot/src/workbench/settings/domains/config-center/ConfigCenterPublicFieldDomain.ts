import { getConfigCenterPublicFieldCopy } from '../../../locale'

export type ConfigCenterPublicTextFieldStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error'

export interface ConfigCenterPublicTextFieldState {
  syncedValue: string
  draftValue: string
  dirty: boolean
  status: ConfigCenterPublicTextFieldStatus
  error: string | null
}

export interface ConfigCenterPublicTextFieldStatusView {
  badgeClassName: string
  badgeLabel: string
  detail: string
  role: 'alert' | 'status'
}

export function createConfigCenterPublicTextFieldState(
  snapshotValue: string | null = null,
): ConfigCenterPublicTextFieldState {
  const syncedValue = snapshotValue ?? ''

  return {
    syncedValue,
    draftValue: syncedValue,
    dirty: false,
    status: 'idle',
    error: null,
  }
}

export function createLoadingConfigCenterPublicTextFieldState(): ConfigCenterPublicTextFieldState {
  return {
    ...createConfigCenterPublicTextFieldState(),
    status: 'loading',
  }
}

export function normalizeConfigCenterPublicTextFieldValue(value: string): string | null {
  const normalized = value.trim()
  return normalized ? normalized : null
}

export function applyDraftValueToConfigCenterPublicTextField(
  state: ConfigCenterPublicTextFieldState,
  draftValue: string,
): ConfigCenterPublicTextFieldState {
  return {
    ...state,
    draftValue,
    dirty:
      normalizeConfigCenterPublicTextFieldValue(draftValue)
      !== normalizeConfigCenterPublicTextFieldValue(state.syncedValue),
    status: 'idle',
    error: null,
  }
}

export function applyExternalSnapshotToConfigCenterPublicTextField(
  state: ConfigCenterPublicTextFieldState,
  snapshotValue: string | null,
): ConfigCenterPublicTextFieldState {
  const syncedValue = snapshotValue ?? ''

  if (state.dirty) {
    return {
      ...state,
      syncedValue,
      dirty: true,
      status: state.status === 'saving' ? 'saving' : 'idle',
      error: null,
    }
  }

  return {
    syncedValue,
    draftValue: syncedValue,
    dirty: false,
    status: 'idle',
    error: null,
  }
}

export function syncEquivalentDraftToConfigCenterPublicTextField(
  state: ConfigCenterPublicTextFieldState,
): ConfigCenterPublicTextFieldState {
  const dirty = normalizeConfigCenterPublicTextFieldValue(state.draftValue)
    !== normalizeConfigCenterPublicTextFieldValue(state.syncedValue)

  if (dirty) {
    return state
  }

  return {
    ...state,
    draftValue: state.syncedValue,
    dirty: false,
    status: 'idle',
    error: null,
  }
}

export function shouldCommitConfigCenterPublicTextField(state: ConfigCenterPublicTextFieldState): boolean {
  return normalizeConfigCenterPublicTextFieldValue(state.draftValue)
    !== normalizeConfigCenterPublicTextFieldValue(state.syncedValue)
}

export function startSavingConfigCenterPublicTextField(
  state: ConfigCenterPublicTextFieldState,
): ConfigCenterPublicTextFieldState {
  return {
    ...state,
    status: 'saving',
    error: null,
  }
}

export function applyConfigCenterPublicTextFieldSaveSuccess(
  _state: ConfigCenterPublicTextFieldState,
  snapshotValue: string | null,
): ConfigCenterPublicTextFieldState {
  const syncedValue = snapshotValue ?? ''

  return {
    syncedValue,
    draftValue: syncedValue,
    dirty: false,
    status: 'saved',
    error: null,
  }
}

export function applyConfigCenterPublicTextFieldFailure(
  state: ConfigCenterPublicTextFieldState,
  error: string,
): ConfigCenterPublicTextFieldState {
  return {
    ...state,
    status: 'error',
    error,
  }
}

export function getConfigCenterPublicTextFieldStatusView(
  state: ConfigCenterPublicTextFieldState,
  language: string = 'zh-CN',
): ConfigCenterPublicTextFieldStatusView {
  const copy = getConfigCenterPublicFieldCopy(language)

  switch (state.status) {
    case 'loading':
      return {
        badgeClassName: 'inline-badge--primary',
        badgeLabel: copy.statuses.loading,
        detail: copy.details.loading,
        role: 'status',
      }
    case 'saving':
      return {
        badgeClassName: 'inline-badge--primary',
        badgeLabel: copy.statuses.saving,
        detail: copy.details.saving,
        role: 'status',
      }
    case 'error':
      return {
        badgeClassName: 'inline-badge--warning',
        badgeLabel: copy.statuses.error,
        detail: state.error ?? copy.details.defaultError,
        role: 'alert',
      }
    case 'saved':
      return {
        badgeClassName: 'inline-badge--success',
        badgeLabel: copy.statuses.saved,
        detail: copy.details.saved,
        role: 'status',
      }
    default:
      if (state.dirty) {
        return {
          badgeClassName: 'inline-badge--warning',
          badgeLabel: copy.statuses.dirty,
          detail: copy.details.dirty,
          role: 'status',
        }
      }
 
      return {
        badgeClassName: 'inline-badge--success',
        badgeLabel: copy.statuses.synced,
        detail: copy.details.synced,
        role: 'status',
      }
  }
}
