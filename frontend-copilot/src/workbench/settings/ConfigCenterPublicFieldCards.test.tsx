import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  applyConfigCenterPublicTextFieldFailure,
  applyConfigCenterPublicTextFieldSaveSuccess,
  applyDraftValueToConfigCenterPublicTextField,
  applyExternalSnapshotToConfigCenterPublicTextField,
  AssistantBehaviorConfigCard,
  BackendExposedModelConfigCard,
  createBackendExposedModelConfigCenterPublicPatch,
  createConfigCenterPublicTextFieldState,
  createLoadingConfigCenterPublicTextFieldState,
  getConfigCenterPublicTextFieldStatusView,
  HostConfigRuntimeOverrideCard,
  normalizeConfigCenterPublicTextFieldValue,
  readBackendExposedModelFromPublicSnapshot,
  shouldCommitConfigCenterPublicTextField,
  startSavingConfigCenterPublicTextField,
} from './ConfigCenterPublicFieldCards'

describe('ConfigCenterPublicFieldCards', () => {
  it('renders assistant behavior, backend model, and development runtime override cards with explicit semantics', () => {
    const html = renderToStaticMarkup(
      <>
        <AssistantBehaviorConfigCard />
        <BackendExposedModelConfigCard />
        <HostConfigRuntimeOverrideCard />
      </>,
    )

    expect(html).toContain('Assistant 行为配置')
    expect(html).toContain('默认 Agent 名称')
    expect(html).toContain('后端模型')
    expect(html).toContain('后端默认模型 ID')
    expect(html).toContain('保存后需重启整个程序生效')
    expect(html).toContain('需要重启整个程序')
    expect(html).toContain('宿主配置（开发态）')
    expect(html).toContain('开发态运行时覆盖地址')
    expect(html).toContain('不表示普通用户后端地址')
  })

  it('reads and writes backend model through the public snapshot and patch contract', () => {
    const snapshot = {
      version: 1 as const,
      domains: {
        frontendPreferences: {
          theme: 'light' as const,
          animationsEnabled: true,
        },
        assistantBehavior: {
          agentName: 'campus-agent',
        },
        hostConfig: {
          runtimeUrl: 'http://127.0.0.1:8765',
        },
        backendExposed: {
          model: 'openai/gpt-4.1',
        },
      },
    }

    expect(readBackendExposedModelFromPublicSnapshot(snapshot)).toBe('openai/gpt-4.1')
    expect(createBackendExposedModelConfigCenterPublicPatch('openai/gpt-4.1-mini')).toEqual({
      domains: {
        backendExposed: {
          model: 'openai/gpt-4.1-mini',
        },
      },
    })
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
    expect(getConfigCenterPublicTextFieldStatusView(savingState)).toEqual({
      badgeClassName: 'inline-badge--primary',
      badgeLabel: '保存中',
      detail: '正在通过配置中心公共补丁写入当前字段。',
      role: 'status',
    })
    expect(savedState).toEqual({
      syncedValue: 'planner',
      draftValue: 'planner',
      dirty: false,
      status: 'saved',
      error: null,
    })
    expect(getConfigCenterPublicTextFieldStatusView(savedState)).toEqual({
      badgeClassName: 'inline-badge--success',
      badgeLabel: '已保存',
      detail: '当前字段已写入配置中心。',
      role: 'status',
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
