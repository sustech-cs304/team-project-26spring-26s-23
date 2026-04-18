/** @vitest-environment jsdom */

import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  clickElement,
  createPersistedSecretStatesResult,
  createPersistedWorkspaceState,
  createProviderProfile,
  createSingleProviderWorkspaceState,
  flushAsyncEffects,
  installSettingsWorkspaceBridge,
  renderSettingsWorkspace,
  setFormControlValue,
  waitForNextFrame,
} from './test-support/SettingsWorkspaceTestSupport'
import {
  runDeleteActiveProviderScenario,
  runDuplicateProviderScenario,
  runExtensionBannerHiddenScenario,
  runLegacyProviderWarningScenario,
  runOllamaGuidanceCleanupScenario,
  runProviderModelEditorFocusScenario,
} from './test-support/provider-profiles/settings-workspace-provider-detail-scenarios'
import { runProviderReorderScenario } from './test-support/provider-profiles/settings-workspace-provider-reorder-scenario'

describe('SettingsWorkspace provider interactions', () => {
  it('keeps focus in the model name field while editing the model dialog', async () => {
    await runProviderModelEditorFocusScenario()
  })

  it('adds a provider from the empty state without injecting a default base URL and shows the empty preview state', async () => {
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

    const baseUrlInput = rendered.getByTestId('provider-base-url-input') as HTMLInputElement
    expect(addedProviderCard?.textContent).toContain('OpenAI')
    expect((rendered.getByTestId('provider-display-name-input') as HTMLInputElement).value).toBe('OpenAI')
    expect(baseUrlInput.value).toBe('')
    expect(baseUrlInput.placeholder).toBe('https://api.openai.com/v1')
    expect(rendered.container.textContent).toContain('链接预览：未填写服务地址')
    expect(rendered.getByTestId('provider-base-url-feedback').textContent).toBe('未填写服务地址')

    rendered.unmount()
  })

  it('renders the active provider detail and supports duplicating a provider from the context menu', async () => {
    await runDuplicateProviderScenario()
  })

  it('removes redundant provider guidance copy while keeping ollama controls editable', async () => {
    await runOllamaGuidanceCleanupScenario()
  })

  it('hides retained provider extension notices from the detail form', async () => {
    await runExtensionBannerHiddenScenario()
  })

  it('keeps legacy unsupported providers visible and shows compatibility warnings from the settings page', async () => {
    await runLegacyProviderWarningScenario()
  })

  it('deletes the active provider and shows the empty state when no providers remain', async () => {
    await runDeleteActiveProviderScenario()
  })

  it('keeps the API 地址 field editable and renders openai-compatible request previews without hiding duplicated paths', async () => {
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
    expect(rendered.container.textContent).toContain('链接预览：https://persisted.example.com/v1/chat/completions')

    const apiAddressInput = rendered.getByTestId('provider-base-url-input') as HTMLInputElement
    expect(apiAddressInput.placeholder).toBe('https://api.openai.com/v1')
    await setFormControlValue(apiAddressInput, 'https://editable.example.com/v2/chat/completions')

    expect(apiAddressInput.value).toBe('https://editable.example.com/v2/chat/completions')
    expect(rendered.container.textContent).toContain('链接预览：https://editable.example.com/v2/chat/completions/chat/completions')
    expect(apiAddressInput.closest('.form-field')?.className).toContain('form-field--full')

    rendered.unmount()
  })

  it('treats provider base url as required and skips auto-save when the field is blank', async () => {
    vi.useFakeTimers()

    const { saveState } = installSettingsWorkspaceBridge({
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

    const apiAddressInput = rendered.getByTestId('provider-base-url-input') as HTMLInputElement
    await setFormControlValue(apiAddressInput, '')

    expect(apiAddressInput.value).toBe('')
    expect(rendered.getByTestId('provider-base-url-feedback').textContent).toBe('未填写服务地址')
    expect(rendered.container.textContent).toContain('链接预览：未填写服务地址')

    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    expect(saveState).not.toHaveBeenCalled()

    rendered.unmount()
  })

  it('renders gemini-native request previews with the selected default model id', async () => {
    const geminiProvider = createProviderProfile({
      id: 'provider-gemini',
      profileId: 'provider-gemini',
      providerId: 'gemini',
      protocol: 'gemini',
      name: 'Gemini Mirror',
      displayName: 'Gemini Mirror',
      endpoint: 'https://api.ikuncode.cc/v1beta',
      baseUrl: 'https://api.ikuncode.cc/v1beta',
      hasApiKey: false,
      primaryModelId: 'gemini-3.1-pro-preview',
      fastModel: 'gemini-3.1-pro-preview',
      fallbackModel: 'gemini-3.1-pro-preview',
    })

    installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: createPersistedWorkspaceState({
          providerProfiles: [geminiProvider],
          defaultModelRouting: {
            primaryAssistantModel: 'gemini-3.1-pro-preview',
            primaryAssistantModelRoute: {
              routeKind: 'provider-model',
              profileId: 'provider-gemini',
              modelId: 'gemini-3.1-pro-preview',
            },
          },
        }),
      },
      loadStatusesResult: {
        ok: true,
        states: {
          'provider-gemini': {
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

    expect(rendered.container.textContent).toContain(
      '链接预览：https://api.ikuncode.cc/v1beta/models/gemini-3.1-pro-preview:generateContent',
    )

    rendered.unmount()
  })

  it('reorders providers from drag interaction and persists the reordered list', async () => {
    await runProviderReorderScenario()
  })
})
