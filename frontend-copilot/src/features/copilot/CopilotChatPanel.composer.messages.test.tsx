/** @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-unused-vars */

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
import {
  // Constants
  DESC_CN_019,
  DESC_CN_022,
  DESC_CN_028,
  DESC_CN_038,
  DESC_CN_045,
  DESC_CN_048,
  LABEL_2026,
  LABEL_2026_13T15,
  LABEL_2026_13T15_2,
  LABEL_2026_14T08,
  LABEL_2026_14T08_2,
  LABEL_2026_14T08_3,
  LABEL_CLAUDE,
  LABEL_COURSE_FORM,
  LABEL_ERROR_DETAIL_OVERLAY,
  LABEL_HTTPS_API_EXAMPLE,
  LABEL_HTTP_127,
  LABEL_LEGACY_MODEL,
  LABEL_LOCATION_SHENZHEN,
  LABEL_OPENAI_COMPATIBLE,
  LABEL_OPENAI_COMPATIBLE_2,
  LABEL_OPENAI_GPT,
  LABEL_PROVIDER_BETA,
  LABEL_PROVIDER_MODEL,
  LABEL_PROVIDER_OPENAI,
  LABEL_PROVIDER_OPENAI_OPENAI,
  LABEL_RUN_CANCEL,
  LABEL_RUN_HISTORY,
  LABEL_RUN_INLINE_FORM,
  LABEL_RUN_INTERRUPTED_UNTIL,
  LABEL_RUN_TOOL_FAILED,
  LABEL_RUN_TOOL_SUCCESS,
  LABEL_RUN_TOOL_THEN,
  LABEL_SHARED_MODEL,
  LABEL_TEXTAREA_NAME_MESSAGETEXT,
  LABEL_TOOL_READ,
  LABEL_TOOL_REMOTE_SEARCH,
  LABEL_TOOL_REMOTE_SEARCH_2,
  LABEL_TOOL_REQUEST_USER,
  LABEL_TOOL_REQUEST_USER_2,
  LABEL_UNKNOWN_MODEL,
  LABEL_UNKNOWN_PROFILE,
  SELECTOR_ARIA_EXPANDED,
  SELECTOR_ARIA_PRESSED,
  SELECTOR_CHAT_ASSISTANT_PLACEHOLDER,
  SELECTOR_CHAT_COMPOSER_DOCK,
  SELECTOR_CHAT_COMPOSER_SEND,
  SELECTOR_CHAT_HISTORY_DRIFT,
  SELECTOR_CHAT_MESSAGE_INLINE,
  SELECTOR_CHAT_MESSAGE_SCROLL,
  SELECTOR_CHAT_MESSAGE_TOOL,
  SELECTOR_CHAT_MESSAGE_TOOL_2,
  SELECTOR_CHAT_MESSAGE_TOOL_3,
  SELECTOR_CHAT_MODEL_PICKER,
  SELECTOR_CHAT_TOOL_OPTION,
  SELECTOR_COPILOT_CHAT_PANEL,
  // Lifecycle helpers
  restoreNotificationApi,
  restoreAttachmentManagerApi,
  // Helper functions
  createResolvedSendMessageSpy,
  createDeferredSignal,
  createDeferredResolvedSendMessageSpy,
  createToolLifecycleSendMessageSpy,
  createToolFailureSendMessageSpy,
  createToolFailureThenFatalSendMessageSpy,
  createToolWaitingApprovalSendMessageSpy,
  createStartOnlyPendingSendMessageSpy,
  createToolFirstPendingSendMessageSpy,
  createTextFirstPendingSendMessageSpy,
  createFailedBeforeAssistantSendMessageSpy,
  createPersistedWorkspaceStateLoader,
  createLoadingPersistedHistoryState,
  createLiveReadyButEmptyPersistedHistoryState,
  createHistoryStateWithProviderDrift,
  createAbortableSendMessageSpy,
  installMockDesktopNotification,
  installRejectingMockDesktopNotification,
  createFileWithPath,
  createPasteEvent,
  waitForAbort,
  waitForCondition,
  waitForText,
  type DeferredSignal,
  type MockDesktopNotificationController,
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

describe('CopilotChatPanel composer interactions', () => {
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
})
