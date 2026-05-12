/** @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { act } from 'react'
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

import { CopilotChatPanel } from './CopilotChatPanel'
import {
  cancelRuntimeRun,
} from './chat-contract'
import {
  createRuntimeRunCancelResponse,
} from './chat-contract.test-support'
import {
  clickElement,
  createDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
  pressTextareaKey,
  renderWithRoot,
  setFormControlValue,
  submitForm,
} from './CopilotChatPanel.test-support'
import { createPersistedWorkspaceState, createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'
import {
  // Constants
  DESC_CN_038,
  LABEL_ERROR_DETAIL_OVERLAY,
  LABEL_HTTP_127,
  LABEL_LEGACY_MODEL,
  LABEL_OPENAI_COMPATIBLE,
  LABEL_OPENAI_GPT,
  LABEL_PROVIDER_MODEL,
  LABEL_PROVIDER_OPENAI,
  LABEL_PROVIDER_OPENAI_OPENAI,
  LABEL_RUN_CANCEL,
  LABEL_TEXTAREA_NAME_MESSAGETEXT,
  LABEL_TOOL_REMOTE_SEARCH,
  SELECTOR_CHAT_COMPOSER_DOCK,
  SELECTOR_CHAT_COMPOSER_SEND,
  SELECTOR_CHAT_HISTORY_DRIFT,
  SELECTOR_CHAT_MESSAGE_SCROLL,
  SELECTOR_CHAT_MODEL_PICKER,
  // Lifecycle helpers
  restoreNotificationApi,
  restoreAttachmentManagerApi,
  // Helper functions
  createResolvedSendMessageSpy,
  createPersistedWorkspaceStateLoader,
  createHistoryStateWithProviderDrift,
  createAbortableSendMessageSpy,
  waitForText,
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

/* eslint-disable-next-line max-lines-per-function -- organizational wrapper for composer interaction test groups */
describe('CopilotChatPanel composer interactions', () => {
  /* eslint-disable-next-line max-lines-per-function -- three integration tests for thread drift/rebinding scenarios, each requiring independent full render setup */
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
  /* eslint-disable-next-line max-lines-per-function -- two integration tests for history continuation/cancel scenarios, each requiring independent full render setup */
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
