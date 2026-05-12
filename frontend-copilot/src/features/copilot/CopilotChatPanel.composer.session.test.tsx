/** @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { act } from 'react'
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

import { CopilotChatPanel } from './CopilotChatPanel'
import {
  createDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
  renderWithRoot,
  setFormControlValue,
  submitForm,
} from './CopilotChatPanel.test-support'
import {
  // Constants
  DESC_CN_022,
  LABEL_2026_14T08,
  LABEL_2026_14T08_2,
  LABEL_2026_14T08_3,
  LABEL_HTTP_127,
  LABEL_OPENAI_GPT,
  LABEL_TEXTAREA_NAME_MESSAGETEXT,
  SELECTOR_CHAT_ASSISTANT_PLACEHOLDER,
  SELECTOR_CHAT_COMPOSER_DOCK,
  SELECTOR_CHAT_MESSAGE_SCROLL,
  SELECTOR_CHAT_MESSAGE_TOOL,
  SELECTOR_COPILOT_CHAT_PANEL,
  // Lifecycle helpers
  restoreNotificationApi,
  restoreAttachmentManagerApi,
  // Helper functions
  createResolvedSendMessageSpy,
  createDeferredSignal,
  createToolFirstPendingSendMessageSpy,
  createTextFirstPendingSendMessageSpy,
  createFailedBeforeAssistantSendMessageSpy,
  createPersistedWorkspaceStateLoader,
  createLiveReadyButEmptyPersistedHistoryState,
  waitForCondition,
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

/* eslint-disable-next-line max-lines-per-function -- organizational wrapper for session test groups */
describe('CopilotChatPanel composer interactions', () => {
  /* eslint-disable-next-line max-lines-per-function -- integration tests for transient state/session switching scenarios, each requiring full render setup */
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

  /* eslint-disable-next-line max-lines-per-function -- complex integration test covering debug handoff logging across topic switches with session state verification */
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
})
