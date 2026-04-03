/** @vitest-environment jsdom */

import { act } from 'react'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

import { CopilotChatPanel } from './CopilotChatPanel'
import {
  cancelRuntimeRun,
  RuntimeRequestError,
  sendRuntimeMessage,
  type RuntimeRunEvent,
} from './chat-contract'
import {
  createRuntimeMessageEventStream,
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
    expect(getTriggerIconText(modelTrigger)).toBe('O')

    await clickElement(modelTrigger)
    expect(rendered.container.textContent).toContain('OpenAI Compatible')
    expect(rendered.container.textContent).toContain('Beta Router')
    await clickElement(rendered.getByTestId('chat-model-option-provider-beta-provider-beta:openai/gpt-4.1-mini'))

    expect(modelTrigger.textContent).toContain('GPT 4.1 Mini')
    expect(getTriggerIconText(modelTrigger)).toBe('B')

    await setFormControlValue(messageInput, '请总结刚才的内容')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      modelRoute: {
        providerProfileId: 'provider-beta',
        snapshot: {
          provider: 'openai',
          modelId: 'openai/gpt-4.1-mini',
        },
      },
      message: {
        content: '请总结刚才的内容',
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

  it('keeps an invalid selected model visible after persisted settings remove it, excludes it from candidates, and clears invalid state after reselecting a valid model', async () => {
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: 'provider-active',
            name: 'Active Provider',
            availableModels: [
              {
                id: 'provider-active:openai/gpt-4.1',
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
            id: 'provider-empty',
            name: 'Empty Provider',
            availableModels: [],
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
        sessionShell={createSessionShell({
          capabilities: {
            defaultModelPreference: 'legacy/retired-model',
          },
        })}
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
    expect(modelTrigger.textContent).toContain('legacy/retired-model')
    expect(rendered.getByTestId('chat-model-picker-invalid-badge').textContent).toContain('失效')

    await clickElement(modelTrigger)

    expect(rendered.getByTestId('chat-model-group-empty-provider-empty')).not.toBeNull()
    expect(rendered.queryByTestId('chat-model-option-provider-active-legacy/retired-model')).toBeNull()
    await clickElement(rendered.getByTestId('chat-model-option-provider-active-provider-active:openai/gpt-4.1'))

    expect(modelTrigger.textContent).toContain('GPT 4.1')
    expect(rendered.queryByTestId('chat-model-picker-invalid-badge')).toBeNull()

    rendered.unmount()
  })

  it('shows the explicit no-model empty state and clears session-level fallback model when no configured models exist', async () => {
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
        sessionShell={createSessionShell({
          capabilities: {
            defaultModelPreference: 'openai/gpt-4.1',
          },
        })}
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
    expect(sendButton.title).toBe('尚未配置模型，请先前往设置页添加模型服务商和模型。')
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
    expect(composerSurface.style.height).toBe('160px')

    await dragComposerResizeHandle(resizeHandle, 420, 340)
    expect(composerSurface.style.height).toBe('240px')

    await dragComposerResizeHandle(resizeHandle, 340, 900)
    expect(composerSurface.style.height).toBe('120px')

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
    expect(renderedIcon?.textContent).toBe('O')
    expect(renderedIcon?.getAttribute('aria-label')).toBe('GPT 4.1 图标')
    expect(rendered.container.textContent).not.toContain('已完成')
    expect(rendered.container.querySelectorAll('.copilot-chat__message--assistant.copilot-chat__message--completed')).toHaveLength(1)

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
    await waitForText(rendered.container, '天气工具已返回结果')

    const textContent = rendered.container.textContent ?? ''
    expect(textContent).toContain('Shenzhen：晴 / 24°C / 湿度 60%')
    expect(textContent).toContain('{"location":"Shenzhen"}')
    expect(textContent).toContain('这是助手回显')
    expect(textContent).not.toContain('正在获取 Shenzhen 的天气。')
    expect(textContent.indexOf('天气工具已返回结果')).toBeLessThan(textContent.indexOf('这是助手回显'))
    expect(rendered.container.querySelectorAll('.copilot-chat__message--tool.copilot-chat__message--completed')).toHaveLength(1)

    rendered.unmount()
  })

  it('keeps a failed tool step visible when the runtime emits tool_event failed', async () => {
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

    expect(rendered.container.textContent).toContain('工具执行失败。')
    expect(rendered.container.textContent).toContain('boom')
    expect(rendered.container.textContent).toContain('发送失败')
    expect(rendered.container.querySelectorAll('.copilot-chat__message--tool.copilot-chat__message--failed')).toHaveLength(1)

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
    expect(rendered.container.textContent).toContain('tool_not_found：本次消息启用了后端未注册的 toolId')

    rendered.unmount()
  })

  it('disables send and surfaces an explicit message when the selected route endpoint type is not supported for streaming chat', async () => {
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
            defaultModel: 'gpt-5.4',
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
        sessionShell={createSessionShell({
          capabilities: {
            defaultModelPreference: 'provider-response:gpt-5.4',
          },
        })}
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
    await setFormControlValue(messageInput, '请执行一次真实流式对话')

    expect(sendButton.disabled).toBe(true)
    expect(sendButton.title).toBe('当前流式聊天暂不支持“openai-response”端点类型，请切换到 openai-compatible 模型路由。')

    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(0)
    expect(rendered.container.textContent).toContain('当前流式聊天暂不支持“openai-response”端点类型，请切换到 openai-compatible 模型路由。')

    rendered.unmount()
  })

  it('allows cancelling an in-flight send, stops later deltas, and surfaces cancelled state', async () => {
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
    expect(rendered.getByTestId('chat-composer-run-status').textContent).toContain('响应生成中，可随时取消。')
    expect(rendered.container.textContent).toContain('调用天气工具')
    expect(rendered.container.textContent).toContain('第一段')
    expect(rendered.container.textContent).not.toContain('第二段')

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
    expect(rendered.getByTestId('chat-composer-run-status').textContent).toContain('当前响应已取消，未定稿为成功消息。')
    expect(rendered.container.textContent).toContain('调用天气工具')
    expect(rendered.container.textContent).toContain('第一段')
    expect(rendered.container.textContent).not.toContain('第二段')
    expect(rendered.container.textContent).not.toContain('已完成')
    expect(rendered.container.querySelectorAll('.copilot-chat__message--tool.copilot-chat__message--cancelled')).toHaveLength(1)

    rendered.unmount()
  })
})

function createResolvedSendMessageSpy() {
  return vi.fn((input: Parameters<typeof sendRuntimeMessage>[0]) => createRuntimeMessageEventStream([
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
        resolvedModelId: input.modelRoute.snapshot.modelId,
        resolvedModelRoute: input.modelRoute,
        resolvedToolIds: input.enabledTools,
        requestOptions: input.requestOptions ?? {},
      },
    },
  ]))
}

function createToolLifecycleSendMessageSpy() {
  return vi.fn((input: Parameters<typeof sendRuntimeMessage>[0]) => createRuntimeMessageEventStream([
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
        summary: 'Shenzhen：晴 / 24°C / 湿度 60%',
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
        resolvedModelId: input.modelRoute.snapshot.modelId,
        resolvedModelRoute: input.modelRoute,
        resolvedToolIds: ['tool.weather-current'],
        requestOptions: input.requestOptions ?? {},
      },
    },
  ]))
}

function createToolFailureSendMessageSpy() {
  return vi.fn((input: Parameters<typeof sendRuntimeMessage>[0]) => createRuntimeMessageEventStream([
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
      type: 'run_failed',
      runId: 'run-tool-failed',
      sessionId: input.sessionId,
      sequence: 4,
      payload: {
        code: 'tool_execution_failed',
        message: 'Tool failed: boom',
        details: {
          toolId: 'tool.weather-current',
          toolCallId: 'tool.weather-current:call-1',
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

function createAbortableSendMessageSpy() {
  return vi.fn(async function* (
    input: Parameters<typeof sendRuntimeMessage>[0],
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
