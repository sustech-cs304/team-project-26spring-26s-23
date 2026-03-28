import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import type { ConfigCenterPublicPatch } from '../../../electron/config-center/public-patch'
import type { ConfigCenterPublicSnapshot } from '../../../electron/config-center/public-snapshot'
import {
  applyConfigCenterPublicPatch,
  loadConfigCenterPublicSnapshot,
  subscribeToConfigCenterPublicSnapshotUpdates,
} from '../../features/copilot/config-center'

export type ConfigCenterPublicTextFieldStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error'

export interface ConfigCenterPublicTextFieldState {
  syncedValue: string
  draftValue: string
  dirty: boolean
  status: ConfigCenterPublicTextFieldStatus
  error: string | null
}

interface ConfigCenterPublicTextFieldStatusView {
  badgeClassName: string
  badgeLabel: string
  detail: string
  role: 'alert' | 'status'
}

interface ConfigCenterPublicTextFieldDefinition {
  fieldId: string
  cardTitle: string
  label: string
  placeholder: string
  inputType?: 'text' | 'url'
  readFromSnapshot: (snapshot: ConfigCenterPublicSnapshot) => string | null
  createPatch: (value: string | null) => ConfigCenterPublicPatch
}

const hostConfigRuntimeUrlField: ConfigCenterPublicTextFieldDefinition = {
  fieldId: 'hostConfig-runtimeUrl',
  cardTitle: '宿主配置（开发态）',
  label: '开发态运行时覆盖地址',
  placeholder: 'http://127.0.0.1:8765',
  inputType: 'url',
  readFromSnapshot: (snapshot) => snapshot.domains.hostConfig.runtimeUrl,
  createPatch: (value) => ({
    domains: {
      hostConfig: {
        runtimeUrl: value,
      },
    },
  }),
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
    dirty: normalizeConfigCenterPublicTextFieldValue(draftValue) !== normalizeConfigCenterPublicTextFieldValue(state.syncedValue),
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

export function HostConfigRuntimeOverrideCard() {
  return <ConfigCenterPublicTextFieldCard definition={hostConfigRuntimeUrlField} />
}

function ConfigCenterPublicTextFieldCard({ definition }: { definition: ConfigCenterPublicTextFieldDefinition }) {
  const { state, updateDraftValue, commitDraftValue } = useConfigCenterPublicTextField(definition)
  const statusView = getConfigCenterPublicTextFieldStatusView(state)
  const canSave = state.status !== 'loading' && state.status !== 'saving' && state.dirty

  return (
    <section className="settings-card settings-card--form" aria-label={definition.cardTitle}>
      <div className="settings-card__header settings-card__header--spaced">
        <div>
          <h3 className="settings-card__title">{definition.cardTitle}</h3>
        </div>
        <span className={`inline-badge ${statusView.badgeClassName}`}>{statusView.badgeLabel}</span>
      </div>

      <div className="settings-stack">
        <label className="form-field" htmlFor={definition.fieldId}>
          <span className="form-field__meta">
            <span className="form-field__label">{definition.label}</span>
          </span>
          <input
            id={definition.fieldId}
            className="text-input"
            type={definition.inputType ?? 'text'}
            value={state.draftValue}
            placeholder={definition.placeholder}
            disabled={state.status === 'loading' || state.status === 'saving'}
            onChange={(event) => updateDraftValue(event.target.value)}
            onBlur={() => {
              void commitDraftValue()
            }}
            onKeyDown={(event) => handleConfigCenterPublicTextFieldKeyDown(event, commitDraftValue)}
          />
        </label>

        <div className="toolbar-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!canSave}
            onClick={() => {
              void commitDraftValue()
            }}
          >
            保存
          </button>
        </div>

        <p className="form-field__description" role={statusView.role}>
          {statusView.detail}
        </p>
      </div>
    </section>
  )
}

function useConfigCenterPublicTextField(definition: ConfigCenterPublicTextFieldDefinition) {
  const [state, setState] = useState<ConfigCenterPublicTextFieldState>(() => createLoadingConfigCenterPublicTextFieldState())
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    let active = true

    setState(createLoadingConfigCenterPublicTextFieldState())

    void loadConfigCenterPublicSnapshot().then((result) => {
      if (!active) {
        return
      }

      if (result.ok) {
        setState((currentState) =>
          applyExternalSnapshotToConfigCenterPublicTextField(currentState, definition.readFromSnapshot(result.snapshot)),
        )
        return
      }

      setState((currentState) => applyConfigCenterPublicTextFieldFailure(currentState, result.error))
    })

    const unsubscribe = subscribeToConfigCenterPublicSnapshotUpdates((snapshot) => {
      if (!active) {
        return
      }

      setState((currentState) =>
        applyExternalSnapshotToConfigCenterPublicTextField(currentState, definition.readFromSnapshot(snapshot)),
      )
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [definition])

  async function commitDraftValue() {
    const currentState = syncEquivalentDraftToConfigCenterPublicTextField(stateRef.current)

    if (currentState.status === 'saving') {
      return
    }

    if (!shouldCommitConfigCenterPublicTextField(currentState)) {
      setState(currentState)
      return
    }

    const patchValue = normalizeConfigCenterPublicTextFieldValue(currentState.draftValue)
    setState(startSavingConfigCenterPublicTextField(currentState))

    const result = await applyConfigCenterPublicPatch(definition.createPatch(patchValue))

    if (result.ok) {
      setState((latestState) =>
        applyConfigCenterPublicTextFieldSaveSuccess(latestState, definition.readFromSnapshot(result.snapshot)),
      )
      return
    }

    setState((latestState) => applyConfigCenterPublicTextFieldFailure(latestState, result.error))
  }

  return {
    state,
    updateDraftValue(nextDraftValue: string) {
      setState((currentState) => applyDraftValueToConfigCenterPublicTextField(currentState, nextDraftValue))
    },
    commitDraftValue,
  }
}

function handleConfigCenterPublicTextFieldKeyDown(
  event: ReactKeyboardEvent<HTMLInputElement>,
  commitDraftValue: () => Promise<void>,
) {
  if (event.key !== 'Enter') {
    return
  }

  event.preventDefault()
  void commitDraftValue()
}
