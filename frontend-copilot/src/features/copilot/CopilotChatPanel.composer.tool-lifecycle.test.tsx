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
})
