/** @vitest-environment jsdom */

import { act } from 'react'
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

import { CopilotChatPanel } from './CopilotChatPanel'
import {
  cancelRuntimeRun,
  RuntimeRequestError,
  type RuntimeRunEvent,
} from './chat-contract'
import type { CopilotMessageDispatchInput } from './copilot-send-controller'
import {
  createRuntimeMessageEventStream,
  createRuntimeResolvedModelRoute,
  createRuntimeRunCancelResponse,
  createRuntimeToolEvent,
} from './chat-contract.test-support'
import {
  clickElement,
  createDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
  dragComposerResizeHandle,
  getTriggerIconText,
  pressTextareaKey,
  renderWithRoot,
  setFormControlValue,
  submitForm,
} from './CopilotChatPanel.test-support'
import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import { createPersistedWorkspaceState, createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'

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
})

describe('CopilotChatPanel composer interactions', () => {
  it('sends messages with the updated model selected from the picker', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: 'provider-openai',
            name: 'OpenAI Compatible',
            availableModels: [
              {
                id: 'provider-openai:openai/gpt-4.1',
                modelId: 'openai/gpt-4.1',
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
            id: 'provider-beta',
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
          primaryAssistantModel: 'openai/gpt-4.1',
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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    const modelTrigger = rendered.getByTestId('chat-model-picker-trigger') as HTMLButtonElement

    expect(loadWorkspaceState).toHaveBeenCalledTimes(1)
    expect(modelTrigger.textContent).toContain('GPT 4.1')
    expect(getTriggerIconText(modelTrigger)).toBe('G')

    await clickElement(modelTrigger)
    expect(rendered.container.textContent).toContain('OpenAI Compatible')
    expect(rendered.container.textContent).toContain('Beta Router')
    await clickElement(rendered.getByTestId('chat-model-option-provider-beta-provider-beta:openai/gpt-4.1-mini'))

    expect(modelTrigger.textContent).toContain('GPT 4.1 Mini')
    expect(getTriggerIconText(modelTrigger)).toBe('G')

    await setFormControlValue(messageInput, '请总结刚才的内容')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      modelRoute: {
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'provider-beta',
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
            primaryModelId: 'claude-3.7-sonnet',
            fastModel: 'claude-3.7-sonnet',
            fallbackModel: 'claude-3.7-sonnet',
            availableModels: [
              {
                id: 'provider-anthropic:claude-3.7-sonnet',
                modelId: 'claude-3.7-sonnet',
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
          primaryAssistantModel: 'claude-3.7-sonnet',
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

    const modelTrigger = rendered.getByTestId('chat-model-picker-trigger') as HTMLButtonElement
    const sendButton = rendered.getByTestId('chat-composer-send-button') as HTMLButtonElement
    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement

    expect(modelTrigger.textContent).toContain('Claude 3.7 Sonnet')
    await setFormControlValue(messageInput, '请用 Anthropic 路由发送这条消息')
    expect(sendButton.disabled).toBe(false)
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      modelRoute: {
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'provider-anthropic',
          modelId: 'claude-3.7-sonnet',
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
                modelId: 'shared-model',
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
            id: 'provider-beta',
            name: 'Beta Provider',
            providerId: 'groq',
            protocol: 'openai',
            availableModels: [
              {
                id: 'provider-beta:shared-model',
                modelId: 'shared-model',
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
          primaryAssistantModel: 'shared-model',
          primaryAssistantModelRoute: {
            routeKind: 'provider-model',
            profileId: 'provider-beta',
            modelId: 'shared-model',
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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    const modelTrigger = rendered.getByTestId('chat-model-picker-trigger') as HTMLButtonElement

    expect(modelTrigger.textContent).toContain('Shared Model Beta')

    await setFormControlValue(messageInput, '请使用稳定 route ref 默认模型发送')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      modelRoute: {
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'provider-beta',
          modelId: 'shared-model',
        },
      },
    })

    rendered.unmount()
  })

  it('forwards enabled debug mode from bootstrap state into chat send requests', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState({
          bootstrapFields: {
            runtimeUrl: 'http://127.0.0.1:8765',
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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请总结刚才的内容')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

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
                modelId: 'shared-model',
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
            id: 'provider-beta',
            name: 'Beta Provider',
            providerId: 'groq',
            protocol: 'openai',
            availableModels: [
              {
                id: 'provider-beta:shared-model',
                modelId: 'shared-model',
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
          primaryAssistantModel: 'shared-model',
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

    const modelTrigger = rendered.getByTestId('chat-model-picker-trigger') as HTMLButtonElement
    const sendButton = rendered.getByTestId('chat-composer-send-button') as HTMLButtonElement
    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement

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

    const modelTrigger = rendered.getByTestId('chat-model-picker-trigger') as HTMLButtonElement
    const sendButton = rendered.getByTestId('chat-composer-send-button') as HTMLButtonElement

    expect(loadWorkspaceState).toHaveBeenCalledTimes(1)
    expect(modelTrigger.disabled).toBe(true)
    expect(modelTrigger.textContent).toContain('尚未配置模型')
    expect(modelTrigger.textContent).not.toContain('openai/gpt-4.1')
    expect(sendButton.disabled).toBe(true)
    expect(sendButton.title).toBe('尚未配置模型，请先前往设置页完成模型配置。')
    expect(rendered.getByTestId('chat-no-model-empty-state').textContent).toContain('尚未配置模型')
    expect(rendered.getByTestId('chat-no-model-empty-state').textContent).toContain('请先前往设置页添加模型服务商和模型。')

    rendered.unmount()
  })

  it('submits on Enter and keeps newline behavior for Ctrl + Enter in the message composer', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '第一行')
    messageInput.focus()
    messageInput.setSelectionRange(messageInput.value.length, messageInput.value.length)

    await pressTextareaKey(messageInput, 'Enter', { ctrlKey: true })
    expect(sendMessage).toHaveBeenCalledTimes(0)
    expect(messageInput.value).toBe('第一行\n')

    await pressTextareaKey(messageInput, 'Enter')
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      message: {
        content: '第一行',
      },
    })
    expect(messageInput.value).toBe('')
    expect(document.activeElement).toBe(messageInput)

    rendered.unmount()
  })

  it('renders the bottom-anchored composer surface and updates height when the resize handle is dragged', async () => {
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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

    const scrollRegion = rendered.getByTestId('chat-message-scroll-region') as HTMLDivElement
    const resizeHandle = rendered.getByTestId('chat-composer-resize-handle') as HTMLDivElement
    const composerSurface = rendered.getByTestId('chat-composer-surface') as HTMLDivElement
    const sendButton = rendered.getByTestId('chat-composer-send-button') as HTMLButtonElement

    expect(scrollRegion.dataset.scrollbarVisibility).toBe('hidden')
    expect(scrollRegion.className).toContain('copilot-chat__stream--scrollbarless')
    expect(sendButton.parentElement).toBe(composerSurface)
    expect(composerSurface.className).toContain('copilot-chat__composer-surface--height-160')
    expect(composerSurface.getAttribute('style')).toBeNull()

    await dragComposerResizeHandle(resizeHandle, 420, 340)
    expect(composerSurface.className).toContain('copilot-chat__composer-surface--height-240')
    expect(composerSurface.getAttribute('style')).toBeNull()

    await dragComposerResizeHandle(resizeHandle, 340, 900)
    expect(composerSurface.className).toContain('copilot-chat__composer-surface--height-120')
    expect(composerSurface.getAttribute('style')).toBeNull()

    rendered.unmount()
  })

  it('supports searching and shortcut-updating message-level enabledTools through the tool picker', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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

    await clickElement(rendered.getByTestId('chat-tool-picker-trigger'))

    const searchInput = rendered.getByTestId('chat-tool-picker-search') as HTMLInputElement
    await setFormControlValue(searchInput, '远程')
    expect(rendered.queryByTestId('chat-tool-option-tool.remote-search')).not.toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-tool.file-convert')).toBeNull()

    await setFormControlValue(searchInput, '')
    await clickElement(rendered.getByTestId('chat-tool-picker-select-all'))
    await clickElement(rendered.getByTestId('chat-tool-picker-invert'))
    await clickElement(rendered.getByTestId('chat-tool-picker-select-recommended'))
    await clickElement(rendered.getByTestId('chat-tool-option-tool.remote-search'))

    expect(rendered.container.querySelector('input[type="checkbox"]')).toBeNull()

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请使用当前工具集执行摘要')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      enabledTools: ['tool.file-convert', 'tool.remote-search'],
      message: {
        content: '请使用当前工具集执行摘要',
      },
    })

    rendered.unmount()
  })

  it('echoes user and assistant messages after a successful send with model icon and model name in the assistant header', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: 'provider-openai',
            name: 'OpenAI Compatible',
            availableModels: [
              {
                id: 'provider-openai:openai/gpt-4.1',
                modelId: 'openai/gpt-4.1',
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
        ],
        defaultModelRouting: {
          primaryAssistantModel: 'openai/gpt-4.1',
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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请回显本条消息')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    const assistantHeader = rendered.getByTestId('chat-message-assistant-label-1')
    const assistantIcon = rendered.getByTestId('chat-message-assistant-icon-1')
    const renderedIcon = assistantIcon.querySelector('.copilot-model-picker__icon')

    expect(rendered.container.textContent).toContain('请回显本条消息')
    expect(rendered.container.textContent).not.toContain('助手响应')
    expect(rendered.container.textContent).toContain('这是助手回显')
    expect(assistantHeader.textContent).toContain('GPT 4.1')
    expect(renderedIcon?.textContent).toBe('G')
    expect(renderedIcon?.getAttribute('aria-label')).toBe('GPT 4.1 图标')
    expect(rendered.container.textContent).not.toContain('已完成')
    expect(rendered.container.querySelectorAll('.copilot-chat__message--assistant.copilot-chat__message--completed')).toHaveLength(1)

    rendered.unmount()
  })

  it('shows a system notification after the assistant completes when notifications are enabled', async () => {
    const notification = installMockDesktopNotification()
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        general: {
          assistantNotificationsEnabled: true,
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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请完成后通知我')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForCondition(() => notification.records.length === 1, 'assistant success notification emitted')

    expect(notification.records[0]).toEqual({
      title: '助手消息已完成',
      body: '这是助手回显',
      tag: 'run-1:completed',
    })

    rendered.unmount()
  })

  it('does not show a system notification when assistant notifications are disabled', async () => {
    const notification = installMockDesktopNotification()
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        general: {
          assistantNotificationsEnabled: false,
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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '通知保持关闭')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForText(rendered.container, '这是助手回显')
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(notification.records).toHaveLength(0)

    rendered.unmount()
  })

  it('shows a failure system notification after the assistant run fails when notifications are enabled', async () => {
    const notification = installMockDesktopNotification()
    const sendMessage = createToolFailureSendMessageSpy()
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        general: {
          assistantNotificationsEnabled: true,
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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '失败后通知我')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForCondition(() => notification.records.length === 1, 'assistant failure notification emitted')

    expect(notification.records[0]).toEqual({
      title: '助手消息已完成',
      body: '我可以解释工具失败并继续',
      tag: 'run-tool-failed:completed',
    })

    rendered.unmount()
  })

  it('swallows desktop notification delivery failures and logs a warning', async () => {
    const notificationError = new Error('notification bridge unavailable')
    const notification = installRejectingMockDesktopNotification(notificationError)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        general: {
          assistantNotificationsEnabled: true,
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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '即使通知失败也继续完成')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForText(rendered.container, '这是助手回显')
    await waitForCondition(() => warnSpy.mock.calls.length === 1, 'assistant notification failure handled')

    expect(notification.records).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[assistant-notification] Failed to show desktop notification.',
      notificationError,
    )

    warnSpy.mockRestore()
    rendered.unmount()
  })

  it('does not replay a historical notification when the notifications setting turns on after completion', async () => {
    const notification = installMockDesktopNotification()
    const sendMessage = createResolvedSendMessageSpy()
    const disabledLoader = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        general: {
          assistantNotificationsEnabled: false,
        },
      }),
    }))
    const enabledLoader = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        general: {
          assistantNotificationsEnabled: true,
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
        loadWorkspaceState={disabledLoader}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '先关闭，完成后再开启')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForText(rendered.container, '这是助手回显')
    expect(notification.records).toHaveLength(0)

    rendered.rerender(
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
        loadWorkspaceState={enabledLoader}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(notification.records).toHaveLength(0)

    rendered.unmount()
  })

  it('shows an assistant placeholder immediately after send with spinner feedback', async () => {
    const sendMessage = createStartOnlyPendingSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请先准备响应')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForCondition(
      () => rendered.queryByTestId('chat-assistant-placeholder') !== null,
      'assistant placeholder visible after send',
    )

    const placeholder = rendered.getByTestId('chat-assistant-placeholder')
    expect(placeholder.getAttribute('data-dismiss-reason')).toBe('pending')
    expect(rendered.getByTestId('chat-assistant-placeholder-spinner')).not.toBeNull()
    expect(placeholder.textContent).toContain('助手正在准备响应')
    expect(rendered.container.textContent).toContain('请先准备响应')

    rendered.unmount()
  })

  it('prefers transient send feedback over persisted history loading gating', async () => {
    const sendMessage = createStartOnlyPendingSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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
        sessionHistory={createLoadingPersistedHistoryState()}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).not.toBeNull()

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '历史恢复前先显示即时反馈')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    await waitForCondition(
      () => rendered.queryByTestId('chat-assistant-placeholder') !== null,
      'assistant placeholder visible while persisted detail still loading',
    )
    await waitForCondition(
      () => rendered.queryByTestId('chat-history-loading-skeleton') === null,
      'persisted loading skeleton hidden when transient content exists',
    )

    expect(rendered.getByTestId('chat-message-scroll-region').textContent).toContain('历史恢复前先显示即时反馈')
    expect(rendered.getByTestId('chat-assistant-placeholder').textContent).toContain('助手正在准备响应')

    rendered.unmount()
  })

  it('keeps transient conversation visible after history detail refresh if the selected persisted run is still empty', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()
    const sessionShell = createSessionShell()

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={sessionShell}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState()}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '你好')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForText(rendered.container, '这是助手回显')

    expect(rendered.getByTestId('chat-message-scroll-region').textContent).toContain('你好')
    expect(rendered.getByTestId('chat-message-scroll-region').textContent).toContain('这是助手回显')

    rendered.rerender(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={sessionShell}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState({
          hasLoadedDetail: true,
          detailStatus: 'ready',
          runSummaries: [
            {
              runId: 'run-1',
              threadId: 'session-1',
              status: 'completed',
              createdAt: '2026-04-14T08:00:00Z',
              updatedAt: '2026-04-14T08:00:03Z',
              startedAt: '2026-04-14T08:00:01Z',
              terminalAt: '2026-04-14T08:00:03Z',
              resolvedModelId: 'openai/gpt-4.1',
              requestedMessageText: '你好',
              assistantText: '这是助手回显',
            },
          ],
          timelineItems: [],
          replayStatus: 'idle',
          replay: null,
        })}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const scrollRegion = rendered.getByTestId('chat-message-scroll-region')
    expect(scrollRegion.textContent).toContain('你好')
    expect(scrollRegion.textContent).toContain('这是助手回显')
    expect(rendered.queryByTestId('chat-history-loading-skeleton')).toBeNull()
    expect(rendered.queryByTestId('chat-empty-state')).toBeNull()

    rendered.unmount()
  })

  it('keeps a late-settling run bound to its original session without polluting the current session view', async () => {
    const settleOldRun = createDeferredSignal()
    const onSessionRunSettled = vi.fn()
    const sendMessage = createDeferredResolvedSendMessageSpy(settleOldRun, {
      assistantText: '旧话题回复',
    })
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()
    const firstSessionShell = createSessionShell()

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={firstSessionShell}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState()}
        onSessionRunSettled={onSessionRunSettled}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '旧话题问题')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForCondition(
      () => rendered.queryByTestId('chat-assistant-placeholder') !== null,
      'old session placeholder visible before switching topics',
    )

    rendered.rerender(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell({ sessionId: 'session-2' })}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        onSessionRunSettled={onSessionRunSettled}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(rendered.container.textContent).not.toContain('旧话题问题')
    expect(rendered.container.textContent).not.toContain('旧话题回复')

    settleOldRun.release()
    await waitForCondition(
      () => onSessionRunSettled.mock.calls.length === 1,
      'late-settling run reported after switching to a new session',
    )

    expect(onSessionRunSettled).toHaveBeenCalledWith('run-1', 'session-1')
    expect(rendered.container.textContent).not.toContain('旧话题问题')
    expect(rendered.container.textContent).not.toContain('旧话题回复')
    expect(rendered.queryByTestId('chat-assistant-placeholder')).toBeNull()

    rendered.rerender(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={firstSessionShell}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState()}
        onSessionRunSettled={onSessionRunSettled}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await waitForText(rendered.container, '旧话题问题')
    expect(rendered.container.textContent).toContain('旧话题回复')

    rendered.unmount()
  })

  it('keeps session-scoped transient conversation after switching away and back before persisted replay becomes renderable', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()
    const firstSessionShell = createSessionShell()

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={firstSessionShell}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState()}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '你好')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForText(rendered.container, '这是助手回显')

    expect(rendered.getByTestId('chat-message-scroll-region').textContent).toContain('你好')
    expect(rendered.getByTestId('chat-message-scroll-region').textContent).toContain('这是助手回显')

    rendered.rerender(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell({ sessionId: 'session-2' })}
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

    rendered.rerender(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={firstSessionShell}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState({
          hasLoadedDetail: true,
          detailStatus: 'ready',
          runSummaries: [
            {
              runId: 'run-1',
              threadId: 'session-1',
              status: 'completed',
              createdAt: '2026-04-14T08:00:00Z',
              updatedAt: '2026-04-14T08:00:03Z',
              startedAt: '2026-04-14T08:00:01Z',
              terminalAt: '2026-04-14T08:00:03Z',
              resolvedModelId: 'openai/gpt-4.1',
              requestedMessageText: '你好',
              assistantText: '这是助手回显',
            },
          ],
          timelineItems: [],
          replayStatus: 'idle',
          replay: null,
        })}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(rendered.container.textContent).toContain('你好')
    expect(rendered.container.textContent).toContain('这是助手回显')
    expect(rendered.queryByTestId('chat-empty-state')).toBeNull()

    rendered.unmount()
  })

  it('emits debug handoff logs when retained transient state waits for persisted replay across a topic switch', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()
    const firstSessionShell = createSessionShell()

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState({
          bootstrapFields: {
            runtimeUrl: 'http://127.0.0.1:8765',
            agentName: null,
            debugModeEnabled: true,
          },
        })}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={firstSessionShell}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState()}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '你好')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForText(rendered.container, '这是助手回显')

    rendered.rerender(
      <CopilotChatPanel
        state={createReadyState({
          bootstrapFields: {
            runtimeUrl: 'http://127.0.0.1:8765',
            agentName: null,
            debugModeEnabled: true,
          },
        })}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell({ sessionId: 'session-2' })}
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

    rendered.rerender(
      <CopilotChatPanel
        state={createReadyState({
          bootstrapFields: {
            runtimeUrl: 'http://127.0.0.1:8765',
            agentName: null,
            debugModeEnabled: true,
          },
        })}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={firstSessionShell}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState({
          hasLoadedDetail: true,
          detailStatus: 'ready',
          runSummaries: [
            {
              runId: 'run-1',
              threadId: 'session-1',
              status: 'completed',
              createdAt: '2026-04-14T08:00:00Z',
              updatedAt: '2026-04-14T08:00:03Z',
              startedAt: '2026-04-14T08:00:01Z',
              terminalAt: '2026-04-14T08:00:03Z',
              resolvedModelId: 'openai/gpt-4.1',
              requestedMessageText: '你好',
              assistantText: '这是助手回显',
            },
          ],
          timelineItems: [],
          replayStatus: 'idle',
          replay: null,
        })}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const emittedDebugEntries = debugSpy.mock.calls
      .filter((call) => call[0] === '[copilot-debug]' && typeof call[1] === 'object' && call[1] !== null)
      .map((call) => call[1] as Record<string, unknown>)

    const matchingSettledLog = emittedDebugEntries.find((entry) => (
      entry.scope === 'copilot-chat-panel'
      && entry.event === 'run-settled-pending-history-sync'
      && entry.sessionId === 'session-1'
      && entry.transientSessionId === 'session-1'
      && entry.runId === 'run-1'
    ))
    const matchingForwardSwitchLog = emittedDebugEntries.find((entry) => (
      entry.scope === 'copilot-chat-panel'
      && entry.event === 'session-switch-retained-transient'
      && entry.previousSessionId === 'session-1'
      && entry.nextSessionId === 'session-2'
      && entry.previousTransientConversationLength === 1
    ))
    const matchingCommittedSyncLog = emittedDebugEntries.find((entry) => (
      entry.scope === 'copilot-chat-panel'
      && entry.event === 'pending-history-sync-committed'
      && entry.sessionId === 'session-1'
      && entry.pendingRunId === 'run-1'
      && entry.persistedConversationSource === 'summary'
    ))
    const matchingReturnSwitchLog = emittedDebugEntries.find((entry) => (
      entry.scope === 'copilot-chat-panel'
      && entry.event === 'session-switch-retained-transient'
      && entry.previousSessionId === 'session-2'
      && entry.nextSessionId === 'session-1'
      && entry.nextTransientConversationLength === 1
    ))
    const matchingWaitingLog = emittedDebugEntries.find((entry) => (
      entry.scope === 'copilot-chat-panel'
      && entry.event === 'pending-history-sync-waiting'
      && entry.sessionId === 'session-1'
      && entry.pendingRunId === 'run-1'
      && entry.waitReason === 'handoff-run-missing-from-detail'
    ))
 
    expect(matchingSettledLog).toBeDefined()
    expect(matchingForwardSwitchLog).toBeDefined()
    expect(matchingCommittedSyncLog).toBeDefined()
    expect(matchingReturnSwitchLog).toBeDefined()
    expect(matchingWaitingLog).toBeDefined()

    rendered.unmount()
  })

  it('removes the assistant placeholder when a tool card arrives before assistant text', async () => {
    const toolEventControl = createDeferredSignal()
    const sendMessage = createToolFirstPendingSendMessageSpy(toolEventControl)
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请先查天气再继续')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForCondition(
      () => rendered.queryByTestId('chat-assistant-placeholder') !== null,
      'assistant placeholder visible before tool card',
    )

    toolEventControl.release()

    await waitForText(rendered.container, '天气工具调用中')
    await waitForCondition(
      () => rendered.queryByTestId('chat-assistant-placeholder') === null,
      'assistant placeholder removed after tool card',
    )

    expect(rendered.getByTestId('chat-message-tool-spinner-1')).not.toBeNull()
    expect(rendered.queryByTestId('chat-message-tool-panel-1')).toBeNull()
    expect(rendered.container.textContent).not.toContain('正在获取 Shenzhen 的天气。')

    rendered.unmount()
  })

  it('fades out and removes the assistant placeholder after the first assistant text arrives', async () => {
    const sendMessage = createTextFirstPendingSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请直接回答')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForCondition(
      () => rendered.queryByTestId('chat-assistant-placeholder') !== null,
      'assistant placeholder visible before assistant text',
    )
    await waitForText(rendered.container, '这是助手回显')
    await waitForCondition(() => {
      const placeholder = rendered.queryByTestId('chat-assistant-placeholder') as HTMLElement | null
      return placeholder?.className.includes('copilot-chat__message--placeholder-fading') ?? false
    }, 'assistant placeholder fading after assistant text')
    await waitForCondition(
      () => rendered.queryByTestId('chat-assistant-placeholder') === null,
      'assistant placeholder removed after assistant text',
    )

    rendered.unmount()
  })

  it('does not keep the assistant placeholder after a terminal failure with no assistant text', async () => {
    const failureControl = createDeferredSignal()
    const sendMessage = createFailedBeforeAssistantSendMessageSpy(failureControl)
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请在失败前开始')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForCondition(
      () => rendered.queryByTestId('chat-assistant-placeholder') !== null,
      'assistant placeholder visible before failure',
    )

    failureControl.release()

    await waitForText(rendered.container, '发送失败')
    await waitForCondition(
      () => rendered.queryByTestId('chat-assistant-placeholder') === null,
      'assistant placeholder removed after failed run',
    )

    expect(rendered.container.textContent).toContain('工具执行失败，请重试。')
    expect(rendered.container.textContent).not.toContain('助手消息已完成')

    rendered.unmount()
  })

  it('does not keep the assistant placeholder after cancelling before any assistant text arrives', async () => {
    const sendMessage = createStartOnlyPendingSendMessageSpy()
    const cancelRun = vi.fn(async (): ReturnType<typeof cancelRuntimeRun> => createRuntimeRunCancelResponse({
      run: {
        runId: 'run-placeholder-pending',
        threadId: 'session-1',
        status: 'cancelling',
        createdAt: '2026-03-27T10:00:00Z',
        updatedAt: '2026-03-27T10:00:02Z',
        startedAt: '2026-03-27T10:00:01Z',
        terminalAt: null,
        cancelRequested: true,
      },
      cancelAccepted: true,
    }))
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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
        cancelRun={cancelRun}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请先开始然后取消')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForCondition(
      () => rendered.queryByTestId('chat-assistant-placeholder') !== null,
      'assistant placeholder visible before cancellation',
    )

    await clickElement(rendered.getByTestId('chat-composer-send-button'))
    await waitForText(rendered.container, '已取消')
    await waitForCondition(
      () => rendered.queryByTestId('chat-assistant-placeholder') === null,
      'assistant placeholder removed after cancellation',
    )

    expect(cancelRun).toHaveBeenCalledWith({
      runtimeUrl: 'http://127.0.0.1:8765',
      runId: 'run-placeholder-pending',
    })

    rendered.unmount()
  })

  it('renders tool lifecycle steps before assistant text and updates the same step on completion', async () => {
    const sendMessage = createToolLifecycleSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请先查询天气再回答')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForText(rendered.container, '天气工具被调用')

    const textContent = rendered.container.textContent ?? ''
    expect(textContent).toContain('这是助手回显')
    expect(textContent).not.toContain('正在获取 Shenzhen 的天气。')
    expect(textContent).not.toContain('Shenzhen：晴 / 24°C / 湿度 60%')
    expect(textContent).not.toContain('{"location":"Shenzhen"}')
    expect(textContent.indexOf('天气工具被调用')).toBeLessThan(textContent.indexOf('这是助手回显'))
    expect(rendered.queryByTestId('chat-message-tool-panel-1')).toBeNull()
    expect(rendered.container.querySelectorAll('.copilot-chat__message--tool.copilot-chat__message--completed')).toHaveLength(1)
    expect(rendered.getByTestId('chat-message-tool-toggle-1').getAttribute('aria-expanded')).toBe('false')

    await clickElement(rendered.getByTestId('chat-message-tool-toggle-1'))
    await waitForCondition(
      () => rendered.queryByTestId('chat-message-tool-panel-1') !== null,
      'tool panel visible after expanding card',
    )

    expect(rendered.getByTestId('chat-message-tool-toggle-1').getAttribute('aria-expanded')).toBe('true')
    const outputJson = rendered.getByTestId('chat-message-tool-output-1-json')
    expect(outputJson.getAttribute('data-json-viewer')).toMatch(/react18-json-view|fallback/)
    expect(outputJson.textContent).toContain('condition')
    expect(outputJson.textContent).toContain('temperatureC')
    expect(outputJson.textContent).toContain('humidity')
    expect(outputJson.textContent).toContain('体感舒适，适合外出。')
    expect(outputJson.textContent).not.toContain('Shenzhen：晴 / 24°C / 湿度 60%')
    expect(rendered.getByTestId('chat-message-tool-extra-1-1-text').textContent).toContain('Shenzhen：晴 / 24°C / 湿度 60%')
    expect(rendered.getByTestId('chat-message-tool-input-toggle-1').textContent).toContain('输入')
    expect(rendered.getByTestId('chat-message-tool-input-toggle-1').getAttribute('aria-expanded')).toBe('false')
    expect(rendered.queryByTestId('chat-message-tool-input-panel-1')).toBeNull()

    await clickElement(rendered.getByTestId('chat-message-tool-input-toggle-1'))
    await waitForCondition(
      () => rendered.queryByTestId('chat-message-tool-input-panel-1') !== null,
      'tool input panel visible after expanding nested input section',
    )

    expect(rendered.getByTestId('chat-message-tool-input-toggle-1').getAttribute('aria-expanded')).toBe('true')

    const inputJson = rendered.getByTestId('chat-message-tool-input-1-json')
    expect(inputJson.getAttribute('data-json-viewer')).toMatch(/react18-json-view|fallback/)
    expect(inputJson.textContent).toContain('location')
    expect(inputJson.textContent).toContain('Shenzhen')

    rendered.unmount()
  })

  it('keeps a failed tool step visible when the runtime emits tool_event failed before run_completed', async () => {
    const sendMessage = createToolFailureSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请调用天气工具')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForText(rendered.container, '工具调用失败')
    await waitForText(rendered.container, '我可以解释工具失败并继续')

    expect(rendered.container.textContent).not.toContain('工具执行失败。')
    expect(rendered.container.textContent).not.toContain('发送失败')
    expect(rendered.container.textContent).toContain('我可以解释工具失败并继续')
    expect(rendered.container.querySelectorAll('.copilot-chat__message--tool.copilot-chat__message--failed')).toHaveLength(1)

    await clickElement(rendered.getByTestId('chat-message-tool-toggle-1'))
    await waitForCondition(
      () => rendered.queryByTestId('chat-message-tool-panel-1') !== null,
      'failed tool panel visible after expanding card',
    )

    expect(rendered.getByTestId('chat-message-tool-output-1-text').textContent).toContain('工具执行失败。')
    expect(rendered.getByTestId('chat-message-tool-extra-1-1-text').textContent).toContain('boom')

    rendered.unmount()
  })

  it('keeps a failed tool step visible when a later non-tool fatal failure ends the run', async () => {
    const sendMessage = createToolFailureThenFatalSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请调用天气工具并处理 fatal 失败')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForText(rendered.container, '工具调用失败')
    await waitForText(rendered.container, '发送失败')
    await waitForText(rendered.container, '当前响应失败，请重试。')

    expect(rendered.container.querySelectorAll('.copilot-chat__message--tool.copilot-chat__message--failed')).toHaveLength(1)
    expect(rendered.container.textContent).not.toContain('我可以解释工具失败并继续')

    await clickElement(rendered.getByTestId('chat-message-tool-toggle-1'))
    await waitForCondition(
      () => rendered.queryByTestId('chat-message-tool-panel-1') !== null,
      'failed tool panel visible after fatal run',
    )

    expect(rendered.getByTestId('chat-message-tool-output-1-text').textContent).toContain('工具执行失败。')
    expect(rendered.getByTestId('chat-message-tool-extra-1-1-text').textContent).toContain('boom')

    rendered.unmount()
  })

  it('keeps failed sends as echoed user messages plus an error turn', async () => {
    const sendMessage = vi.fn(async function* () {
      yield* []
      throw new RuntimeRequestError('tool_not_found: unknown tool', {
        code: 'tool_not_found',
        status: 400,
      })
    })
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请使用不存在的工具')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(rendered.container.textContent).toContain('请使用不存在的工具')
    expect(rendered.container.textContent).toContain('发送失败')
    expect(rendered.container.textContent).toContain('当前所选工具暂不可用，请调整后重试。')

    await clickElement(rendered.getByTestId('chat-message-error-detail-button-1'))

    expect(rendered.getByTestId('error-detail-overlay').textContent).toContain('当前所选工具暂不可用，请调整后重试。')
    expect(rendered.getByTestId('error-detail-overlay').textContent).toContain('tool_not_found')
    expect(rendered.getByTestId('error-detail-overlay').textContent).toContain('run/start')

    rendered.unmount()
  })

  it('displays legacy-unsupported provider validation in the chat area without a composer error bar', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: 'provider-response',
            name: 'Response Provider',
            protocol: 'openai-response',
            fastModel: 'gpt-5.4',
            fallbackModel: 'gpt-5.4',
            availableModels: [
              {
                id: 'provider-response:gpt-5.4',
                modelId: 'gpt-5.4',
                displayName: 'GPT 5.4',
                groupName: 'Response',
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
          primaryAssistantModel: 'gpt-5.4',
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

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    const sendButton = rendered.getByTestId('chat-composer-send-button') as HTMLButtonElement
    const scrollRegion = rendered.getByTestId('chat-message-scroll-region') as HTMLDivElement
    await setFormControlValue(messageInput, '请执行一次真实流式对话')

    expect(sendButton.disabled).toBe(true)
    expect(sendButton.title).toBe('当前模型暂不可用于聊天。')

    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(0)
    expect(scrollRegion.textContent).toContain('当前模型暂不可用于聊天。')
    expect(rendered.container.querySelector('.copilot-chat__composer .copilot-panel__error')).toBeNull()

    await clickElement(rendered.getByTestId('chat-message-error-detail-button-0'))

    expect(rendered.getByTestId('error-detail-overlay').textContent).toContain('当前模型暂不可用于聊天。')
    expect(rendered.getByTestId('error-detail-overlay').textContent).toContain('selected_model_unavailable')
    expect(rendered.getByTestId('error-detail-overlay').textContent).toContain('工具 / 模型上下文')
    expect(rendered.getByTestId('error-detail-overlay').textContent).toContain('模型gpt-5.4')

    rendered.unmount()
  })

  it('requires explicit rebinding before continuing a drifted persisted thread', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()
    const sessionHistory = createHistoryStateWithProviderDrift()

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
        sessionHistory={sessionHistory}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const composer = rendered.getByTestId('chat-composer-dock') as HTMLFormElement
    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    const sendButton = rendered.getByTestId('chat-composer-send-button') as HTMLButtonElement
    await setFormControlValue(messageInput, '继续这个历史线程')

    expect(rendered.getByTestId('chat-history-drift-notice').textContent).toContain('当前配置与历史线程存在差异')
    expect(rendered.getByTestId('chat-history-drift-notice').textContent).toContain('历史模型')
    expect(rendered.getByTestId('chat-history-drift-notice').textContent).toContain('legacy-model')
    expect(rendered.getByTestId('chat-history-drift-notice').textContent).toContain('历史工具')
    expect(rendered.getByTestId('chat-history-drift-notice').textContent).toContain('tool.file-convert')
    expect(rendered.getByTestId('chat-history-drift-notice').textContent).toContain('历史思考')
    expect(rendered.getByTestId('chat-history-drift-warning-list').textContent).toContain('历史线程绑定的模型服务商当前已不可用，继续对话前需重新绑定模型。')
    expect(sendButton.disabled).toBe(true)
    expect(sendButton.title).toBe('历史线程依赖已变化，请先显式重新绑定当前配置后再继续。')

    await submitForm(composer)
    expect(sendMessage).toHaveBeenCalledTimes(0)

    await clickElement(rendered.getByTestId('chat-history-rebind-button'))

    expect(sendButton.disabled).toBe(false)
    expect(sendButton.title).toBe('发送消息')

    await submitForm(composer)
    await waitForText(rendered.container, '这是助手回显')

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      modelRoute: {
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'openrouter',
          modelId: 'openai/gpt-4.1',
        },
      },
      message: {
        content: '继续这个历史线程',
      },
    })

    rendered.unmount()
  })

  it('allows continuing a restored history thread immediately when no run browse is selected', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()
    const sessionHistory = {
      ...createHistoryStateWithProviderDrift(),
      selectedRunId: null,
      replayStatus: 'idle' as const,
      replayError: null,
      replay: null,
    }

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
        sessionHistory={sessionHistory}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const composer = rendered.getByTestId('chat-composer-dock') as HTMLFormElement
    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    const sendButton = rendered.getByTestId('chat-composer-send-button') as HTMLButtonElement
    await setFormControlValue(messageInput, '恢复后直接继续聊天')

    expect(rendered.queryByTestId('chat-history-drift-notice')).toBeNull()
    expect(rendered.queryByTestId('chat-history-run-selector-label')).toBeNull()
    expect(sendButton.disabled).toBe(false)
    expect(sendButton.title).toBe('发送消息')

    await submitForm(composer)
    await waitForText(rendered.container, '这是助手回显')

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      message: {
        content: '恢复后直接继续聊天',
      },
    })

    rendered.unmount()
  })

  it('allows a subsequent successful send after a legacy-provider validation failure and clears the stale error message', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: 'provider-response',
            name: 'Response Provider',
            protocol: 'openai-response',
            fastModel: 'gpt-5.4',
            fallbackModel: 'gpt-5.4',
            availableModels: [
              {
                id: 'provider-response:gpt-5.4',
                modelId: 'gpt-5.4',
                displayName: 'GPT 5.4',
                groupName: 'Response',
                capabilities: ['reasoning', 'tools'],
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
            ],
          }),
          createProviderProfile({
            id: 'provider-openai',
            name: 'OpenAI Compatible',
            availableModels: [
              {
                id: 'provider-openai:openai/gpt-4.1',
                modelId: 'openai/gpt-4.1',
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
        ],
        defaultModelRouting: {
          primaryAssistantModel: 'gpt-5.4',
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

    const composer = rendered.getByTestId('chat-composer-dock') as HTMLFormElement
    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    const scrollRegion = rendered.getByTestId('chat-message-scroll-region') as HTMLDivElement
    await setFormControlValue(messageInput, '第一次先触发不支持路由错误')
    await submitForm(composer)

    expect(scrollRegion.textContent).toContain('当前模型暂不可用于聊天。')
    expect(rendered.container.querySelector('.copilot-chat__composer .copilot-panel__error')).toBeNull()

    await clickElement(rendered.getByTestId('chat-model-picker-trigger'))
    await clickElement(rendered.getByTestId('chat-model-option-provider-openai-provider-openai:openai/gpt-4.1'))
    await setFormControlValue(messageInput, '第二次发送应恢复成功')
    await submitForm(composer)
    await waitForText(rendered.container, '这是助手回显')

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(scrollRegion.textContent).not.toContain('当前模型暂不可用于聊天。')
    expect(scrollRegion.textContent).toContain('第二次发送应恢复成功')
    expect(scrollRegion.textContent).toContain('这是助手回显')

    rendered.unmount()
  })

  it('keeps the input editable during an in-flight send, hides composer status text, and still allows cancellation', async () => {
    const sendMessage = createAbortableSendMessageSpy()
    const cancelRun = vi.fn(async (): ReturnType<typeof cancelRuntimeRun> => createRuntimeRunCancelResponse({
      run: {
        runId: 'run-cancel',
        threadId: 'session-1',
        status: 'cancelling',
        createdAt: '2026-03-27T10:00:00Z',
        updatedAt: '2026-03-27T10:00:02Z',
        startedAt: '2026-03-27T10:00:01Z',
        terminalAt: null,
        cancelRequested: true,
      },
      cancelAccepted: true,
    }))
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

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
        cancelRun={cancelRun}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请开始并允许我取消')

    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await waitForText(rendered.container, '第一段')

    const sendButton = rendered.getByTestId('chat-composer-send-button') as HTMLButtonElement
    expect(sendButton.title).toBe('取消当前响应')
    expect(sendButton.type).toBe('button')
    expect(messageInput.disabled).toBe(false)
    expect(rendered.queryByTestId('chat-composer-run-status')).toBeNull()
    expect(rendered.container.textContent).toContain('天气工具调用中')
    expect(rendered.container.textContent).toContain('第一段')
    expect(rendered.container.textContent).not.toContain('第二段')

    await setFormControlValue(messageInput, '生成期间继续编辑')
    expect(messageInput.value).toBe('生成期间继续编辑')

    await pressTextareaKey(messageInput, 'Enter')
    expect(sendMessage).toHaveBeenCalledTimes(1)

    await clickElement(sendButton)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(cancelRun).toHaveBeenCalledWith({
      runtimeUrl: 'http://127.0.0.1:8765',
      runId: 'run-cancel',
    })
    expect(sendMessage.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
    expect(rendered.container.textContent).toContain('已取消')
    expect(rendered.queryByTestId('chat-composer-run-status')).toBeNull()
    expect(rendered.container.textContent).toContain('天气工具已取消')
    expect(rendered.container.textContent).toContain('第一段')
    expect(rendered.container.textContent).not.toContain('第二段')
    expect(rendered.container.textContent).not.toContain('已完成')
    expect(rendered.container.querySelectorAll('.copilot-chat__message--tool.copilot-chat__message--cancelled')).toHaveLength(1)

    rendered.unmount()
  })
})

function createStartOnlyPendingSendMessageSpy() {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<RuntimeRunEvent> {
    yield {
      type: 'run_started',
      runId: 'run-placeholder-pending',
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-placeholder-pending:assistant',
      },
    }

    await waitForAbort(input.signal)
  })
}

function createToolFirstPendingSendMessageSpy(control: DeferredSignal) {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<RuntimeRunEvent> {
    yield {
      type: 'run_started',
      runId: 'run-tool-placeholder',
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-tool-placeholder:assistant',
      },
    }

    await control.wait()
    yield createRuntimeToolEvent({
      runId: 'run-tool-placeholder',
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        toolCallId: 'tool.weather-current:call-placeholder',
        toolId: 'tool.weather-current',
        phase: 'started',
        title: '调用天气工具',
        summary: '正在获取 Shenzhen 的天气。',
        inputSummary: '{"location":"Shenzhen"}',
      },
    })

    await waitForAbort(input.signal)
  })
}

function createTextFirstPendingSendMessageSpy() {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<RuntimeRunEvent> {
    yield {
      type: 'run_started',
      runId: 'run-text-placeholder',
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-text-placeholder:assistant',
      },
    }

    await Promise.resolve()
    yield {
      type: 'text_delta',
      runId: 'run-text-placeholder',
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        assistantMessageId: 'run-text-placeholder:assistant',
        delta: '这是助手回显',
      },
    }

    await waitForAbort(input.signal)
  })
}

function createFailedBeforeAssistantSendMessageSpy(control: DeferredSignal) {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<RuntimeRunEvent> {
    yield {
      type: 'run_started',
      runId: 'run-no-text-failed',
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-no-text-failed:assistant',
      },
    }

    await control.wait()
    yield {
      type: 'run_failed',
      runId: 'run-no-text-failed',
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        code: 'tool_execution_failed',
        message: 'Tool failed: boom',
        details: {
          toolId: 'tool.weather-current',
        },
      },
    }
  })
}

function createResolvedSendMessageSpy() {
  return vi.fn((input: CopilotMessageDispatchInput) => {
    const routeRef = input.modelRoute.routeRef ?? {
      routeKind: 'provider-model' as const,
      profileId: 'unknown-profile',
      modelId: 'unknown-model',
    }

    return createRuntimeMessageEventStream([
      {
        type: 'run_started',
        runId: 'run-1',
        sessionId: input.sessionId,
        sequence: 1,
        payload: {
          assistantMessageId: 'run-1:assistant',
        },
      },
      {
        type: 'text_delta',
        runId: 'run-1',
        sessionId: input.sessionId,
        sequence: 2,
        payload: {
          assistantMessageId: 'run-1:assistant',
          delta: '这是助手回显',
        },
      },
      {
        type: 'run_completed',
        runId: 'run-1',
        sessionId: input.sessionId,
        sequence: 3,
        payload: {
          assistantMessageId: 'run-1:assistant',
          assistantText: '这是助手回显',
          resolvedModelId: routeRef.modelId,
          resolvedModelRoute: createRuntimeResolvedModelRoute({
            routeRef,
            providerProfileId: routeRef.profileId,
            provider: 'openai',
            providerId: 'openai',
            adapterId: 'openai',
            endpointFamily: 'openai',
            endpointType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            modelId: routeRef.modelId,
            catalogRevision: input.modelRoute.catalogRevision ?? '2026-04-06-provider-catalog-v1',
          }),
          resolvedToolIds: input.enabledTools,
          requestOptions: input.requestOptions ?? {},
        },
      },
    ])
  })
}

function createDeferredResolvedSendMessageSpy(
  control: DeferredSignal,
  overrides: {
    runId?: string
    assistantText?: string
  } = {},
) {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<RuntimeRunEvent> {
    const routeRef = input.modelRoute.routeRef ?? {
      routeKind: 'provider-model' as const,
      profileId: 'unknown-profile',
      modelId: 'unknown-model',
    }
    const runId = overrides.runId ?? 'run-1'
    const assistantText = overrides.assistantText ?? '这是助手回显'

    yield {
      type: 'run_started',
      runId,
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: `${runId}:assistant`,
      },
    }

    await control.wait()
    yield {
      type: 'text_delta',
      runId,
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        assistantMessageId: `${runId}:assistant`,
        delta: assistantText,
      },
    }
    yield {
      type: 'run_completed',
      runId,
      sessionId: input.sessionId,
      sequence: 3,
      payload: {
        assistantMessageId: `${runId}:assistant`,
        assistantText,
        resolvedModelId: routeRef.modelId,
        resolvedModelRoute: createRuntimeResolvedModelRoute({
          routeRef,
          providerProfileId: routeRef.profileId,
          provider: 'openai',
          providerId: 'openai',
          adapterId: 'openai',
          endpointFamily: 'openai',
          endpointType: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          modelId: routeRef.modelId,
          catalogRevision: input.modelRoute.catalogRevision ?? '2026-04-06-provider-catalog-v1',
        }),
        resolvedToolIds: input.enabledTools,
        requestOptions: input.requestOptions ?? {},
      },
    }
  })
}

function createToolLifecycleSendMessageSpy() {
  return vi.fn((input: CopilotMessageDispatchInput) => {
    const routeRef = input.modelRoute.routeRef ?? {
      routeKind: 'provider-model' as const,
      profileId: 'unknown-profile',
      modelId: 'unknown-model',
    }

    return createRuntimeMessageEventStream([
      {
        type: 'run_started',
        runId: 'run-tool-success',
        sessionId: input.sessionId,
        sequence: 1,
        payload: {
          assistantMessageId: 'run-tool-success:assistant',
        },
      },
      createRuntimeToolEvent({
        runId: 'run-tool-success',
        sessionId: input.sessionId,
        sequence: 2,
        payload: {
          toolCallId: 'tool.weather-current:call-1',
          toolId: 'tool.weather-current',
          phase: 'started',
          title: '调用天气工具',
          summary: '正在获取 Shenzhen 的天气。',
          inputSummary: '{"location":"Shenzhen"}',
        },
      }),
      createRuntimeToolEvent({
        runId: 'run-tool-success',
        sessionId: input.sessionId,
        sequence: 3,
        payload: {
          toolCallId: 'tool.weather-current:call-1',
          toolId: 'tool.weather-current',
          phase: 'completed',
          title: '天气工具已返回结果',
          summary: '{\n  "condition": "晴",\n  "humidity": 60,\n  "location": "Shenzhen",\n  "summary": "体感舒适，适合外出。",\n  "temperatureC": 24\n}',
          inputSummary: '{"location":"Shenzhen"}',
          resultSummary: 'Shenzhen：晴 / 24°C / 湿度 60%',
        },
      }),
      {
        type: 'text_delta',
        runId: 'run-tool-success',
        sessionId: input.sessionId,
        sequence: 4,
        payload: {
          assistantMessageId: 'run-tool-success:assistant',
          delta: '这是助手回显',
        },
      },
      {
        type: 'run_completed',
        runId: 'run-tool-success',
        sessionId: input.sessionId,
        sequence: 5,
        payload: {
          assistantMessageId: 'run-tool-success:assistant',
          assistantText: '这是助手回显',
          resolvedModelId: routeRef.modelId,
          resolvedModelRoute: createRuntimeResolvedModelRoute({
            routeRef,
            providerProfileId: routeRef.profileId,
            provider: 'openai',
            providerId: 'openai',
            adapterId: 'openai',
            endpointFamily: 'openai',
            endpointType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            modelId: routeRef.modelId,
            catalogRevision: input.modelRoute.catalogRevision ?? '2026-04-06-provider-catalog-v1',
          }),
          resolvedToolIds: ['tool.weather-current'],
          requestOptions: input.requestOptions ?? {},
        },
      },
    ])
  })
}

function createToolFailureSendMessageSpy() {
  return vi.fn((input: CopilotMessageDispatchInput) => {
    const routeRef = input.modelRoute.routeRef ?? {
      routeKind: 'provider-model' as const,
      profileId: 'unknown-profile',
      modelId: 'unknown-model',
    }

    return createRuntimeMessageEventStream([
      {
        type: 'run_started',
        runId: 'run-tool-failed',
        sessionId: input.sessionId,
        sequence: 1,
        payload: {
          assistantMessageId: 'run-tool-failed:assistant',
        },
      },
      createRuntimeToolEvent({
        runId: 'run-tool-failed',
        sessionId: input.sessionId,
        sequence: 2,
        payload: {
          toolCallId: 'tool.weather-current:call-1',
          toolId: 'tool.weather-current',
          phase: 'started',
          title: '调用天气工具',
          summary: '正在获取 Shenzhen 的天气。',
          inputSummary: '{"location":"Shenzhen"}',
        },
      }),
      createRuntimeToolEvent({
        runId: 'run-tool-failed',
        sessionId: input.sessionId,
        sequence: 3,
        payload: {
          toolCallId: 'tool.weather-current:call-1',
          toolId: 'tool.weather-current',
          phase: 'failed',
          title: '工具调用失败',
          summary: '工具执行失败。',
          inputSummary: '{"location":"Shenzhen"}',
          errorSummary: 'boom',
        },
      }),
      {
        type: 'text_delta',
        runId: 'run-tool-failed',
        sessionId: input.sessionId,
        sequence: 4,
        payload: {
          assistantMessageId: 'run-tool-failed:assistant',
          delta: '我可以解释工具失败并继续',
        },
      },
      {
        type: 'run_completed',
        runId: 'run-tool-failed',
        sessionId: input.sessionId,
        sequence: 5,
        payload: {
          assistantMessageId: 'run-tool-failed:assistant',
          assistantText: '我可以解释工具失败并继续',
          resolvedModelId: routeRef.modelId,
          resolvedModelRoute: createRuntimeResolvedModelRoute({
            routeRef,
            providerProfileId: routeRef.profileId,
            provider: 'openai',
            providerId: 'openai',
            adapterId: 'openai',
            endpointFamily: 'openai',
            endpointType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            modelId: routeRef.modelId,
            catalogRevision: input.modelRoute.catalogRevision ?? '2026-04-06-provider-catalog-v1',
          }),
          resolvedToolIds: ['tool.weather-current'],
          requestOptions: input.requestOptions ?? {},
        },
      },
    ])
  })
}

function createToolFailureThenFatalSendMessageSpy() {
  return vi.fn((input: CopilotMessageDispatchInput) => createRuntimeMessageEventStream([
    {
      type: 'run_started',
      runId: 'run-tool-then-failed',
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-tool-then-failed:assistant',
      },
    },
    createRuntimeToolEvent({
      runId: 'run-tool-then-failed',
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
        phase: 'started',
        title: '调用天气工具',
        summary: '正在获取 Shenzhen 的天气。',
        inputSummary: '{"location":"Shenzhen"}',
      },
    }),
    createRuntimeToolEvent({
      runId: 'run-tool-then-failed',
      sessionId: input.sessionId,
      sequence: 3,
      payload: {
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
        phase: 'failed',
        title: '工具调用失败',
        summary: '工具执行失败。',
        inputSummary: '{"location":"Shenzhen"}',
        errorSummary: 'boom',
      },
    }),
    {
      type: 'run_failed',
      runId: 'run-tool-then-failed',
      sessionId: input.sessionId,
      sequence: 4,
      payload: {
        code: 'agent_execution_failed',
        message: 'Model stream collapsed.',
        details: {
          stage: 'execute_model',
        },
      },
    },
  ]))
}

function createPersistedWorkspaceStateLoader() {
  return vi.fn(async () => ({
    ok: true as const,
    source: 'stored' as const,
    state: createPersistedWorkspaceState(),
  }))
}

function createLoadingPersistedHistoryState(): AssistantSessionHistoryState {
  return {
    summary: {
      threadId: 'session-loading',
      boundAgentId: 'general',
      title: '加载中的历史线程',
      titleSource: 'deterministic',
      summary: '历史摘要',
      summarySource: 'deterministic',
      createdAt: '2026-04-13T15:00:00Z',
      updatedAt: '2026-04-13T15:05:00Z',
      lastActivityAt: '2026-04-13T15:05:00Z',
      lastRunId: 'run-loading-1',
      lastRunStatus: 'completed',
      lastUserMessagePreview: '你好',
      lastAssistantMessagePreview: '历史摘要',
      driftSummary: {
        status: 'not_evaluated',
      },
    },
    isPersistedThread: true,
    hasLoadedDetail: false,
    detailStatus: 'loading',
    detailError: null,
    timelineItems: [],
    runSummaries: [],
    latestConfigurationSnapshot: null,
    availabilityDrift: null,
    selectedRunId: 'run-loading-1',
    replayStatus: 'idle',
    replayError: null,
    replay: null,
    replayByRunId: {},
  }
}

function createLiveReadyButEmptyPersistedHistoryState(
  overrides: Partial<AssistantSessionHistoryState> = {},
): AssistantSessionHistoryState {
  return {
    summary: {
      threadId: 'session-1',
      boundAgentId: 'general',
      title: '新建会话',
      titleSource: 'deterministic',
      summary: '最新摘要',
      summarySource: 'deterministic',
      createdAt: '2026-04-14T08:00:00Z',
      updatedAt: '2026-04-14T08:00:03Z',
      lastActivityAt: '2026-04-14T08:00:03Z',
      lastRunId: 'run-1',
      lastRunStatus: 'completed',
      lastUserMessagePreview: '你好',
      lastAssistantMessagePreview: '这是助手回显',
      driftSummary: {
        status: 'not_evaluated',
      },
    },
    isPersistedThread: true,
    hasLoadedDetail: true,
    detailStatus: 'ready',
    detailError: null,
    timelineItems: [],
    runSummaries: [],
    latestConfigurationSnapshot: null,
    availabilityDrift: null,
    selectedRunId: 'run-1',
    replayStatus: 'idle',
    replayError: null,
    replay: null,
    replayByRunId: {},
    ...overrides,
  }
}

function createHistoryStateWithProviderDrift(): AssistantSessionHistoryState {
  const driftPayload = {
    status: 'historical_provider_removed',
    historicalModelId: 'legacy-model',
    historicalToolIds: ['tool.file-convert'],
    historicalThinkingSummary: 'unified-4-level-v1 / 中 / medium / preset',
    warnings: [{
      code: 'historical_provider_removed',
      message: '历史线程绑定的模型服务商当前已不可用，继续对话前需重新绑定模型。',
    }],
    requiresExplicitRebind: true,
  }

  return {
    summary: {
      threadId: 'session-1',
      boundAgentId: 'general',
      title: '历史线程',
      titleSource: 'deterministic',
      summary: '历史摘要',
      summarySource: 'deterministic',
      createdAt: '2026-04-13T15:00:00Z',
      updatedAt: '2026-04-13T15:05:00Z',
      lastActivityAt: '2026-04-13T15:05:00Z',
      lastRunId: 'run-history-1',
      lastRunStatus: 'completed',
      lastUserMessagePreview: '你好',
      lastAssistantMessagePreview: '历史摘要',
      driftSummary: driftPayload,
    },
    isPersistedThread: true,
    detailStatus: 'ready',
    detailError: null,
    timelineItems: [
      {
        kind: 'assistant_message',
        runId: 'run-history-1',
        sequenceStart: 1,
        sequenceEnd: 1,
        text: '历史摘要',
      },
    ],
    runSummaries: [
      {
        runId: 'run-history-1',
        threadId: 'session-1',
        status: 'completed',
        createdAt: '2026-04-13T15:00:00Z',
        updatedAt: '2026-04-13T15:05:00Z',
        startedAt: '2026-04-13T15:00:01Z',
        terminalAt: '2026-04-13T15:05:00Z',
        resolvedModelId: 'legacy-model',
        requestedMessageText: '你好',
        assistantText: '历史摘要',
      },
    ],
    latestConfigurationSnapshot: null,
    availabilityDrift: driftPayload,
    selectedRunId: 'run-history-1',
    replayStatus: 'ready',
    replayError: null,
    replay: {
      ok: true,
      version: 'chat-history-v1',
      run: {
        runId: 'run-history-1',
        threadId: 'session-1',
        status: 'completed',
        createdAt: '2026-04-13T15:00:00Z',
        updatedAt: '2026-04-13T15:05:00Z',
        startedAt: '2026-04-13T15:00:01Z',
        terminalAt: '2026-04-13T15:05:00Z',
        resolvedModelId: 'legacy-model',
        requestedMessageText: '你好',
        assistantText: '历史摘要',
      },
      historicalSnapshot: {
        resolvedModelId: 'legacy-model',
        resolvedModelRoute: {
          routeRef: {
            routeKind: 'provider-model',
            profileId: 'provider-legacy',
            modelId: 'legacy-model',
          },
        },
        resolvedToolIds: ['tool.file-convert'],
        appliedThinkingSelection: {
          series: 'unified-4-level-v1',
          mode: 'preset',
          level: 'medium',
          value: {
            valueType: 'code',
            code: 'medium',
            labelZh: '中',
          },
        },
      },
      orderedEvents: [],
      toolCallBlocks: [],
      diagnosticBlocks: [],
      terminalState: null,
      availabilityInterpretation: driftPayload,
    },
  }
}

function createAbortableSendMessageSpy() {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<RuntimeRunEvent> {
    yield {
      type: 'run_started',
      runId: 'run-cancel',
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-cancel:assistant',
      },
    }

    await Promise.resolve()
    yield createRuntimeToolEvent({
      runId: 'run-cancel',
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
        phase: 'started',
        title: '调用天气工具',
        summary: '正在获取 Shenzhen 的天气。',
        inputSummary: '{"location":"Shenzhen"}',
      },
    })

    await Promise.resolve()
    yield {
      type: 'text_delta',
      runId: 'run-cancel',
      sessionId: input.sessionId,
      sequence: 3,
      payload: {
        assistantMessageId: 'run-cancel:assistant',
        delta: '第一段',
      },
    }

    await new Promise<never>((_resolve, reject) => {
      const abort = () => {
        const error = new Error('The operation was aborted.')
        error.name = 'AbortError'
        reject(error)
      }

      if (input.signal?.aborted) {
        abort()
        return
      }

      input.signal?.addEventListener('abort', abort, { once: true })
    })

    yield {
      type: 'text_delta',
      runId: 'run-cancel',
      sessionId: input.sessionId,
      sequence: 4,
      payload: {
        assistantMessageId: 'run-cancel:assistant',
        delta: '第二段',
      },
    }
  })
}

interface MockDesktopNotificationRecord {
  title: string
  body: string
  tag?: string
}

interface MockDesktopNotificationController {
  records: MockDesktopNotificationRecord[]
}

function installMockDesktopNotification(): MockDesktopNotificationController {
  const records: MockDesktopNotificationRecord[] = []

  Object.defineProperty(window, 'desktopNotification', {
    configurable: true,
    writable: true,
    value: {
      show: vi.fn(async (request: MockDesktopNotificationRecord) => {
        records.push({ ...request })
      }),
    } as Window['desktopNotification'],
  })

  return {
    records,
  }
}

function installRejectingMockDesktopNotification(error: Error): MockDesktopNotificationController {
  const records: MockDesktopNotificationRecord[] = []

  Object.defineProperty(window, 'desktopNotification', {
    configurable: true,
    writable: true,
    value: {
      show: vi.fn(async (request: MockDesktopNotificationRecord) => {
        records.push({ ...request })
        throw error
      }),
    } as Window['desktopNotification'],
  })

  return {
    records,
  }
}

function restoreNotificationApi() {
  Object.defineProperty(window, 'desktopNotification', {
    configurable: true,
    writable: true,
    value: {
      show: vi.fn(async () => undefined),
    } as Window['desktopNotification'],
  })
}

interface DeferredSignal {
  wait: () => Promise<void>
  release: () => void
}

async function waitForAbort(signal?: AbortSignal) {
  await new Promise<never>((_resolve, reject) => {
    const abort = () => {
      const error = new Error('The operation was aborted.')
      error.name = 'AbortError'
      reject(error)
    }

    if (signal?.aborted) {
      abort()
      return
    }

    signal?.addEventListener('abort', abort, { once: true })
  })
}

function createDeferredSignal(): DeferredSignal {
  let releaseResolver: (() => void) | null = null
  const wait = new Promise<void>((resolve) => {
    releaseResolver = resolve
  })

  return {
    wait: () => wait,
    release: () => {
      releaseResolver?.()
    },
  }
}

async function waitForCondition(condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (condition()) {
      return
    }

    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }

  throw new Error(`Timed out waiting for condition: ${label}`)
}

async function waitForText(container: HTMLElement, expectedText: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (container.textContent?.includes(expectedText)) {
      return
    }

    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  throw new Error(`Timed out waiting for text: ${expectedText}`)
}
