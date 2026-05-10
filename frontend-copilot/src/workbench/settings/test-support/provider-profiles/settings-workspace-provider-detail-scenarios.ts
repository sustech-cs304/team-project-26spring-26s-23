import { act } from 'react'
import { expect, vi } from 'vitest'

import {
  clickElement,
  contextMenuElement,
  createPersistedSecretStatesResult,
  createPersistedWorkspaceState,
  createProviderProfile,
  createSingleProviderWorkspaceState,
  flushAsyncEffects,
  installSettingsWorkspaceBridge,
  renderSettingsWorkspace,
  setFormControlValue,
  waitForNextFrame,
} from '../SettingsWorkspaceTestSupport'

const MODEL_SERVICE_SECTION = 'model-service'
const PROVIDER_BASE_URL_INPUT_ID = 'provider-base-url-input'
const PROVIDER_DISPLAY_NAME_INPUT_ID = 'provider-display-name-input'
const PROVIDER_CONTEXT_MENU_ID = 'provider-context-menu'

export async function runProviderModelEditorFocusScenario() {
  installSettingsWorkspaceBridge()

  const rendered = renderSettingsWorkspace({
    initialSection: MODEL_SERVICE_SECTION,
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
}

export async function runAddProviderFromEmptyStateScenario() {
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
    initialSection: MODEL_SERVICE_SECTION,
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

  const baseUrlInput = rendered.getByTestId(PROVIDER_BASE_URL_INPUT_ID) as HTMLInputElement
  expect(addedProviderCard?.textContent).toContain('OpenAI')
  expect((rendered.getByTestId(PROVIDER_DISPLAY_NAME_INPUT_ID) as HTMLInputElement).value).toBe('OpenAI')
  expect(baseUrlInput.value).toBe('')
  expect(baseUrlInput.placeholder).toBe('https://api.openai.com/v1')
  expect(rendered.container.textContent).toContain('链接预览：未填写服务地址')
  expect(rendered.getByTestId('provider-base-url-feedback').textContent).toBe('未填写服务地址')

  rendered.unmount()
}

export async function runDuplicateProviderScenario() {
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
    initialSection: MODEL_SERVICE_SECTION,
  })

  await flushAsyncEffects()

  const providerNameInput = rendered.getByTestId(PROVIDER_DISPLAY_NAME_INPUT_ID) as HTMLInputElement
  expect(providerNameInput.value).toBe('Persisted Router')

  await contextMenuElement(rendered.getByTestId('settings-provider-card-openrouter'))
  expect(rendered.getByTestId(PROVIDER_CONTEXT_MENU_ID)).not.toBeNull()
  await clickElement(rendered.getByText('复制服务商'))
  expect(rendered.queryByTestId(PROVIDER_CONTEXT_MENU_ID)).toBeNull()

  expect(saveProfileApiKey).toHaveBeenCalledWith({
    profileId: 'persisted-router-1',
    apiKey: 'persisted-secret',
  })

  const copiedProviderCard = rendered.getByTestId('settings-provider-card-persisted-router-1')
  expect(copiedProviderCard.textContent).toContain('Persisted Router 副本')
  expect((rendered.getByTestId(PROVIDER_DISPLAY_NAME_INPUT_ID) as HTMLInputElement).value).toBe('Persisted Router 副本')

  rendered.unmount()
}

export async function runOllamaGuidanceCleanupScenario() {
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
    initialSection: MODEL_SERVICE_SECTION,
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
  expect(rendered.container.textContent).toContain('链接预览：http://127.0.0.1:11434/v1/chat/completions')
  expect((rendered.getByTestId(PROVIDER_BASE_URL_INPUT_ID) as HTMLInputElement).value).toBe('http://127.0.0.1:11434/v1')

  rendered.unmount()
}

export async function runExtensionBannerHiddenScenario() {
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
    initialSection: MODEL_SERVICE_SECTION,
  })

  await flushAsyncEffects()

  expect((rendered.getByTestId(PROVIDER_DISPLAY_NAME_INPUT_ID) as HTMLInputElement).value).toBe('Extended Provider')
  expect(rendered.queryByTestId('provider-extension-banner')).toBeNull()
  expect(rendered.container.textContent).not.toContain('附加信息')
  expect(rendered.container.textContent).not.toContain('当前服务包含附加信息，保存时会一并保留。')

  rendered.unmount()
}

export async function runLegacyProviderWarningScenario() {
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
    initialSection: MODEL_SERVICE_SECTION,
  })

  await flushAsyncEffects()

  expect(rendered.getByTestId('settings-provider-status-legacy-provider').textContent).toContain('当前服务不可用')
  expect(rendered.getByTestId('provider-status-banner').textContent).toContain('请重新选择服务类型或检查配置。')
  expect(rendered.container.textContent).not.toContain('在这里管理可用的模型服务。')

  rendered.unmount()
}

export async function runDeleteActiveProviderScenario() {
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
    initialSection: MODEL_SERVICE_SECTION,
  })

  await flushAsyncEffects()

  await contextMenuElement(rendered.getByTestId('settings-provider-card-openrouter'))
  expect(rendered.getByTestId(PROVIDER_CONTEXT_MENU_ID)).not.toBeNull()
  await clickElement(rendered.getByText('删除服务商'))
  expect(rendered.queryByTestId(PROVIDER_CONTEXT_MENU_ID)).toBeNull()

  expect(clearProfileApiKey).toHaveBeenCalledWith({
    profileId: 'openrouter',
  })
  expect(rendered.queryByTestId('settings-provider-card-openrouter')).toBeNull()
  expect(rendered.container.textContent).toContain('可在左侧添加服务商信息')

  rendered.unmount()
}

export async function runProviderBaseUrlRequiredScenario() {
  vi.useFakeTimers()

  try {
    const { saveState } = installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: createSingleProviderWorkspaceState(),
      },
      loadStatusesResult: createPersistedSecretStatesResult(),
    })

    const rendered = renderSettingsWorkspace({
      initialSection: MODEL_SERVICE_SECTION,
    })

    await flushAsyncEffects()

    const apiAddressInput = rendered.getByTestId(PROVIDER_BASE_URL_INPUT_ID) as HTMLInputElement
    await setFormControlValue(apiAddressInput, '')

    expect(apiAddressInput.value).toBe('')
    expect(rendered.getByTestId('provider-base-url-feedback').textContent).toBe('未填写服务地址')
    expect(rendered.container.textContent).toContain('链接预览：未填写服务地址')

    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    expect(saveState).not.toHaveBeenCalled()

    rendered.unmount()
  } finally {
    vi.useRealTimers()
  }
}

export async function runGeminiRequestPreviewScenario() {
  const GEMINI_MODEL_ID = 'gemini-3.1-pro-preview'
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
    primaryModelId: GEMINI_MODEL_ID,
    fastModel: GEMINI_MODEL_ID,
    fallbackModel: GEMINI_MODEL_ID,
  })

  installSettingsWorkspaceBridge({
    loadStateResult: {
      ok: true,
      source: 'stored',
      state: createPersistedWorkspaceState({
        providerProfiles: [geminiProvider],
        defaultModelRouting: {
          primaryAssistantModel: GEMINI_MODEL_ID,
          primaryAssistantModelRoute: {
            routeKind: 'provider-model',
            profileId: 'provider-gemini',
            modelId: GEMINI_MODEL_ID,
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
    initialSection: MODEL_SERVICE_SECTION,
  })

  await flushAsyncEffects()

  expect(rendered.container.textContent).toContain(
    `链接预览：https://api.ikuncode.cc/v1beta/models/${GEMINI_MODEL_ID}:generateContent`,
  )

  rendered.unmount()
}

export async function runApiAddressFieldScenario() {
  installSettingsWorkspaceBridge({
    loadStateResult: {
      ok: true,
      source: 'stored',
      state: createSingleProviderWorkspaceState(),
    },
    loadStatusesResult: createPersistedSecretStatesResult(),
  })

  const rendered = renderSettingsWorkspace({
    initialSection: MODEL_SERVICE_SECTION,
  })

  await flushAsyncEffects()

  expect(rendered.container.textContent).not.toContain('默认模型 ID')
  expect(rendered.container.querySelector('input[placeholder="例如 openai/gpt-4.1"]')).toBeNull()
  expect(rendered.container.textContent).toContain('链接预览：https://persisted.example.com/v1/chat/completions')

  const apiAddressInput = rendered.getByTestId(PROVIDER_BASE_URL_INPUT_ID) as HTMLInputElement
  expect(apiAddressInput.placeholder).toBe('https://api.openai.com/v1')
  await setFormControlValue(apiAddressInput, 'https://editable.example.com/v2/chat/completions')

  expect(apiAddressInput.value).toBe('https://editable.example.com/v2/chat/completions')
  expect(rendered.container.textContent).toContain('链接预览：https://editable.example.com/v2/chat/completions/chat/completions')
  expect(apiAddressInput.closest('.form-field')?.className).toContain('form-field--full')

  rendered.unmount()
}
