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

  it('adds a provider from the empty state using catalog-backed defaults and activates its detail form', async () => {
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
    await flushAsyncEffects()
    await flushAsyncEffects()

    expect(rendered.container.textContent).toContain('可在左侧添加服务商信息')

    const addProviderButton = rendered.container.querySelector('.settings-provider-add-row .secondary-button')
    if (!(addProviderButton instanceof HTMLButtonElement)) {
      throw new Error('Missing add provider button')
    }

    await clickElement(addProviderButton)

    let addedProviderCard = rendered.container.querySelector('[data-testid="settings-provider-card-openai-1"]') as HTMLElement | null
    for (let attempt = 0; attempt < 5 && addedProviderCard === null; attempt += 1) {
      await flushAsyncEffects()
      await waitForNextFrame()
      addedProviderCard = rendered.container.querySelector('[data-testid="settings-provider-card-openai-1"]') as HTMLElement | null
    }

    expect(addedProviderCard?.textContent).toContain('OpenAI')
    expect((rendered.getByTestId('provider-display-name-input') as HTMLInputElement).value).toBe('OpenAI')
    expect((rendered.getByTestId('provider-base-url-input') as HTMLInputElement).value).toBe('https://api.openai.com/v1')

    rendered.unmount()
  })

  it('renders the active provider detail and supports duplicating a provider from the context menu', async () => {
    const persistedState = createPersistedWorkspaceState()
    const { saveProfileApiKey } = installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: persistedState,
      },
      loadStatusesResult: createPersistedSecretStatesResult('persisted-secret', 'openrouter'),
      saveProfileApiKeyResult: {
        ok: true,
        profileId: 'persisted-router-1',
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

    const providerNameInput = rendered.getByTestId('provider-display-name-input') as HTMLInputElement
    expect(providerNameInput.value).toBe('Persisted Router')

    await contextMenuElement(rendered.getByTestId('settings-provider-card-openrouter'))
    expect(rendered.getByTestId('provider-context-menu')).not.toBeNull()
    await clickElement(rendered.getByText('复制服务商'))
    expect(rendered.queryByTestId('provider-context-menu')).toBeNull()

    expect(saveProfileApiKey).toHaveBeenCalledWith({
      profileId: 'persisted-router-1',
      apiKey: 'persisted-secret',
    })

    const copiedProviderCard = rendered.getByTestId('settings-provider-card-persisted-router-1')
    expect(copiedProviderCard.textContent).toContain('Persisted Router 副本')
    expect((rendered.getByTestId('provider-display-name-input') as HTMLInputElement).value).toBe('Persisted Router 副本')

    rendered.unmount()
  })

  it('removes redundant provider guidance copy while keeping ollama controls editable', async () => {
    installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: createPersistedWorkspaceState({
          providerProfiles: [createProviderProfile({
            id: 'local-ollama',
            profileId: 'local-ollama',
            providerId: 'ollama',
            protocol: 'ollama',
            name: 'Local Ollama',
            displayName: 'Local Ollama',
            endpoint: 'http://127.0.0.1:11434/v1',
            baseUrl: 'http://127.0.0.1:11434/v1',
            hasApiKey: false,
            primaryModelId: 'llama3.2',
            fastModel: 'llama3.2',
            fallbackModel: 'llama3.2',
            organization: '',
            region: '',
            notes: '',
          })],
        }),
      },
      loadStatusesResult: {
        ok: true,
        states: {
          'local-ollama': {
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

    expect(rendered.container.textContent).toContain('模型服务')
    expect(rendered.container.textContent).toContain('显示名称')
    expect(rendered.container.textContent).toContain('服务类型')
    expect(rendered.container.textContent).toContain('API 密钥（可选）')
    expect(rendered.container.textContent).toContain('模型列表管理')
    expect(rendered.container.textContent).not.toContain('在这里管理可用的模型服务。')
    expect(rendered.container.textContent).not.toContain('支持：流式、工具、视觉、推理')
    expect(rendered.container.textContent).not.toContain('可自定义显示名称，方便区分不同服务。')
    expect(rendered.container.textContent).not.toContain('请选择要使用的服务类型。')
    expect(rendered.container.textContent).not.toContain('本地 Ollama 默认无需 API Key')
    expect(rendered.container.textContent).not.toContain('可按需管理模型列表。')
    expect((rendered.getByTestId('provider-base-url-input') as HTMLInputElement).value).toBe('http://127.0.0.1:11434/v1')

    rendered.unmount()
  })

  it('hides retained provider extension notices from the detail form', async () => {
    installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: createPersistedWorkspaceState({
          providerProfiles: [createProviderProfile({
            id: 'provider-with-extensions',
            profileId: 'provider-with-extensions',
            providerId: 'openai',
            protocol: 'openai',
            name: 'Extended Provider',
            displayName: 'Extended Provider',
            endpoint: 'https://api.openai.com/v1',
            baseUrl: 'https://api.openai.com/v1',
            organization: 'org-1',
            region: 'apac',
            notes: 'retained note',
            extensions: {
              retainedMeta: 'value',
            },
          })],
        }),
      },
      loadStatusesResult: createPersistedSecretStatesResult('persisted-secret', 'provider-with-extensions'),
    })

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()

    expect((rendered.getByTestId('provider-display-name-input') as HTMLInputElement).value).toBe('Extended Provider')
    expect(rendered.queryByTestId('provider-extension-banner')).toBeNull()
    expect(rendered.container.textContent).not.toContain('附加信息')
    expect(rendered.container.textContent).not.toContain('当前服务包含附加信息，保存时会一并保留。')

    rendered.unmount()
  })

  it('keeps legacy unsupported providers visible and shows compatibility warnings from the settings page', async () => {
    installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: createPersistedWorkspaceState({
          providerProfiles: [createProviderProfile({
            id: 'legacy-provider',
            profileId: 'legacy-provider',
            providerId: 'legacy-provider',
            protocol: 'legacy-provider',
            name: 'Legacy Provider',
            displayName: 'Legacy Provider',
            endpoint: 'https://legacy.example.com/v1',
            baseUrl: 'https://legacy.example.com/v1',
            hasApiKey: false,
            primaryModelId: 'legacy-model',
            fastModel: 'legacy-model',
            fallbackModel: 'legacy-model',
            compatibility: {
              status: 'unsupported',
              reason: '历史 provider 不在当前 catalog 中，仅保留查看与迁移。',
            },
          })],
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

    expect(rendered.getByTestId('settings-provider-status-legacy-provider').textContent).toContain('当前服务不可用')
    expect(rendered.getByTestId('provider-status-banner').textContent).toContain('请重新选择服务类型或检查配置。')
    expect(rendered.container.textContent).not.toContain('在这里管理可用的模型服务。')

    rendered.unmount()
  })

  it('deletes the active provider and shows the empty state when no providers remain', async () => {
    const { clearProfileApiKey } = installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: createSingleProviderWorkspaceState(),
      },
      loadStatusesResult: createPersistedSecretStatesResult(),
      clearProfileApiKeyResult: {
        ok: true,
        profileId: 'openrouter',
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
    expect(rendered.getByTestId('provider-context-menu')).not.toBeNull()
    await clickElement(rendered.getByText('删除服务商'))
    expect(rendered.queryByTestId('provider-context-menu')).toBeNull()

    expect(clearProfileApiKey).toHaveBeenCalledWith({
      profileId: 'openrouter',
    })
    expect(rendered.queryByTestId('settings-provider-card-openrouter')).toBeNull()
    expect(rendered.container.textContent).toContain('可在左侧添加服务商信息')

    rendered.unmount()
  })

  it('keeps the API 地址 field editable and renders it with the full-width form-field layout', async () => {
    installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: createSingleProviderWorkspaceState(),
      },
      loadStatusesResult: createPersistedSecretStatesResult(),
    })

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()

    expect(rendered.container.textContent).not.toContain('默认模型 ID')
    expect(rendered.container.querySelector('input[placeholder="例如 openai/gpt-4.1"]')).toBeNull()

    const apiAddressInput = rendered.getByTestId('provider-base-url-input') as HTMLInputElement
    expect(apiAddressInput.placeholder).toBe('https://api.openai.com/v1')
    await setFormControlValue(apiAddressInput, 'https://editable.example.com/v2')

    expect(apiAddressInput.value).toBe('https://editable.example.com/v2')
    expect(apiAddressInput.closest('.form-field')?.className).toContain('form-field--full')

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
      providerId: 'gemini',
      protocol: 'gemini',
      endpoint: 'https://beta.example.com/v1',
      baseUrl: 'https://beta.example.com/v1',
      hasApiKey: false,
      primaryModelId: 'google/gemini-2.5-pro',
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
    expect(lastSaveCall?.providerProfiles.map((profile) => profile.profileId)).toEqual(['provider-b', 'provider-a'])

    rendered.unmount()
  })
})
