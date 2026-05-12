/** @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { act } from 'react'
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

import { CopilotChatPanel } from './CopilotChatPanel'
import {
  clickElement,
  createDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
  getTriggerIconText,
  renderWithRoot,
  setFormControlValue,
  submitForm,
} from './CopilotChatPanel.test-support'
import { createPersistedWorkspaceState, createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'
import {
  // Constants
  LABEL_CLAUDE,
  LABEL_HTTP_127,
  LABEL_OPENAI_COMPATIBLE,
  LABEL_OPENAI_GPT,
  LABEL_PROVIDER_BETA,
  LABEL_PROVIDER_MODEL,
  LABEL_PROVIDER_OPENAI,
  LABEL_PROVIDER_OPENAI_OPENAI,
  LABEL_SHARED_MODEL,
  LABEL_TEXTAREA_NAME_MESSAGETEXT,
  SELECTOR_CHAT_COMPOSER_DOCK,
  SELECTOR_CHAT_COMPOSER_SEND,
  SELECTOR_CHAT_MODEL_PICKER,
  // Lifecycle helpers
  restoreNotificationApi,
  restoreAttachmentManagerApi,
  // Helper functions
  createResolvedSendMessageSpy,
  createPersistedWorkspaceStateLoader,
} from './CopilotChatPanel.composer.test-support'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
})

afterEach(() => {
  restoreNotificationApi()
  restoreAttachmentManagerApi()
})

/* eslint-disable-next-line max-lines-per-function -- organizational wrapper for model picker test groups */
describe('CopilotChatPanel composer interactions', () => {
  /* eslint-disable-next-line max-lines-per-function -- three integration tests for model picker/routing scenarios, each requiring independent full render setup */
  describe('model picker and routing', () => {
  it('sends messages with the updated model selected from the picker', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: LABEL_PROVIDER_OPENAI,
            name: LABEL_OPENAI_COMPATIBLE,
            availableModels: [
              {
                id: LABEL_PROVIDER_OPENAI_OPENAI,
                modelId: LABEL_OPENAI_GPT,
                displayName: 'GPT 4.1',
                groupName: 'OpenAI',
                capabilities: ['reasoning', 'tools'],
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
            ],
          }),
          createProviderProfile({
            id: LABEL_PROVIDER_BETA,
            name: 'Beta Router',
            protocol: 'openai',
            availableModels: [
              {
                id: 'provider-beta:openai/gpt-4.1-mini',
                modelId: 'openai/gpt-4.1-mini',
                displayName: 'GPT 4.1 Mini',
                groupName: 'Beta',
                capabilities: ['reasoning', 'tools'],
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
            ],
          }),
        ],
        defaultModelRouting: {
          primaryAssistantModel: LABEL_OPENAI_GPT,
        },
      }),
    }))

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell()}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    const modelTrigger = rendered.getByTestId(SELECTOR_CHAT_MODEL_PICKER) as HTMLButtonElement

    expect(loadWorkspaceState).toHaveBeenCalledTimes(1)
    expect(modelTrigger.textContent).toContain('GPT 4.1')
    expect(getTriggerIconText(modelTrigger)).toBe('G')

    await clickElement(modelTrigger)
    expect(rendered.container.textContent).toContain(LABEL_OPENAI_COMPATIBLE)
    expect(rendered.container.textContent).toContain('Beta Router')
    await clickElement(rendered.getByTestId('chat-model-option-provider-beta-provider-beta:openai/gpt-4.1-mini'))

    expect(modelTrigger.textContent).toContain('GPT 4.1 Mini')
    expect(getTriggerIconText(modelTrigger)).toBe('G')

    await setFormControlValue(messageInput, '请总结刚才的内容')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      modelRoute: {
        routeRef: {
          routeKind: LABEL_PROVIDER_MODEL,
          profileId: LABEL_PROVIDER_BETA,
          modelId: 'openai/gpt-4.1-mini',
        },
      },
      message: {
        content: '请总结刚才的内容',
      },
    })

    rendered.unmount()
  })

  it('allows enabled anthropic routes to send without openai-compatible endpoint whitelists', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: 'provider-anthropic',
            name: 'Anthropic',
            providerId: 'anthropic',
            protocol: 'anthropic',
            endpoint: 'https://api.anthropic.com/',
            primaryModelId: LABEL_CLAUDE,
            fastModel: LABEL_CLAUDE,
            fallbackModel: LABEL_CLAUDE,
            availableModels: [
              {
                id: 'provider-anthropic:claude-3.7-sonnet',
                modelId: LABEL_CLAUDE,
                displayName: 'Claude 3.7 Sonnet',
                groupName: 'Anthropic',
                capabilities: ['reasoning', 'tools'],
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
            ],
          }),
        ],
        defaultModelRouting: {
          primaryAssistantModel: LABEL_CLAUDE,
        },
      }),
    }))

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell()}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const modelTrigger = rendered.getByTestId(SELECTOR_CHAT_MODEL_PICKER) as HTMLButtonElement
    const sendButton = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_SEND) as HTMLButtonElement
    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement

    expect(modelTrigger.textContent).toContain('Claude 3.7 Sonnet')
    await setFormControlValue(messageInput, '请用 Anthropic 路由发送这条消息')
    expect(sendButton.disabled).toBe(false)
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      modelRoute: {
        routeRef: {
          routeKind: LABEL_PROVIDER_MODEL,
          profileId: 'provider-anthropic',
          modelId: LABEL_CLAUDE,
        },
      },
      message: {
        content: '请用 Anthropic 路由发送这条消息',
      },
    })

    rendered.unmount()
  })

  it('restores the workspace default model from route ref only when duplicate model ids exist across profiles', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: 'provider-alpha',
            name: 'Alpha Provider',
            availableModels: [
              {
                id: 'provider-alpha:shared-model',
                modelId: LABEL_SHARED_MODEL,
                displayName: 'Shared Model Alpha',
                groupName: 'Alpha',
                capabilities: ['reasoning'],
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
            ],
          }),
          createProviderProfile({
            id: LABEL_PROVIDER_BETA,
            name: 'Beta Provider',
            providerId: 'groq',
            protocol: 'openai',
            availableModels: [
              {
                id: 'provider-beta:shared-model',
                modelId: LABEL_SHARED_MODEL,
                displayName: 'Shared Model Beta',
                groupName: 'Beta',
                capabilities: ['reasoning', 'tools'],
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
            ],
          }),
        ],
        defaultModelRouting: {
          primaryAssistantModel: LABEL_SHARED_MODEL,
          primaryAssistantModelRoute: {
            routeKind: LABEL_PROVIDER_MODEL,
            profileId: LABEL_PROVIDER_BETA,
            modelId: LABEL_SHARED_MODEL,
          },
        },
      }),
    }))

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell()}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    const modelTrigger = rendered.getByTestId(SELECTOR_CHAT_MODEL_PICKER) as HTMLButtonElement

    expect(modelTrigger.textContent).toContain('Shared Model Beta')

    await setFormControlValue(messageInput, '请使用稳定 route ref 默认模型发送')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      modelRoute: {
        routeRef: {
          routeKind: LABEL_PROVIDER_MODEL,
          profileId: LABEL_PROVIDER_BETA,
          modelId: LABEL_SHARED_MODEL,
        },
      },
    })

    rendered.unmount()
  })

  })
  /* eslint-disable-next-line max-lines-per-function -- three integration tests for model state edge cases, each requiring independent render setup */
  describe('model state edge cases', () => {
  it('forwards enabled debug mode from bootstrap state into chat send requests', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState({
          bootstrapFields: {
            runtimeUrl: LABEL_HTTP_127,
            agentName: null,
            debugModeEnabled: true,
          },
        })}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell()}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请总结刚才的内容')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]?.[0].debugModeEnabled).toBe(true)

    rendered.unmount()
  })

  it('does not recover ambiguous shared-model defaults from legacy strings in workspace or session state', async () => {
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: 'provider-alpha',
            name: 'Alpha Provider',
            availableModels: [
              {
                id: 'provider-alpha:shared-model',
                modelId: LABEL_SHARED_MODEL,
                displayName: 'Shared Model Alpha',
                groupName: 'Alpha',
                capabilities: ['reasoning', 'tools'],
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
            ],
          }),
          createProviderProfile({
            id: LABEL_PROVIDER_BETA,
            name: 'Beta Provider',
            providerId: 'groq',
            protocol: 'openai',
            availableModels: [
              {
                id: 'provider-beta:shared-model',
                modelId: LABEL_SHARED_MODEL,
                displayName: 'Shared Model Beta',
                groupName: 'Beta',
                capabilities: ['reasoning', 'tools'],
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
            ],
          }),
        ],
        defaultModelRouting: {
          primaryAssistantModel: LABEL_SHARED_MODEL,
          primaryAssistantModelRoute: null,
        },
      }),
    }))

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell()}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const modelTrigger = rendered.getByTestId(SELECTOR_CHAT_MODEL_PICKER) as HTMLButtonElement
    const sendButton = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_SEND) as HTMLButtonElement
    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement

    expect(modelTrigger.textContent).toContain('尚未配置模型')
    expect(rendered.queryByTestId('chat-model-picker-invalid-badge')).toBeNull()

    await setFormControlValue(messageInput, '请不要再靠同名字符串恢复默认模型')
    expect(sendButton.disabled).toBe(true)
    expect(sendButton.title).toBe('请先选择模型。')

    await clickElement(modelTrigger)
    expect(rendered.getByTestId('chat-model-option-provider-alpha-provider-alpha:shared-model')).not.toBeNull()
    expect(rendered.getByTestId('chat-model-option-provider-beta-provider-beta:shared-model')).not.toBeNull()

    rendered.unmount()
  })

  it('shows the explicit no-model empty state and clears session-level legacy string fallback when no configured models exist', async () => {
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'initialized-defaults' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [],
        defaultModelRouting: {
          primaryAssistantModel: '',
          fastAssistantModel: '',
        },
      }),
    }))

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell()}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const modelTrigger = rendered.getByTestId(SELECTOR_CHAT_MODEL_PICKER) as HTMLButtonElement
    const sendButton = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_SEND) as HTMLButtonElement

    expect(loadWorkspaceState).toHaveBeenCalledTimes(1)
    expect(modelTrigger.disabled).toBe(true)
    expect(modelTrigger.textContent).toContain('尚未配置模型')
    expect(modelTrigger.textContent).not.toContain(LABEL_OPENAI_GPT)
    expect(sendButton.disabled).toBe(true)
    expect(sendButton.title).toBe('尚未配置模型，请先前往设置页完成模型配置。')
    expect(rendered.getByTestId('chat-no-model-empty-state').textContent).toContain('尚未配置模型')
    expect(rendered.getByTestId('chat-no-model-empty-state').textContent).toContain('请先前往设置页添加模型服务商和模型。')

    rendered.unmount()
  })

  })
})
