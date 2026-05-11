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
  createRuntimeModelRoute,
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
import {
  createCopilotThreadRuntimeControllerState,
  type CopilotThreadRuntimeControllerState,
} from './thread-runtime-controller'
import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import { createPersistedWorkspaceState, createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const DESC_CN_019 = '请调用天气工具并处理 fatal 失败'
const DESC_CN_022 = '正在获取 Shenzhen 的天气。'
const DESC_CN_028 = '我可以解释工具失败并继续'
const DESC_CN_038 = '当前模型暂不可用于聊天。'
const DESC_CN_045 = 'Shenzhen：晴 / 24°C / 湿度 60%'
const DESC_CN_048 = '当前响应失败，请重试。'
const LABEL_2026 = '2026-04-06-provider-catalog-v1'
const LABEL_2026_13T15 = '2026-04-13T15:05:00Z'
const LABEL_2026_13T15_2 = '2026-04-13T15:00:00Z'
const LABEL_2026_14T08 = '2026-04-14T08:00:03Z'
const LABEL_2026_14T08_2 = '2026-04-14T08:00:00Z'
const LABEL_2026_14T08_3 = '2026-04-14T08:00:01Z'
const LABEL_CLAUDE = 'claude-3.7-sonnet'
const LABEL_COURSE_FORM = 'course-form'
const LABEL_ERROR_DETAIL_OVERLAY = 'error-detail-overlay'
const LABEL_HTTPS_API_EXAMPLE = 'https://api.example.com/v1'
const LABEL_HTTP_127 = 'http://127.0.0.1:8765'
const LABEL_LEGACY_MODEL = 'legacy-model'
const LABEL_LOCATION_SHENZHEN = '{"location":"Shenzhen"}'
const LABEL_OPENAI_COMPATIBLE = 'OpenAI Compatible'
const LABEL_OPENAI_COMPATIBLE_2 = 'openai-compatible'
const LABEL_OPENAI_GPT = 'openai/gpt-4.1'
const LABEL_PROVIDER_BETA = 'provider-beta'
const LABEL_PROVIDER_MODEL = 'provider-model'
const LABEL_PROVIDER_OPENAI = 'provider-openai'
const LABEL_PROVIDER_OPENAI_OPENAI = 'provider-openai:openai/gpt-4.1'
const LABEL_RUN_CANCEL = 'run-cancel'
const LABEL_RUN_HISTORY = 'run-history-1'
const LABEL_RUN_INLINE_FORM = 'run-inline-form-switch'
const LABEL_RUN_INTERRUPTED_UNTIL = 'Run interrupted until the user submits the requested form.'
const LABEL_RUN_TOOL_FAILED = 'run-tool-failed'
const LABEL_RUN_TOOL_SUCCESS = 'run-tool-success'
const LABEL_RUN_TOOL_THEN = 'run-tool-then-failed'
const LABEL_SHARED_MODEL = 'shared-model'
const LABEL_TEXTAREA_NAME_MESSAGETEXT = 'textarea[name="messageText"]'
const LABEL_TOOL_READ = 'tool.fs.read'
const LABEL_TOOL_REMOTE_SEARCH = 'tool.remote-search'
const LABEL_TOOL_REMOTE_SEARCH_2 = 'tool.remote-search:call-1'
const LABEL_TOOL_REQUEST_USER = 'tool.request-user-form:call-1'
const LABEL_TOOL_REQUEST_USER_2 = 'tool.request-user-form'
const LABEL_UNKNOWN_MODEL = 'unknown-model'
const LABEL_UNKNOWN_PROFILE = 'unknown-profile'
const SELECTOR_ARIA_EXPANDED = 'aria-expanded'
const SELECTOR_ARIA_PRESSED = 'aria-pressed'
const SELECTOR_CHAT_ASSISTANT_PLACEHOLDER = 'chat-assistant-placeholder'
const SELECTOR_CHAT_COMPOSER_DOCK = 'chat-composer-dock'
const SELECTOR_CHAT_COMPOSER_SEND = 'chat-composer-send-button'
const SELECTOR_CHAT_HISTORY_DRIFT = 'chat-history-drift-notice'
const SELECTOR_CHAT_MESSAGE_INLINE = 'chat-message-inline-form-submit-1'
const SELECTOR_CHAT_MESSAGE_SCROLL = 'chat-message-scroll-region'
const SELECTOR_CHAT_MESSAGE_TOOL = 'chat-message-tool-panel-1'
const SELECTOR_CHAT_MESSAGE_TOOL_2 = 'chat-message-tool-toggle-1'
const SELECTOR_CHAT_MESSAGE_TOOL_3 = 'chat-message-tool-input-toggle-1'
const SELECTOR_CHAT_MODEL_PICKER = 'chat-model-picker-trigger'
const SELECTOR_CHAT_TOOL_OPTION = 'chat-tool-option-tool.remote-search'
const SELECTOR_COPILOT_CHAT_PANEL = 'copilot-chat-panel'


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

describe('CopilotChatPanel composer interactions', () => {
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
  describe('composer input handling', () => {
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
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

  it('allows attachment-only sends and appends the fixed attached-file list to the outgoing message', async () => {
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

    try {
      await act(async () => {
        await Promise.resolve()
      })

      const composerForm = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement
      const sendButton = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_SEND) as HTMLButtonElement
      const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
      const file = createFileWithPath({
        name: 'note.txt',
        type: 'text/plain',
        path: 'attachment-only.txt',
        content: 'attachment body',
      })

      await act(async () => {
        messageInput.dispatchEvent(createPasteEvent({
          types: ['Files'],
          items: [],
          files: [file],
        }))
      })

      expect(sendButton.disabled).toBe(false)
      await submitForm(composerForm)

      expect(rendered.container.querySelector('[data-testid="chat-composer-attachment-trigger"]')).toBeNull()
      expect(sendMessage).toHaveBeenCalledTimes(1)
      expect(sendMessage.mock.calls[0]?.[0].message.content).toBe([
        'User attached files:',
        '- attachment-only.txt',
        `Please process these files accordingly, for example, use \`${LABEL_TOOL_READ}\` tool to read the content of these files.`,
      ].join('\n'))
    } finally {
      rendered.unmount()
    }
  })

  })
  describe('attachments and composer resize', () => {
  it('clears attachments immediately after send is triggered even when the run later fails', async () => {
    const control = createDeferredSignal()
    const sendMessage = createFailedBeforeAssistantSendMessageSpy(control)
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

    try {
      await act(async () => {
        await Promise.resolve()
      })

      const composerForm = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement
      const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
      const file = createFileWithPath({
        name: 'failed.txt',
        type: 'text/plain',
        path: 'failed-attachment.txt',
        content: 'attachment body',
      })

      await act(async () => {
        messageInput.dispatchEvent(createPasteEvent({
          types: ['Files'],
          items: [],
          files: [file],
        }))
      })
      await setFormControlValue(messageInput, '失败也应立即清空')

      await submitForm(composerForm)
      expect(rendered.container.querySelector('[data-testid="chat-composer-attachment-trigger"]')).toBeNull()

      control.release()
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.container.querySelector('[data-testid="chat-composer-attachment-trigger"]')).toBeNull()
    } finally {
      rendered.unmount()
    }
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

    const scrollRegion = rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL) as HTMLDivElement
    const resizeHandle = rendered.getByTestId('chat-composer-resize-handle') as HTMLDivElement
    const composerSurface = rendered.getByTestId('chat-composer-surface') as HTMLDivElement
    const sendButton = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_SEND) as HTMLButtonElement

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

  })
  describe('tool picker interactions', () => {
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
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION)).not.toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-tool.fs.read')).toBeNull()

    await setFormControlValue(searchInput, '')
    await clickElement(rendered.getByTestId('chat-tool-picker-select-all'))
    await clickElement(rendered.getByTestId('chat-tool-picker-invert'))
    await clickElement(rendered.getByTestId('chat-tool-picker-select-recommended'))
    await clickElement(rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION))

    expect(rendered.container.querySelector('input[type="checkbox"]')).toBeNull()

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请使用当前工具集执行摘要')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      enabledTools: [LABEL_TOOL_READ, LABEL_TOOL_REMOTE_SEARCH],
      message: {
        content: '请使用当前工具集执行摘要',
      },
    })

    rendered.unmount()
  })

  it('keeps denied tools visible but disabled in the picker and strips them before send', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const sessionShell = createSessionShell()
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        mcp: {
          toolPermissionPolicy: {
            version: 1,
            defaultMode: 'ask',
            toolPermissions: {
              [LABEL_TOOL_REMOTE_SEARCH]: { mode: 'deny' },
            },
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
        sessionShell={sessionShell}
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

    const deniedOption = rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION) as HTMLButtonElement
    const allowedOption = rendered.getByTestId('chat-tool-option-tool.fs.read') as HTMLButtonElement

    expect(deniedOption.disabled).toBe(false)
    expect(deniedOption.className).toContain('copilot-tool-picker__option--disabled')
    expect(deniedOption.getAttribute('aria-disabled')).toBe('true')
    expect(deniedOption.title).toContain('总是关闭')
    expect(allowedOption.disabled).toBe(false)

    await clickElement(deniedOption)
    expect(deniedOption.getAttribute(SELECTOR_ARIA_PRESSED)).toBe('false')

    await clickElement(allowedOption)
    expect(allowedOption.getAttribute(SELECTOR_ARIA_PRESSED)).toBe('true')

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请在清洗 deny 后发送')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      enabledTools: [LABEL_TOOL_READ],
      message: {
        content: '请在清洗 deny 后发送',
      },
    })

    rendered.unmount()
  })

  it('strips stale denied enabledTools from live composer state before dispatching the request', async () => {
    const sendMessage = createResolvedSendMessageSpy()
    const sessionShell = createSessionShell({ sessionId: 'session-stale-deny' })
    const staleState = createCopilotThreadRuntimeControllerState(sessionShell)
    const runtimeControllerBySessionId: Record<string, CopilotThreadRuntimeControllerState> = {
      [sessionShell.sessionId]: {
        ...staleState,
        composerDraft: {
          ...staleState.composerDraft,
          messageText: '请清洗残留 deny 工具',
          selectedModelId: LABEL_PROVIDER_OPENAI_OPENAI,
          selectedModelRoute: createRuntimeModelRoute({
            providerProfileId: LABEL_PROVIDER_OPENAI,
            modelId: LABEL_OPENAI_GPT,
            routeRef: {
              routeKind: LABEL_PROVIDER_MODEL,
              profileId: LABEL_PROVIDER_OPENAI,
              modelId: LABEL_OPENAI_GPT,
            },
          }),
          enabledTools: [LABEL_TOOL_READ, LABEL_TOOL_REMOTE_SEARCH],
        },
      },
    }
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
        ],
        defaultModelRouting: {
          primaryAssistantModel: LABEL_OPENAI_GPT,
        },
        mcp: {
          toolPermissionPolicy: {
            version: 1,
            defaultMode: 'ask',
            toolPermissions: {
              [LABEL_TOOL_REMOTE_SEARCH]: { mode: 'deny' },
            },
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
        sessionShell={sessionShell}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
        runtimeControllerBySessionId={runtimeControllerBySessionId}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    await clickElement(rendered.getByTestId('chat-tool-picker-trigger'))

    const deniedOption = rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION) as HTMLButtonElement
    const allowedOption = rendered.getByTestId('chat-tool-option-tool.fs.read') as HTMLButtonElement

    expect(deniedOption.disabled).toBe(false)
    expect(deniedOption.getAttribute(SELECTOR_ARIA_PRESSED)).toBe('true')
    expect(deniedOption.getAttribute('aria-disabled')).toBe(null)
    expect(allowedOption.getAttribute(SELECTOR_ARIA_PRESSED)).toBe('true')

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    expect(messageInput.value).toBe('请清洗残留 deny 工具')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      enabledTools: [LABEL_TOOL_READ],
      message: {
        content: '请清洗残留 deny 工具',
      },
    })

    rendered.unmount()
  })

  })
  describe('message display and notifications', () => {
  it('echoes user and assistant messages after a successful send with model icon and model name in the assistant header', async () => {
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
    await setFormControlValue(messageInput, '请回显本条消息')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请完成后通知我')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '通知保持关闭')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '失败后通知我')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForCondition(() => notification.records.length === 1, 'assistant failure notification emitted')

    expect(notification.records[0]).toEqual({
      title: '助手消息已完成',
      body: DESC_CN_028,
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '即使通知失败也继续完成')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '先关闭，完成后再开启')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
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

  })
  describe('send feedback and assistant placeholder', () => {
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请先准备响应')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER) !== null,
      'assistant placeholder visible after send',
    )

    const placeholder = rendered.getByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER)
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '历史恢复前先显示即时反馈')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER) !== null,
      'assistant placeholder visible while persisted detail still loading',
    )
    await waitForCondition(
      () => rendered.queryByTestId('chat-history-loading-skeleton') === null,
      'persisted loading skeleton hidden when transient content exists',
    )

    expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL).textContent).toContain('历史恢复前先显示即时反馈')
    expect(rendered.getByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER).textContent).toContain('助手正在准备响应')

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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '你好')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForText(rendered.container, '这是助手回显')

    expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL).textContent).toContain('你好')
    expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL).textContent).toContain('这是助手回显')

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
              createdAt: LABEL_2026_14T08_2,
              updatedAt: LABEL_2026_14T08,
              startedAt: LABEL_2026_14T08_3,
              terminalAt: LABEL_2026_14T08,
              resolvedModelId: LABEL_OPENAI_GPT,
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

    const scrollRegion = rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL)
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '旧话题问题')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER) !== null,
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
    expect(rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER)).toBeNull()

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

  })
  describe('transient state and session switching', () => {
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '你好')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForText(rendered.container, '这是助手回显')

    expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL).textContent).toContain('你好')
    expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL).textContent).toContain('这是助手回显')

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
              createdAt: LABEL_2026_14T08_2,
              updatedAt: LABEL_2026_14T08,
              startedAt: LABEL_2026_14T08_3,
              terminalAt: LABEL_2026_14T08,
              resolvedModelId: LABEL_OPENAI_GPT,
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
            runtimeUrl: LABEL_HTTP_127,
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '你好')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForText(rendered.container, '这是助手回显')

    rendered.rerender(
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
            runtimeUrl: LABEL_HTTP_127,
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
              createdAt: LABEL_2026_14T08_2,
              updatedAt: LABEL_2026_14T08,
              startedAt: LABEL_2026_14T08_3,
              terminalAt: LABEL_2026_14T08,
              resolvedModelId: LABEL_OPENAI_GPT,
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
      entry.scope === SELECTOR_COPILOT_CHAT_PANEL
      && entry.event === 'run-settled-pending-history-sync'
      && entry.sessionId === 'session-1'
      && entry.transientSessionId === 'session-1'
      && entry.runId === 'run-1'
    ))
    const matchingForwardSwitchLog = emittedDebugEntries.find((entry) => (
      entry.scope === SELECTOR_COPILOT_CHAT_PANEL
      && entry.event === 'session-switch-retained-transient'
      && entry.previousSessionId === 'session-1'
      && entry.nextSessionId === 'session-2'
      && entry.previousTransientConversationLength === 1
    ))
    const matchingCommittedSyncLog = emittedDebugEntries.find((entry) => (
      entry.scope === SELECTOR_COPILOT_CHAT_PANEL
      && entry.event === 'pending-history-sync-committed'
      && entry.sessionId === 'session-1'
      && entry.pendingRunId === 'run-1'
      && entry.persistedConversationSource === 'summary'
    ))
    const matchingReturnSwitchLog = emittedDebugEntries.find((entry) => (
      entry.scope === SELECTOR_COPILOT_CHAT_PANEL
      && entry.event === 'session-switch-retained-transient'
      && entry.previousSessionId === 'session-2'
      && entry.nextSessionId === 'session-1'
      && entry.nextTransientConversationLength === 1
    ))
    const matchingWaitingLog = emittedDebugEntries.find((entry) => (
      entry.scope === SELECTOR_COPILOT_CHAT_PANEL
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

  })
  describe('assistant placeholder lifecycle', () => {
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请先查天气再继续')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER) !== null,
      'assistant placeholder visible before tool card',
    )

    toolEventControl.release()

    await waitForText(rendered.container, '天气工具调用中')
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER) === null,
      'assistant placeholder removed after tool card',
    )

    expect(rendered.getByTestId('chat-message-tool-spinner-1')).not.toBeNull()
    expect(rendered.queryByTestId(SELECTOR_CHAT_MESSAGE_TOOL)).toBeNull()
    expect(rendered.container.textContent).not.toContain(DESC_CN_022)

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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请直接回答')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER) !== null,
      'assistant placeholder visible before assistant text',
    )
    await waitForText(rendered.container, '这是助手回显')
    await waitForCondition(() => {
      const placeholder = rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER) as HTMLElement | null
      return placeholder?.className.includes('copilot-chat__message--placeholder-fading') ?? false
    }, 'assistant placeholder fading after assistant text')
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER) === null,
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请在失败前开始')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER) !== null,
      'assistant placeholder visible before failure',
    )

    failureControl.release()

    await waitForText(rendered.container, '发送失败')
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER) === null,
      'assistant placeholder removed after failed run',
    )

    expect(rendered.container.textContent).toContain('工具执行失败，请重试。')
    expect(rendered.container.textContent).not.toContain('助手消息已完成')

    rendered.unmount()
  })

  })
  describe('tool approval interactions', () => {
  it('renders tool approval buttons without waiting callout in manual approval mode', async () => {
    const toolApprovalControl = createDeferredSignal()
    const sendMessage = createToolWaitingApprovalSendMessageSpy(toolApprovalControl, {
      approval: {
        mode: 'ask',
        timeoutAt: null,
        timeoutSeconds: null,
        timeoutAction: null,
      },
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请人工审批天气工具')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    toolApprovalControl.release()

    await waitForCondition(
      () => rendered.queryByTestId('chat-message-tool-approval-approve-1') !== null,
      'manual approval buttons rendered',
    )
    expect(rendered.container.textContent).toContain('拒绝')
    expect(rendered.container.textContent).toContain('批准')
    expect(rendered.container.textContent).not.toContain('等待批准')
    expect(rendered.container.textContent).not.toContain('后自动')

    rendered.unmount()
  })

  it('renders a waiting approval tool bubble with delay auto deny countdown on reject action', async () => {
    const toolApprovalControl = createDeferredSignal()
    const sendMessage = createToolWaitingApprovalSendMessageSpy(toolApprovalControl)
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请审批天气工具')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    toolApprovalControl.release()

    await waitForCondition(
      () => (rendered.container.textContent ?? '').includes('拒绝（30s）'),
      'delay auto deny countdown rendered on reject action',
    )
    expect(rendered.container.textContent).toContain('拒绝（30s）')
    expect(rendered.container.textContent).toContain('批准')
    expect(rendered.container.textContent).not.toContain('等待批准')
    expect(rendered.container.textContent).not.toContain('后自动拒绝')

    rendered.unmount()
  })

  it('renders a waiting approval tool bubble with delay auto approve countdown on approve action', async () => {
    const toolApprovalControl = createDeferredSignal()
    const sendMessage = createToolWaitingApprovalSendMessageSpy(toolApprovalControl, {
      approval: {
        mode: 'delay',
        timeoutAt: new Date(Date.now() + 30_000).toISOString(),
        timeoutSeconds: 30,
        timeoutAction: 'approve',
      },
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请限时审批天气工具')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    toolApprovalControl.release()

    await waitForCondition(
      () => (rendered.container.textContent ?? '').includes('批准（30s）'),
      'delay auto approve countdown rendered on approve action',
    )
    expect(rendered.container.textContent).toContain('批准（30s）')
    expect(rendered.container.textContent).toContain('拒绝')
    expect(rendered.container.textContent).not.toContain('等待批准')
    expect(rendered.container.textContent).not.toContain('后自动批准')

    rendered.unmount()
  })

  })
  describe('cancel and tool lifecycle', () => {
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请先开始然后取消')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER) !== null,
      'assistant placeholder visible before cancellation',
    )

    await clickElement(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_SEND))
    await waitForText(rendered.container, '已取消')
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_ASSISTANT_PLACEHOLDER) === null,
      'assistant placeholder removed after cancellation',
    )

    expect(cancelRun).toHaveBeenCalledWith({
      runtimeUrl: LABEL_HTTP_127,
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请先查询天气再回答')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForText(rendered.container, '天气工具被调用')

    const textContent = rendered.container.textContent ?? ''
    expect(textContent).toContain('这是助手回显')
    expect(textContent).not.toContain(DESC_CN_022)
    expect(textContent).not.toContain(DESC_CN_045)
    expect(textContent).not.toContain(LABEL_LOCATION_SHENZHEN)
    expect(textContent.indexOf('天气工具被调用')).toBeLessThan(textContent.indexOf('这是助手回显'))
    expect(rendered.queryByTestId(SELECTOR_CHAT_MESSAGE_TOOL)).toBeNull()
    expect(rendered.container.querySelectorAll('.copilot-chat__message--tool.copilot-chat__message--completed')).toHaveLength(1)
    expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_TOOL_2).getAttribute(SELECTOR_ARIA_EXPANDED)).toBe('false')

    await clickElement(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_TOOL_2))
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_MESSAGE_TOOL) !== null,
      'tool panel visible after expanding card',
    )

    expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_TOOL_2).getAttribute(SELECTOR_ARIA_EXPANDED)).toBe('true')
    const outputJson = rendered.getByTestId('chat-message-tool-output-1-json')
    expect(outputJson.getAttribute('data-json-viewer')).toMatch(/react18-json-view|fallback/)
    expect(outputJson.getAttribute('data-json-collapsed')).toBe('true')
    expect(outputJson.textContent).not.toContain(DESC_CN_045)
    expect(rendered.queryByTestId('chat-message-tool-extra-1-1-text')).toBeNull()
    expect(rendered.container.textContent).not.toContain('结果摘要')
    expect(rendered.container.textContent).not.toContain(DESC_CN_045)
    expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_TOOL_3).textContent).toContain('输入')
    expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_TOOL_3).getAttribute(SELECTOR_ARIA_EXPANDED)).toBe('false')
    expect(rendered.queryByTestId('chat-message-tool-input-panel-1')).toBeNull()

    await clickElement(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_TOOL_3))
    await waitForCondition(
      () => rendered.queryByTestId('chat-message-tool-input-panel-1') !== null,
      'tool input panel visible after expanding nested input section',
    )

    expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_TOOL_3).getAttribute(SELECTOR_ARIA_EXPANDED)).toBe('true')

    const inputJson = rendered.getByTestId('chat-message-tool-input-1-json')
    expect(inputJson.getAttribute('data-json-viewer')).toMatch(/react18-json-view|fallback/)
    expect(inputJson.getAttribute('data-json-collapsed')).toBe('true')

    rendered.unmount()
  })

  })
  describe('tool failure handling', () => {
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请调用天气工具')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForText(rendered.container, '工具调用失败')
    await waitForText(rendered.container, DESC_CN_028)

    expect(rendered.container.textContent).not.toContain('工具执行失败。')
    expect(rendered.container.textContent).not.toContain('发送失败')
    expect(rendered.container.textContent).toContain(DESC_CN_028)
    expect(rendered.container.querySelectorAll('.copilot-chat__message--tool.copilot-chat__message--failed')).toHaveLength(1)

    await clickElement(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_TOOL_2))
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_MESSAGE_TOOL) !== null,
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, DESC_CN_019)
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForText(rendered.container, '工具调用失败')
    await waitForText(rendered.container, '发送失败')
    await waitForText(rendered.container, DESC_CN_048)

    expect(rendered.container.querySelectorAll('.copilot-chat__message--tool.copilot-chat__message--failed')).toHaveLength(1)
    expect(rendered.container.textContent).not.toContain(DESC_CN_028)

    await clickElement(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_TOOL_2))
    await waitForCondition(
      () => rendered.queryByTestId(SELECTOR_CHAT_MESSAGE_TOOL) !== null,
      'failed tool panel visible after fatal run',
    )

    expect(rendered.getByTestId('chat-message-tool-output-1-text').textContent).toContain('工具执行失败。')
    expect(rendered.getByTestId('chat-message-tool-extra-1-1-text').textContent).toContain('boom')

    rendered.unmount()
  })

  it('keeps the transient failed terminal visible until persisted replay contains the failed terminal handoff', async () => {
    const sendMessage = createToolFailureThenFatalSendMessageSpy()
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
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState()}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, DESC_CN_019)
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForText(rendered.container, '发送失败')
    await waitForText(rendered.container, DESC_CN_048)

    rendered.rerender(
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
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState({
          runSummaries: [
            {
              runId: LABEL_RUN_TOOL_THEN,
              threadId: 'session-1',
              status: 'failed',
              createdAt: LABEL_2026_14T08_2,
              updatedAt: LABEL_2026_14T08,
              startedAt: LABEL_2026_14T08_3,
              terminalAt: LABEL_2026_14T08,
              resolvedModelId: LABEL_OPENAI_GPT,
              requestedMessageText: DESC_CN_019,
              assistantText: null,
            },
          ],
          selectedRunId: LABEL_RUN_TOOL_THEN,
          summary: {
            ...createLiveReadyButEmptyPersistedHistoryState().summary,
            lastRunId: LABEL_RUN_TOOL_THEN,
            lastRunStatus: 'failed',
            lastUserMessagePreview: DESC_CN_019,
            lastAssistantMessagePreview: '',
          },
          replayStatus: 'idle',
          replay: null,
          replayByRunId: {},
        })}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(rendered.container.textContent).toContain('发送失败')
    expect(rendered.container.textContent).toContain(DESC_CN_048)

    rendered.rerender(
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
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState({
          runSummaries: [
            {
              runId: LABEL_RUN_TOOL_THEN,
              threadId: 'session-1',
              status: 'failed',
              createdAt: LABEL_2026_14T08_2,
              updatedAt: LABEL_2026_14T08,
              startedAt: LABEL_2026_14T08_3,
              terminalAt: LABEL_2026_14T08,
              resolvedModelId: LABEL_OPENAI_GPT,
              requestedMessageText: DESC_CN_019,
              assistantText: null,
            },
          ],
          selectedRunId: LABEL_RUN_TOOL_THEN,
          summary: {
            ...createLiveReadyButEmptyPersistedHistoryState().summary,
            lastRunId: LABEL_RUN_TOOL_THEN,
            lastRunStatus: 'failed',
            lastUserMessagePreview: DESC_CN_019,
            lastAssistantMessagePreview: '',
          },
          replayStatus: 'ready',
          replay: {
            ok: true,
            version: 'chat-history-v1',
            run: {
              runId: LABEL_RUN_TOOL_THEN,
              threadId: 'session-1',
              status: 'failed',
              createdAt: LABEL_2026_14T08_2,
              updatedAt: LABEL_2026_14T08,
              startedAt: LABEL_2026_14T08_3,
              terminalAt: LABEL_2026_14T08,
              resolvedModelId: LABEL_OPENAI_GPT,
              requestedMessageText: DESC_CN_019,
              assistantText: null,
            },
            historicalSnapshot: {
              resolvedModelId: LABEL_OPENAI_GPT,
              resolvedModelRoute: createRuntimeResolvedModelRoute({
                routeRef: {
                  routeKind: LABEL_PROVIDER_MODEL,
                  profileId: LABEL_PROVIDER_OPENAI,
                  modelId: LABEL_OPENAI_GPT,
                },
                providerProfileId: LABEL_PROVIDER_OPENAI,
                provider: 'openai',
                providerId: 'openai',
                adapterId: 'openai-chat',
                runtimeStatus: 'enabled',
                endpointFamily: 'openai',
                endpointType: 'responses',
                baseUrl: 'https://api.openai.com/v1',
                modelId: LABEL_OPENAI_GPT,
                authKind: 'api-key',
              }),
              resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
              requestOptions: {},
            },
            orderedEvents: [
              {
                eventType: 'tool_event',
                sequence: 2,
                createdAt: '2026-04-14T08:00:02Z',
                payload: {
                  toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
                  toolId: LABEL_TOOL_REMOTE_SEARCH,
                  phase: 'failed',
                  title: '工具调用失败',
                  summary: '工具执行失败。',
                  inputSummary: LABEL_LOCATION_SHENZHEN,
                  errorSummary: 'boom',
                },
                toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
                toolId: LABEL_TOOL_REMOTE_SEARCH,
                phase: 'failed',
                isRedacted: false,
                redactionVersion: 0,
              },
              {
                eventType: 'run_failed',
                sequence: 3,
                createdAt: LABEL_2026_14T08,
                payload: {
                  code: 'agent_execution_failed',
                  message: 'Model stream collapsed.',
                  details: {
                    stage: 'execute_model',
                  },
                },
                toolCallId: null,
                toolId: null,
                phase: null,
                isRedacted: false,
                redactionVersion: 0,
              },
            ],
            toolCallBlocks: [],
            diagnosticBlocks: [],
            terminalState: null,
            availabilityInterpretation: null,
          },
          replayByRunId: {
            [LABEL_RUN_TOOL_THEN]: {
              ok: true,
              version: 'chat-history-v1',
              run: {
                runId: LABEL_RUN_TOOL_THEN,
                threadId: 'session-1',
                status: 'failed',
                createdAt: LABEL_2026_14T08_2,
                updatedAt: LABEL_2026_14T08,
                startedAt: LABEL_2026_14T08_3,
                terminalAt: LABEL_2026_14T08,
                resolvedModelId: LABEL_OPENAI_GPT,
                requestedMessageText: DESC_CN_019,
                assistantText: null,
              },
              historicalSnapshot: {
                resolvedModelId: LABEL_OPENAI_GPT,
                resolvedModelRoute: createRuntimeResolvedModelRoute({
                  routeRef: {
                    routeKind: LABEL_PROVIDER_MODEL,
                    profileId: LABEL_PROVIDER_OPENAI,
                    modelId: LABEL_OPENAI_GPT,
                  },
                  providerProfileId: LABEL_PROVIDER_OPENAI,
                  provider: 'openai',
                  providerId: 'openai',
                  adapterId: 'openai-chat',
                  runtimeStatus: 'enabled',
                  endpointFamily: 'openai',
                  endpointType: 'responses',
                  baseUrl: 'https://api.openai.com/v1',
                  modelId: LABEL_OPENAI_GPT,
                  authKind: 'api-key',
                }),
                resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
                requestOptions: {},
              },
              orderedEvents: [
                {
                  eventType: 'tool_event',
                  sequence: 2,
                  createdAt: '2026-04-14T08:00:02Z',
                  payload: {
                    toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
                    toolId: LABEL_TOOL_REMOTE_SEARCH,
                    phase: 'failed',
                    title: '工具调用失败',
                    summary: '工具执行失败。',
                    inputSummary: LABEL_LOCATION_SHENZHEN,
                    errorSummary: 'boom',
                  },
                  toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
                  toolId: LABEL_TOOL_REMOTE_SEARCH,
                  phase: 'failed',
                  isRedacted: false,
                  redactionVersion: 0,
                },
                {
                  eventType: 'run_failed',
                  sequence: 3,
                  createdAt: LABEL_2026_14T08,
                  payload: {
                    code: 'agent_execution_failed',
                    message: 'Model stream collapsed.',
                    details: {
                      stage: 'execute_model',
                    },
                  },
                  toolCallId: null,
                  toolId: null,
                  phase: null,
                  isRedacted: false,
                  redactionVersion: 0,
                },
              ],
              toolCallBlocks: [],
              diagnosticBlocks: [],
              terminalState: null,
              availabilityInterpretation: null,
            },
          },
        })}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(rendered.container.textContent).toContain('发送失败')
    expect(rendered.container.textContent).toContain(DESC_CN_048)

    rendered.unmount()
  })

  })
  describe('send error handling', () => {
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请使用不存在的工具')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    expect(rendered.container.textContent).toContain('请使用不存在的工具')
    expect(rendered.container.textContent).toContain('发送失败')
    expect(rendered.container.textContent).toContain('当前所选工具暂不可用，请调整后重试。')

    await clickElement(rendered.getByTestId('chat-message-error-detail-button-1'))

    expect(rendered.getByTestId(LABEL_ERROR_DETAIL_OVERLAY).textContent).toContain('当前所选工具暂不可用，请调整后重试。')
    expect(rendered.getByTestId(LABEL_ERROR_DETAIL_OVERLAY).textContent).toContain('tool_not_found')
    expect(rendered.getByTestId(LABEL_ERROR_DETAIL_OVERLAY).textContent).toContain('run/start')

    rendered.unmount()
  })

  })
  describe('inline form validation and submission', () => {
  it('prevents inline form submission when local validation fails', async () => {
    const sendMessage = vi.fn((input: CopilotMessageDispatchInput) => createRuntimeMessageEventStream([
      {
        type: 'run_started',
        runId: 'run-inline-form-validation',
        sessionId: input.sessionId,
        sequence: 1,
        payload: {
          assistantMessageId: 'run-inline-form-validation:assistant',
        },
      },
      createRuntimeToolEvent({
        runId: 'run-inline-form-validation',
        sessionId: input.sessionId,
        sequence: 2,
        payload: {
          toolCallId: LABEL_TOOL_REQUEST_USER,
          toolId: LABEL_TOOL_REQUEST_USER_2,
          phase: 'completed',
          title: '请求课程表单',
          summary: '请填写课程编码。',
          formRequest: {
            formId: LABEL_COURSE_FORM,
            title: '请求课程表单',
            submitLabel: '提交',
            fields: [{
              name: 'courseCode',
              label: '课程编码',
              type: 'text',
              required: true,
            }],
          },
        },
      }),
      {
        type: 'run_failed',
        runId: 'run-inline-form-validation',
        sessionId: input.sessionId,
        sequence: 3,
        payload: {
          code: 'awaiting_user_input',
          message: LABEL_RUN_INTERRUPTED_UNTIL,
          details: {
            toolId: LABEL_TOOL_REQUEST_USER_2,
            toolCallId: LABEL_TOOL_REQUEST_USER,
          },
        },
      },
    ]))
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
        loadWorkspaceState={createPersistedWorkspaceStateLoader()}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '需要课程筛选条件')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    await clickElement(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_INLINE))

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(rendered.getByTestId('chat-message-inline-form-error-courseCode-1').textContent).toContain('此项为必填。')
    rendered.unmount()
  })

  it('submits inline form payload as a new user message and keeps the form readonly afterwards', async () => {
    const sendMessage = vi.fn()
      .mockImplementationOnce((input: CopilotMessageDispatchInput) => createRuntimeMessageEventStream([
        {
          type: 'run_started',
          runId: 'run-inline-form-first',
          sessionId: input.sessionId,
          sequence: 1,
          payload: {
            assistantMessageId: 'run-inline-form-first:assistant',
          },
        },
        createRuntimeToolEvent({
          runId: 'run-inline-form-first',
          sessionId: input.sessionId,
          sequence: 2,
          payload: {
            toolCallId: LABEL_TOOL_REQUEST_USER,
            toolId: LABEL_TOOL_REQUEST_USER_2,
            phase: 'completed',
            title: '请求课程表单',
            summary: '请填写课程编码。',
            formRequest: {
              formId: LABEL_COURSE_FORM,
              title: '请求课程表单',
              submitLabel: '提交',
              fields: [{
                name: 'courseCode',
                label: '课程编码',
                type: 'text',
                required: true,
              }],
            },
          },
        }),
        {
          type: 'run_failed',
          runId: 'run-inline-form-first',
          sessionId: input.sessionId,
          sequence: 3,
          payload: {
            code: 'awaiting_user_input',
            message: LABEL_RUN_INTERRUPTED_UNTIL,
            details: {
              toolId: LABEL_TOOL_REQUEST_USER_2,
              toolCallId: LABEL_TOOL_REQUEST_USER,
            },
          },
        },
      ]))
      .mockImplementationOnce((input: CopilotMessageDispatchInput) => createRuntimeMessageEventStream([
        {
          type: 'run_started',
          runId: 'run-inline-form-second',
          sessionId: input.sessionId,
          sequence: 1,
          payload: {
            assistantMessageId: 'run-inline-form-second:assistant',
          },
        },
        {
          type: 'text_delta',
          runId: 'run-inline-form-second',
          sessionId: input.sessionId,
          sequence: 2,
          payload: {
            assistantMessageId: 'run-inline-form-second:assistant',
            delta: '已收到课程编码。',
          },
        },
        {
          type: 'run_completed',
          runId: 'run-inline-form-second',
          sessionId: input.sessionId,
          sequence: 3,
          payload: {
            assistantMessageId: 'run-inline-form-second:assistant',
            assistantText: '已收到课程编码。',
            resolvedModelId: LABEL_OPENAI_GPT,
            resolvedModelRoute: createRuntimeResolvedModelRoute(),
            resolvedToolIds: [],
            requestOptions: {},
          },
        },
      ]))

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
        loadWorkspaceState={createPersistedWorkspaceStateLoader()}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '需要课程筛选条件')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    const field = rendered.getByTestId('chat-message-inline-form-field-courseCode-1').querySelector('input') as HTMLInputElement
    await setFormControlValue(field, 'CS304')
    await clickElement(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_INLINE))

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage.mock.calls[1]?.[0].message).toMatchObject({
      content: '已提交表单：请求课程表单\n课程编码: CS304',
      structuredPayload: {
        type: 'inline_form_submission',
        toolId: LABEL_TOOL_REQUEST_USER_2,
        toolCallId: LABEL_TOOL_REQUEST_USER,
        formId: LABEL_COURSE_FORM,
        values: {
          courseCode: 'CS304',
        },
      },
    })
    expect(rendered.queryByTestId('chat-message-inline-form-readonly-1')).toBeNull()
    expect(rendered.getByTestId('chat-message-inline-form-value-courseCode-1').textContent).toContain('CS304')
    expect(rendered.queryByTestId(SELECTOR_CHAT_MESSAGE_INLINE)).toBeNull()
    rendered.unmount()
  })

  })
  describe('inline form state management', () => {
  it('keeps the composer enabled while an inline form is pending and expires the old form after a normal send', async () => {
    const sendMessage = vi.fn()
      .mockImplementationOnce((input: CopilotMessageDispatchInput) => createRuntimeMessageEventStream([
        {
          type: 'run_started',
          runId: 'run-inline-form-pending',
          sessionId: input.sessionId,
          sequence: 1,
          payload: {
            assistantMessageId: 'run-inline-form-pending:assistant',
          },
        },
        createRuntimeToolEvent({
          runId: 'run-inline-form-pending',
          sessionId: input.sessionId,
          sequence: 2,
          payload: {
            toolCallId: LABEL_TOOL_REQUEST_USER,
            toolId: LABEL_TOOL_REQUEST_USER_2,
            phase: 'completed',
            title: '请求课程表单',
            summary: '请填写课程编码。',
            formRequest: {
              formId: LABEL_COURSE_FORM,
              title: '请求课程表单',
              submitLabel: '提交',
              fields: [{
                name: 'courseCode',
                label: '课程编码',
                type: 'text',
                required: true,
              }],
            },
          },
        }),
        {
          type: 'run_failed',
          runId: 'run-inline-form-pending',
          sessionId: input.sessionId,
          sequence: 3,
          payload: {
            code: 'awaiting_user_input',
            message: LABEL_RUN_INTERRUPTED_UNTIL,
            details: {
              toolId: LABEL_TOOL_REQUEST_USER_2,
              toolCallId: LABEL_TOOL_REQUEST_USER,
            },
          },
        },
      ]))
      .mockImplementationOnce((input: CopilotMessageDispatchInput) => createRuntimeMessageEventStream([
        {
          type: 'run_started',
          runId: 'run-inline-form-bypass',
          sessionId: input.sessionId,
          sequence: 1,
          payload: {
            assistantMessageId: 'run-inline-form-bypass:assistant',
          },
        },
        {
          type: 'text_delta',
          runId: 'run-inline-form-bypass',
          sessionId: input.sessionId,
          sequence: 2,
          payload: {
            assistantMessageId: 'run-inline-form-bypass:assistant',
            delta: '收到说明，继续普通对话。',
          },
        },
        {
          type: 'run_completed',
          runId: 'run-inline-form-bypass',
          sessionId: input.sessionId,
          sequence: 3,
          payload: {
            assistantMessageId: 'run-inline-form-bypass:assistant',
            assistantText: '收到说明，继续普通对话。',
            resolvedModelId: LABEL_OPENAI_GPT,
            resolvedModelRoute: createRuntimeResolvedModelRoute(),
            resolvedToolIds: [],
            requestOptions: {},
          },
        },
      ]))
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
        loadWorkspaceState={createPersistedWorkspaceStateLoader()}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    const composer = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement
    await setFormControlValue(messageInput, '需要课程筛选条件')
    await submitForm(composer)

    const sendButton = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_SEND) as HTMLButtonElement
    expect(rendered.getByTestId('chat-message-inline-form-card-1').textContent).toContain('填写后继续')
    expect(messageInput.disabled).toBe(false)
    expect(rendered.container.textContent).toContain('需要你补充信息')

    await setFormControlValue(messageInput, '先不用表单，直接说明原因')
    expect(sendButton.disabled).toBe(false)
    await submitForm(composer)

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage.mock.calls[1]?.[0].message).toMatchObject({
      content: '先不用表单，直接说明原因',
    })
    expect(rendered.getByTestId('chat-message-inline-form-expired-1').textContent).toContain('该表单已过期，不能继续提交。')
    expect(rendered.queryByTestId(SELECTOR_CHAT_MESSAGE_INLINE)).toBeNull()
    rendered.unmount()
  })

  it('keeps a pending inline form across session switches and keeps the composer usable after returning', async () => {
    const firstSessionShell = createSessionShell({ sessionId: 'session-inline-form-a' })
    const secondSessionShell = createSessionShell({ sessionId: 'session-inline-form-b' })
    const loadWorkspaceState = createPersistedWorkspaceStateLoader()

    const firstSessionState = createCopilotThreadRuntimeControllerState(firstSessionShell)
    const secondSessionState = createCopilotThreadRuntimeControllerState(secondSessionShell)
    const runtimeControllerBySessionId: Record<string, CopilotThreadRuntimeControllerState> = {
      [firstSessionShell.sessionId]: {
        ...firstSessionState,
        composerDraft: {
          ...firstSessionState.composerDraft,
          selectedModelId: 'provider-model|openrouter|openai%2Fgpt-4.1',
          selectedModelRoute: createRuntimeModelRoute({
            providerProfileId: 'openrouter',
            modelId: LABEL_OPENAI_GPT,
            routeRef: {
              routeKind: LABEL_PROVIDER_MODEL,
              profileId: 'openrouter',
              modelId: LABEL_OPENAI_GPT,
            },
          }),
        },
        conversation: [{
          id: 'session-inline-form-a:user-message',
          kind: 'user',
          title: '',
          content: '需要课程筛选条件',
          status: 'completed',
        }],
        runState: {
          ...firstSessionState.runState,
          phase: 'awaiting_input',
          runId: LABEL_RUN_INLINE_FORM,
          threadId: firstSessionShell.sessionId,
          failure: {
            code: 'awaiting_user_input',
            message: LABEL_RUN_INTERRUPTED_UNTIL,
            details: {
              toolId: LABEL_TOOL_REQUEST_USER_2,
              toolCallId: LABEL_TOOL_REQUEST_USER,
            },
          },
          segments: [{
            id: 'inline-form:run-inline-form-switch:tool.request-user-form:call-1',
            kind: 'inline-form',
            runId: LABEL_RUN_INLINE_FORM,
            startedSequence: 1,
            lastSequence: 1,
            status: 'completed',
            toolCallId: LABEL_TOOL_REQUEST_USER,
            toolId: LABEL_TOOL_REQUEST_USER_2,
            formId: LABEL_COURSE_FORM,
            title: '请求课程表单',
            summary: '请填写课程编码。',
            description: null,
            submitLabel: '提交',
            fields: [{
              name: 'courseCode',
              label: '课程编码',
              type: 'text',
              required: true,
            }],
            formState: 'pending',
            formValues: {
              courseCode: '',
            },
            submittedPayload: null,
          }],
        },
      },
      [secondSessionShell.sessionId]: {
        ...secondSessionState,
        composerDraft: {
          ...secondSessionState.composerDraft,
          selectedModelId: 'provider-model|openrouter|openai%2Fgpt-4.1',
          selectedModelRoute: createRuntimeModelRoute({
            providerProfileId: 'openrouter',
            modelId: LABEL_OPENAI_GPT,
            routeRef: {
              routeKind: LABEL_PROVIDER_MODEL,
              profileId: 'openrouter',
              modelId: LABEL_OPENAI_GPT,
            },
          }),
        },
      },
    }

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
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState({
          summary: {
            ...createLiveReadyButEmptyPersistedHistoryState().summary,
            threadId: firstSessionShell.sessionId,
            lastRunId: LABEL_RUN_INLINE_FORM,
            lastRunStatus: 'failed',
            lastUserMessagePreview: '需要课程筛选条件',
            lastAssistantMessagePreview: '请填写课程编码。',
          },
          selectedRunId: LABEL_RUN_INLINE_FORM,
          runSummaries: [{
            runId: LABEL_RUN_INLINE_FORM,
            threadId: firstSessionShell.sessionId,
            status: 'failed',
            createdAt: LABEL_2026_14T08_2,
            updatedAt: LABEL_2026_14T08,
            startedAt: LABEL_2026_14T08_3,
            terminalAt: LABEL_2026_14T08,
            resolvedModelId: LABEL_OPENAI_GPT,
            requestedMessageText: '需要课程筛选条件',
            assistantText: '请填写课程编码。',
          }],
        })}
        loadWorkspaceState={loadWorkspaceState}
        runtimeControllerBySessionId={runtimeControllerBySessionId}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(rendered.container.textContent).toContain('需要课程筛选条件')
    expect(rendered.container.textContent).toContain('请求课程表单')
    expect(rendered.container.textContent).toContain('填写后继续')

    rendered.rerender(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={secondSessionShell}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createLiveReadyButEmptyPersistedHistoryState({
          summary: {
            ...createLiveReadyButEmptyPersistedHistoryState().summary,
            threadId: secondSessionShell.sessionId,
            lastRunId: 'run-second-session',
          },
          selectedRunId: 'run-second-session',
        })}
        loadWorkspaceState={loadWorkspaceState}
        runtimeControllerBySessionId={runtimeControllerBySessionId}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(rendered.container.textContent).not.toContain('需要课程筛选条件')
    expect(rendered.container.textContent).not.toContain('请求课程表单')

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
          summary: {
            ...createLiveReadyButEmptyPersistedHistoryState().summary,
            threadId: firstSessionShell.sessionId,
            lastRunId: LABEL_RUN_INLINE_FORM,
            lastRunStatus: 'failed',
            lastUserMessagePreview: '需要课程筛选条件',
            lastAssistantMessagePreview: '请填写课程编码。',
          },
          selectedRunId: LABEL_RUN_INLINE_FORM,
          runSummaries: [{
            runId: LABEL_RUN_INLINE_FORM,
            threadId: firstSessionShell.sessionId,
            status: 'failed',
            createdAt: LABEL_2026_14T08_2,
            updatedAt: LABEL_2026_14T08,
            startedAt: LABEL_2026_14T08_3,
            terminalAt: LABEL_2026_14T08,
            resolvedModelId: LABEL_OPENAI_GPT,
            requestedMessageText: '需要课程筛选条件',
            assistantText: '请填写课程编码。',
          }],
        })}
        loadWorkspaceState={loadWorkspaceState}
        runtimeControllerBySessionId={runtimeControllerBySessionId}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const fieldAfterReturn = rendered.container.querySelector('[data-testid^="chat-message-inline-form-field-courseCode-"] input') as HTMLInputElement
    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    expect(fieldAfterReturn).not.toBeNull()
    expect(fieldAfterReturn.disabled).toBe(false)
    expect(messageInput.disabled).toBe(false)
    await setFormControlValue(fieldAfterReturn, 'CS304')
    await setFormControlValue(messageInput, '切回后直接继续普通对话')
    expect(messageInput.disabled).toBe(false)
    rendered.unmount()
  })


  it('does not expose inline form protocol details in the form card UI', async () => {
    const sendMessage = vi.fn((input: CopilotMessageDispatchInput) => createRuntimeMessageEventStream([
      {
        type: 'run_started',
        runId: 'run-inline-form-clean-ui',
        sessionId: input.sessionId,
        sequence: 1,
        payload: {
          assistantMessageId: 'run-inline-form-clean-ui:assistant',
        },
      },
      createRuntimeToolEvent({
        runId: 'run-inline-form-clean-ui',
        sessionId: input.sessionId,
        sequence: 2,
        payload: {
          toolCallId: LABEL_TOOL_REQUEST_USER,
          toolId: LABEL_TOOL_REQUEST_USER_2,
          phase: 'completed',
          title: '请求课程表单',
          summary: '请填写课程编码。',
          formRequest: {
            formId: LABEL_COURSE_FORM,
            title: '请求课程表单',
            fields: [{
              name: 'courseCode',
              label: '课程编码',
              type: 'text',
              required: true,
            }],
          },
        },
      }),
      {
        type: 'run_failed',
        runId: 'run-inline-form-clean-ui',
        sessionId: input.sessionId,
        sequence: 3,
        payload: {
          code: 'awaiting_user_input',
          message: LABEL_RUN_INTERRUPTED_UNTIL,
          details: {},
        },
      },
    ]))
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
        loadWorkspaceState={createPersistedWorkspaceStateLoader()}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '需要课程筛选条件')
    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    const cardText = rendered.getByTestId('chat-message-inline-form-card-1').textContent ?? ''
    expect(cardText).not.toContain('fieldCount')
    expect(cardText).not.toContain('formId')
    expect(cardText).not.toContain('type')
    rendered.unmount()
  })

  })
  describe('thread drift and rebinding', () => {
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    const sendButton = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_SEND) as HTMLButtonElement
    const scrollRegion = rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL) as HTMLDivElement
    await setFormControlValue(messageInput, '请执行一次真实流式对话')

    expect(sendButton.disabled).toBe(true)
    expect(sendButton.title).toBe(DESC_CN_038)

    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(0)
    expect(scrollRegion.textContent).toContain(DESC_CN_038)
    expect(rendered.container.querySelector('.copilot-chat__composer .copilot-panel__error')).toBeNull()

    await clickElement(rendered.getByTestId('chat-message-error-detail-button-0'))

    expect(rendered.getByTestId(LABEL_ERROR_DETAIL_OVERLAY).textContent).toContain(DESC_CN_038)
    expect(rendered.getByTestId(LABEL_ERROR_DETAIL_OVERLAY).textContent).toContain('selected_model_unavailable')
    expect(rendered.getByTestId(LABEL_ERROR_DETAIL_OVERLAY).textContent).toContain('工具 / 模型上下文')
    expect(rendered.getByTestId(LABEL_ERROR_DETAIL_OVERLAY).textContent).toContain('模型gpt-5.4')

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

    const composer = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement
    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    const sendButton = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_SEND) as HTMLButtonElement
    await setFormControlValue(messageInput, '继续这个历史线程')

    expect(rendered.getByTestId(SELECTOR_CHAT_HISTORY_DRIFT).textContent).toContain('当前配置与历史线程存在差异')
    expect(rendered.getByTestId(SELECTOR_CHAT_HISTORY_DRIFT).textContent).toContain('历史模型')
    expect(rendered.getByTestId(SELECTOR_CHAT_HISTORY_DRIFT).textContent).toContain(LABEL_LEGACY_MODEL)
    expect(rendered.getByTestId(SELECTOR_CHAT_HISTORY_DRIFT).textContent).toContain('历史工具')
    expect(rendered.getByTestId(SELECTOR_CHAT_HISTORY_DRIFT).textContent).toContain(LABEL_TOOL_REMOTE_SEARCH)
    expect(rendered.getByTestId(SELECTOR_CHAT_HISTORY_DRIFT).textContent).toContain('历史思考')
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
          routeKind: LABEL_PROVIDER_MODEL,
          profileId: 'openrouter',
          modelId: LABEL_OPENAI_GPT,
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

    const composer = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement
    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    const sendButton = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_SEND) as HTMLButtonElement
    await setFormControlValue(messageInput, '恢复后直接继续聊天')

    expect(rendered.queryByTestId(SELECTOR_CHAT_HISTORY_DRIFT)).toBeNull()
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

  })
  describe('history continuation and cancel', () => {
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

    const composer = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement
    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    const scrollRegion = rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL) as HTMLDivElement
    await setFormControlValue(messageInput, '第一次先触发不支持路由错误')
    await submitForm(composer)

    expect(scrollRegion.textContent).toContain(DESC_CN_038)
    expect(rendered.container.querySelector('.copilot-chat__composer .copilot-panel__error')).toBeNull()

    await clickElement(rendered.getByTestId(SELECTOR_CHAT_MODEL_PICKER))
    await clickElement(rendered.getByTestId('chat-model-option-provider-openai-provider-openai:openai/gpt-4.1'))
    await setFormControlValue(messageInput, '第二次发送应恢复成功')
    await submitForm(composer)
    await waitForText(rendered.container, '这是助手回显')

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(scrollRegion.textContent).not.toContain(DESC_CN_038)
    expect(scrollRegion.textContent).toContain('第二次发送应恢复成功')
    expect(scrollRegion.textContent).toContain('这是助手回显')

    rendered.unmount()
  })

  it('keeps the input editable during an in-flight send, hides composer status text, and still allows cancellation', async () => {
    const sendMessage = createAbortableSendMessageSpy()
    const cancelRun = vi.fn(async (): ReturnType<typeof cancelRuntimeRun> => createRuntimeRunCancelResponse({
      run: {
        runId: LABEL_RUN_CANCEL,
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

    const messageInput = rendered.container.querySelector(LABEL_TEXTAREA_NAME_MESSAGETEXT) as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请开始并允许我取消')

    await submitForm(rendered.getByTestId(SELECTOR_CHAT_COMPOSER_DOCK) as HTMLFormElement)
    await waitForText(rendered.container, '第一段')

    const sendButton = rendered.getByTestId(SELECTOR_CHAT_COMPOSER_SEND) as HTMLButtonElement
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
      runtimeUrl: LABEL_HTTP_127,
      runId: LABEL_RUN_CANCEL,
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
        toolCallId: 'tool.remote-search:call-placeholder',
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'started',
        title: '调用天气工具',
        summary: DESC_CN_022,
        inputSummary: LABEL_LOCATION_SHENZHEN,
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
          toolId: LABEL_TOOL_REMOTE_SEARCH,
        },
      },
    }
  })
}

function createResolvedSendMessageSpy() {
  return vi.fn((input: CopilotMessageDispatchInput) => {
    const routeRef = input.modelRoute.routeRef ?? {
      routeKind: LABEL_PROVIDER_MODEL as const,
      profileId: LABEL_UNKNOWN_PROFILE,
      modelId: LABEL_UNKNOWN_MODEL,
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
            endpointType: LABEL_OPENAI_COMPATIBLE_2,
            baseUrl: LABEL_HTTPS_API_EXAMPLE,
            modelId: routeRef.modelId,
            catalogRevision: input.modelRoute.catalogRevision ?? LABEL_2026,
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
      routeKind: LABEL_PROVIDER_MODEL as const,
      profileId: LABEL_UNKNOWN_PROFILE,
      modelId: LABEL_UNKNOWN_MODEL,
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
          endpointType: LABEL_OPENAI_COMPATIBLE_2,
          baseUrl: LABEL_HTTPS_API_EXAMPLE,
          modelId: routeRef.modelId,
          catalogRevision: input.modelRoute.catalogRevision ?? LABEL_2026,
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
      routeKind: LABEL_PROVIDER_MODEL as const,
      profileId: LABEL_UNKNOWN_PROFILE,
      modelId: LABEL_UNKNOWN_MODEL,
    }

    return createRuntimeMessageEventStream([
      {
        type: 'run_started',
        runId: LABEL_RUN_TOOL_SUCCESS,
        sessionId: input.sessionId,
        sequence: 1,
        payload: {
          assistantMessageId: 'run-tool-success:assistant',
        },
      },
      createRuntimeToolEvent({
        runId: LABEL_RUN_TOOL_SUCCESS,
        sessionId: input.sessionId,
        sequence: 2,
        payload: {
          toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          phase: 'started',
          title: '调用天气工具',
          summary: DESC_CN_022,
          inputSummary: LABEL_LOCATION_SHENZHEN,
        },
      }),
      createRuntimeToolEvent({
        runId: LABEL_RUN_TOOL_SUCCESS,
        sessionId: input.sessionId,
        sequence: 3,
        payload: {
          toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          phase: 'completed',
          title: '天气工具已返回结果',
          summary: '{\n  "condition": "晴",\n  "humidity": 60,\n  "location": "Shenzhen",\n  "summary": "体感舒适，适合外出。",\n  "temperatureC": 24\n}',
          inputSummary: LABEL_LOCATION_SHENZHEN,
          resultSummary: DESC_CN_045,
        },
      }),
      {
        type: 'text_delta',
        runId: LABEL_RUN_TOOL_SUCCESS,
        sessionId: input.sessionId,
        sequence: 4,
        payload: {
          assistantMessageId: 'run-tool-success:assistant',
          delta: '这是助手回显',
        },
      },
      {
        type: 'run_completed',
        runId: LABEL_RUN_TOOL_SUCCESS,
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
            endpointType: LABEL_OPENAI_COMPATIBLE_2,
            baseUrl: LABEL_HTTPS_API_EXAMPLE,
            modelId: routeRef.modelId,
            catalogRevision: input.modelRoute.catalogRevision ?? LABEL_2026,
          }),
          resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
          requestOptions: input.requestOptions ?? {},
        },
      },
    ])
  })
}

function createToolFailureSendMessageSpy() {
  return vi.fn((input: CopilotMessageDispatchInput) => {
    const routeRef = input.modelRoute.routeRef ?? {
      routeKind: LABEL_PROVIDER_MODEL as const,
      profileId: LABEL_UNKNOWN_PROFILE,
      modelId: LABEL_UNKNOWN_MODEL,
    }

    return createRuntimeMessageEventStream([
      {
        type: 'run_started',
        runId: LABEL_RUN_TOOL_FAILED,
        sessionId: input.sessionId,
        sequence: 1,
        payload: {
          assistantMessageId: 'run-tool-failed:assistant',
        },
      },
      createRuntimeToolEvent({
        runId: LABEL_RUN_TOOL_FAILED,
        sessionId: input.sessionId,
        sequence: 2,
        payload: {
          toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          phase: 'started',
          title: '调用天气工具',
          summary: DESC_CN_022,
          inputSummary: LABEL_LOCATION_SHENZHEN,
        },
      }),
      createRuntimeToolEvent({
        runId: LABEL_RUN_TOOL_FAILED,
        sessionId: input.sessionId,
        sequence: 3,
        payload: {
          toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          phase: 'failed',
          title: '工具调用失败',
          summary: '工具执行失败。',
          inputSummary: LABEL_LOCATION_SHENZHEN,
          errorSummary: 'boom',
        },
      }),
      {
        type: 'text_delta',
        runId: LABEL_RUN_TOOL_FAILED,
        sessionId: input.sessionId,
        sequence: 4,
        payload: {
          assistantMessageId: 'run-tool-failed:assistant',
          delta: DESC_CN_028,
        },
      },
      {
        type: 'run_completed',
        runId: LABEL_RUN_TOOL_FAILED,
        sessionId: input.sessionId,
        sequence: 5,
        payload: {
          assistantMessageId: 'run-tool-failed:assistant',
          assistantText: DESC_CN_028,
          resolvedModelId: routeRef.modelId,
          resolvedModelRoute: createRuntimeResolvedModelRoute({
            routeRef,
            providerProfileId: routeRef.profileId,
            provider: 'openai',
            providerId: 'openai',
            adapterId: 'openai',
            endpointFamily: 'openai',
            endpointType: LABEL_OPENAI_COMPATIBLE_2,
            baseUrl: LABEL_HTTPS_API_EXAMPLE,
            modelId: routeRef.modelId,
            catalogRevision: input.modelRoute.catalogRevision ?? LABEL_2026,
          }),
          resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
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
      runId: LABEL_RUN_TOOL_THEN,
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-tool-then-failed:assistant',
      },
    },
    createRuntimeToolEvent({
      runId: LABEL_RUN_TOOL_THEN,
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'started',
        title: '调用天气工具',
        summary: DESC_CN_022,
        inputSummary: LABEL_LOCATION_SHENZHEN,
      },
    }),
    createRuntimeToolEvent({
      runId: LABEL_RUN_TOOL_THEN,
      sessionId: input.sessionId,
      sequence: 3,
      payload: {
        toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'failed',
        title: '工具调用失败',
        summary: '工具执行失败。',
        inputSummary: LABEL_LOCATION_SHENZHEN,
        errorSummary: 'boom',
      },
    }),
    {
      type: 'run_failed',
      runId: LABEL_RUN_TOOL_THEN,
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

function createToolWaitingApprovalSendMessageSpy(
  control: DeferredSignal,
  options?: {
    approval?: {
      mode: 'allow' | 'ask' | 'delay' | 'deny'
      timeoutAt: string | null
      timeoutSeconds: number | null
      timeoutAction: 'approve' | 'deny' | null
    }
  },
) {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<RuntimeRunEvent> {
    yield {
      type: 'run_started',
      runId: 'run-tool-approval',
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-tool-approval:assistant',
      },
    }

    await control.wait()

    yield createRuntimeToolEvent({
      runId: 'run-tool-approval',
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        toolCallId: 'tool.remote-search:call-approve',
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'waiting_approval',
        title: '工具等待审批',
        summary: '工具调用正在等待审批决议。',
        inputSummary: LABEL_LOCATION_SHENZHEN,
        security: {
          riskLevel: 'high',
          approvalMethod: 'accept_reject',
        },
        approval: options?.approval ?? {
          mode: 'delay',
          timeoutAt: new Date(Date.now() + 30_000).toISOString(),
          timeoutSeconds: 30,
          timeoutAction: 'deny',
        },
      },
    })

    await waitForAbort(input.signal)
  })
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
      createdAt: LABEL_2026_13T15_2,
      updatedAt: LABEL_2026_13T15,
      lastActivityAt: LABEL_2026_13T15,
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
      createdAt: LABEL_2026_14T08_2,
      updatedAt: LABEL_2026_14T08,
      lastActivityAt: LABEL_2026_14T08,
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
    historicalModelId: LABEL_LEGACY_MODEL,
    historicalToolIds: [LABEL_TOOL_REMOTE_SEARCH],
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
      createdAt: LABEL_2026_13T15_2,
      updatedAt: LABEL_2026_13T15,
      lastActivityAt: LABEL_2026_13T15,
      lastRunId: LABEL_RUN_HISTORY,
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
        runId: LABEL_RUN_HISTORY,
        sequenceStart: 1,
        sequenceEnd: 1,
        text: '历史摘要',
      },
    ],
    runSummaries: [
      {
        runId: LABEL_RUN_HISTORY,
        threadId: 'session-1',
        status: 'completed',
        createdAt: LABEL_2026_13T15_2,
        updatedAt: LABEL_2026_13T15,
        startedAt: '2026-04-13T15:00:01Z',
        terminalAt: LABEL_2026_13T15,
        resolvedModelId: LABEL_LEGACY_MODEL,
        requestedMessageText: '你好',
        assistantText: '历史摘要',
      },
    ],
    latestConfigurationSnapshot: null,
    availabilityDrift: driftPayload,
    selectedRunId: LABEL_RUN_HISTORY,
    replayStatus: 'ready',
    replayError: null,
    replay: {
      ok: true,
      version: 'chat-history-v1',
      run: {
        runId: LABEL_RUN_HISTORY,
        threadId: 'session-1',
        status: 'completed',
        createdAt: LABEL_2026_13T15_2,
        updatedAt: LABEL_2026_13T15,
        startedAt: '2026-04-13T15:00:01Z',
        terminalAt: LABEL_2026_13T15,
        resolvedModelId: LABEL_LEGACY_MODEL,
        requestedMessageText: '你好',
        assistantText: '历史摘要',
      },
      historicalSnapshot: {
        resolvedModelId: LABEL_LEGACY_MODEL,
        resolvedModelRoute: {
          routeRef: {
            routeKind: LABEL_PROVIDER_MODEL,
            profileId: 'provider-legacy',
            modelId: LABEL_LEGACY_MODEL,
          },
        },
        resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
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
      runId: LABEL_RUN_CANCEL,
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-cancel:assistant',
      },
    }

    await Promise.resolve()
    yield createRuntimeToolEvent({
      runId: LABEL_RUN_CANCEL,
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'started',
        title: '调用天气工具',
        summary: DESC_CN_022,
        inputSummary: LABEL_LOCATION_SHENZHEN,
      },
    })

    await Promise.resolve()
    yield {
      type: 'text_delta',
      runId: LABEL_RUN_CANCEL,
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
      runId: LABEL_RUN_CANCEL,
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

function restoreAttachmentManagerApi() {
  Object.defineProperty(window, 'attachmentManager', {
    configurable: true,
    writable: true,
    value: {
      resolveFilePath: vi.fn(() => null),
      readClipboardData: vi.fn(async () => ({ ok: true, status: 'empty', availableFormats: [] })),
      writeTempFile: vi.fn(async () => ({
        ok: true,
        file: {
          path: 'temp-image.png',
          name: 'temp-image.png',
          mimeType: 'image/png',
          size: 0,
          createdAt: '2026-05-09T00:00:00.000Z',
          isTemporary: true,
        },
      })),
      readPreview: vi.fn(async () => ({
        ok: true,
        kind: 'unsupported',
        path: 'unknown.bin',
        name: 'unknown.bin',
        size: 0,
        reason: 'unsupported_type',
      })),
      cleanupTempFiles: vi.fn(async () => ({
        ok: true,
        deletedPaths: [],
        missingPaths: [],
        skippedPaths: [],
      })),
    } as Window['attachmentManager'],
  })
}

function createFileWithPath(input: {
  name: string
  type: string
  path: string
  content: string
}) {
  const file = new File([input.content], input.name, { type: input.type })
  Object.defineProperty(file, 'path', {
    configurable: true,
    value: input.path,
  })
  return file
}

function createPasteEvent(input: {
  types: string[]
  items: Array<{ kind: string; type: string }>
  files: File[]
}) {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: {
      types: string[]
      items: Array<{ kind: string; type: string }>
      files: File[]
    }
  }

  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: {
      types: input.types,
      items: input.items,
      files: input.files,
    },
  })

  return event
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
