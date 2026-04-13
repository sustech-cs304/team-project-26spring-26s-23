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
): ConfigCenterPublicTextFieldStatusView {
  switch (state.status) {
    case 'loading':
      return {
        badgeClassName: 'inline-badge--primary',
        badgeLabel: '读取中',
        detail: '正在从配置中心公共快照读取当前字段。',
        role: 'status',
      }
    case 'saving':
      return {
        badgeClassName: 'inline-badge--primary',
        badgeLabel: '保存中',
        detail: '正在通过配置中心公共补丁写入当前字段。',
        role: 'status',
      }
    case 'error':
      return {
        badgeClassName: 'inline-badge--warning',
        badgeLabel: '保存失败',
        detail: state.error ?? '配置中心字段更新失败。',
        role: 'alert',
      }
    case 'saved':
      return {
        badgeClassName: 'inline-badge--success',
        badgeLabel: '已保存',
        detail: '当前字段已写入配置中心。',
        role: 'status',
      }
    default:
      if (state.dirty) {
        return {
          badgeClassName: 'inline-badge--warning',
          badgeLabel: '草稿中',
          detail: '当前为本地草稿；失焦、回车或点击保存将提交。',
          role: 'status',
        }
      }

      return {
        badgeClassName: 'inline-badge--success',
        badgeLabel: '已同步',
        detail: '当前字段已与配置中心公共快照保持同步。',
        role: 'status',
      }
  }
}
