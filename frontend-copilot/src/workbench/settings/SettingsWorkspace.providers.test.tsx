/** @vitest-environment jsdom */

import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  clickElement,
  contextMenuElement,
  createPersistedWorkspaceState,
  createPersistedSecretStatesResult,
  createProviderProfile,
  createSingleProviderWorkspaceState,
  flushAsyncEffects,
  installSettingsWorkspaceBridge,
  mockButtonRect,
  mockListItemRect,
  renderSettingsWorkspace,
  setFormControlValue,
  waitForNextFrame,
} from './SettingsWorkspace.test-support'

describe('SettingsWorkspace provider interactions', () => {
  it('keeps focus in the model name field while editing the model dialog', async () => {
    installSettingsWorkspaceBridge()

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()
    await clickElement(rendered.getByText('添加模型'))

    const modelNameInput = rendered.getByPlaceholder('例如 Gemini 2.5 Pro') as HTMLInputElement
    modelNameInput.focus()
    expect(document.activeElement).toBe(modelNameInput)

    await setFormControlValue(modelNameInput, '12345')
    await waitForNextFrame()

    expect(modelNameInput.value).toBe('12345')
    expect(document.activeElement).toBe(modelNameInput)

    rendered.unmount()
  })

  it('adds a provider from the empty state and activates its detail form', async () => {
    installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: createPersistedWorkspaceState({
          providerProfiles: [],
        }),
      },
      loadStatusesResult: {
        ok: true,
        states: {},
      },
    })

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()

    expect(rendered.container.textContent).toContain('可在左侧添加服务商信息')

    await clickElement(rendered.getByText('添加'))

    expect(rendered.getByTestId('settings-provider-card-custom-provider-1').textContent).toContain('Custom Provider 1')
    expect((rendered.getByPlaceholder('输入服务商名称') as HTMLInputElement).value).toBe('Custom Provider 1')

    rendered.unmount()
  })

  it('renders the active provider detail and supports duplicating a provider from the context menu', async () => {
    const persistedState = createPersistedWorkspaceState()
    const { saveProviderApiKey } = installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: persistedState,
      },
      loadStatusesResult: createPersistedSecretStatesResult('persisted-secret', 'openrouter'),
      saveProviderApiKeyResult: {
        ok: true,
        providerId: 'persisted-router-1',
        state: {
          hasApiKey: true,
          apiKey: 'persisted-secret',
        },
      },
    })

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()

    const providerNameInput = rendered.getByPlaceholder('输入服务商名称') as HTMLInputElement
    expect(providerNameInput.value).toBe('Persisted Router')

    await contextMenuElement(rendered.getByTestId('settings-provider-card-openrouter'))
    await clickElement(rendered.getByText('复制服务商'))

    expect(saveProviderApiKey).toHaveBeenCalledWith({
      providerId: 'persisted-router-1',
      apiKey: 'persisted-secret',
    })

    const copiedProviderCard = rendered.getByTestId('settings-provider-card-persisted-router-1')
    expect(copiedProviderCard.textContent).toContain('Persisted Router 副本')
    expect((rendered.getByPlaceholder('输入服务商名称') as HTMLInputElement).value).toBe('Persisted Router 副本')

    rendered.unmount()
  })

  it('deletes the active provider and shows the empty state when no providers remain', async () => {
    const { clearProviderApiKey } = installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: createSingleProviderWorkspaceState(),
      },
      loadStatusesResult: createPersistedSecretStatesResult(),
      clearProviderApiKeyResult: {
        ok: true,
        providerId: 'openrouter',
        state: {
          hasApiKey: false,
          apiKey: '',
        },
      },
    })

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()

    await contextMenuElement(rendered.getByTestId('settings-provider-card-openrouter'))
    await clickElement(rendered.getByText('删除服务商'))

    expect(clearProviderApiKey).toHaveBeenCalledWith({
      providerId: 'openrouter',
    })
    expect(rendered.queryByTestId('settings-provider-card-openrouter')).toBeNull()
    expect(rendered.container.textContent).toContain('可在左侧添加服务商信息')

    rendered.unmount()
  })

  it('reorders providers from drag interaction and persists the reordered list', async () => {
    vi.useFakeTimers()

    const alphaProvider = createProviderProfile({
      id: 'provider-a',
      name: 'Alpha Provider',
      endpoint: 'https://alpha.example.com/v1',
    })
    const betaProvider = createProviderProfile({
      id: 'provider-b',
      name: 'Beta Provider',
      protocol: 'gemini',
      endpoint: 'https://beta.example.com/v1',
      hasApiKey: false,
      defaultModel: 'google/gemini-2.5-pro',
      fastModel: 'google/gemini-2.5-flash',
      fallbackModel: 'google/gemini-2.0-flash',
    })
    const { saveState } = installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: createPersistedWorkspaceState({
          providerProfiles: [alphaProvider, betaProvider],
        }),
      },
      loadStatusesResult: {
        ok: true,
        states: {
          'provider-a': {
            hasApiKey: true,
            apiKey: 'alpha-secret',
          },
          'provider-b': {
            hasApiKey: false,
            apiKey: '',
          },
        },
      },
    })

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()

    mockListItemRect(rendered.getByTestId('settings-provider-list-item-provider-a'), 0)
    mockListItemRect(rendered.getByTestId('settings-provider-list-item-provider-b'), 60)
    mockButtonRect(rendered.getByTestId('settings-provider-card-provider-a'))

    await act(async () => {
      rendered.getByTestId('settings-provider-card-provider-a').dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      )
    })

    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 12, clientY: 92 }))
      await Promise.resolve()
    })

    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 12, clientY: 92 }))
      await Promise.resolve()
    })

    const providerItems = Array.from(
      rendered.container.querySelectorAll<HTMLElement>('[data-testid^="settings-provider-list-item-"]'),
    )
    expect(providerItems[0]?.textContent).toContain('Beta Provider')
    expect(providerItems[1]?.textContent).toContain('Alpha Provider')

    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    const lastSaveCall = saveState.mock.calls[saveState.mock.calls.length - 1]?.[0]
    expect(lastSaveCall?.providerProfiles.map((profile) => profile.id)).toEqual(['provider-b', 'provider-a'])

    rendered.unmount()
  })
})
