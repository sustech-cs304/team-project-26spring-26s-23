import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  applyConfigCenterPublicTextFieldFailure,
  applyConfigCenterPublicTextFieldSaveSuccess,
  applyDraftValueToConfigCenterPublicTextField,
  applyExternalSnapshotToConfigCenterPublicTextField,
  AssistantBehaviorConfigCard,
  createConfigCenterPublicTextFieldState,
  createLoadingConfigCenterPublicTextFieldState,
  getConfigCenterPublicTextFieldStatusView,
  HostConfigRuntimeOverrideCard,
  normalizeConfigCenterPublicTextFieldValue,
  shouldCommitConfigCenterPublicTextField,
  startSavingConfigCenterPublicTextField,
} from './ConfigCenterPublicFieldCards'

describe('ConfigCenterPublicFieldCards', () => {
  it('renders assistant behavior and development runtime override cards with explicit semantics', () => {
    const html = renderToStaticMarkup(
      <>
        <AssistantBehaviorConfigCard />
        <HostConfigRuntimeOverrideCard />
      </>,
    )

    expect(html).toContain('Assistant 行为配置')
    expect(html).toContain('默认 Agent 名称')
    expect(html).toContain('宿主配置（开发态）')
    expect(html).toContain('开发态运行时覆盖地址')
    expect(html).toContain('不表示普通用户后端地址')
  })

  it('hydrates a loading field state from a loaded public snapshot value', () => {
    const loadingState = createLoadingConfigCenterPublicTextFieldState()

    expect(loadingState.status).toBe('loading')

    expect(applyExternalSnapshotToConfigCenterPublicTextField(loadingState, 'planner')).toEqual({
      syncedValue: 'planner',
      draftValue: 'planner',
      dirty: false,
      status: 'idle',
      error: null,
    })
  })

  it('commits a dirty draft through the saving and saved states', () => {
    const idleState = createConfigCenterPublicTextFieldState('campus-agent')
    const draftState = applyDraftValueToConfigCenterPublicTextField(idleState, '  planner  ')

    expect(draftState.dirty).toBe(true)
    expect(shouldCommitConfigCenterPublicTextField(draftState)).toBe(true)
    expect(normalizeConfigCenterPublicTextFieldValue(draftState.draftValue)).toBe('planner')

    const savingState = startSavingConfigCenterPublicTextField(draftState)
    const savedState = applyConfigCenterPublicTextFieldSaveSuccess(savingState, 'planner')

    expect(savingState.status).toBe('saving')
    expect(savedState).toEqual({
      syncedValue: 'planner',
      draftValue: 'planner',
      dirty: false,
      status: 'saved',
      error: null,
    })
  })

  it('surfaces failure details through the field status view', () => {
    const failedState = applyConfigCenterPublicTextFieldFailure(
      createConfigCenterPublicTextFieldState('campus-agent'),
      'save failed',
    )

    expect(failedState.status).toBe('error')
    expect(getConfigCenterPublicTextFieldStatusView(failedState)).toEqual({
      badgeClassName: 'inline-badge--warning',
      badgeLabel: '保存失败',
      detail: 'save failed',
      role: 'alert',
    })
  })

  it('keeps a local draft when an external refresh arrives with a different synced value', () => {
    const dirtyState = applyDraftValueToConfigCenterPublicTextField(
      createConfigCenterPublicTextFieldState('campus-agent'),
      'planner',
    )

    expect(applyExternalSnapshotToConfigCenterPublicTextField(dirtyState, 'runtime-agent')).toEqual({
      syncedValue: 'runtime-agent',
      draftValue: 'planner',
      dirty: true,
      status: 'idle',
      error: null,
    })
  })
})
