/** @vitest-environment jsdom */

import { act } from 'react'
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

import { CopilotChatPanel } from './CopilotChatPanel'
import {
  RuntimeRequestError,
} from './chat-contract'
import type { CopilotMessageDispatchInput } from './copilot-send-controller'
import {
  createRuntimeMessageEventStream,
  createRuntimeModelRoute,
  createRuntimeResolvedModelRoute,
  createRuntimeToolEvent,
} from './chat-contract.test-support'
import {
  clickElement,
  createDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
  renderWithRoot,
  setFormControlValue,
  submitForm,
} from './CopilotChatPanel.test-support'
import {
  createCopilotThreadRuntimeControllerState,
  type CopilotThreadRuntimeControllerState,
} from './thread-runtime-controller'
import {
  // Constants
  LABEL_2026_14T08,
  LABEL_2026_14T08_2,
  LABEL_2026_14T08_3,
  LABEL_COURSE_FORM,
  LABEL_ERROR_DETAIL_OVERLAY,
  LABEL_OPENAI_GPT,
  LABEL_PROVIDER_MODEL,
  LABEL_RUN_INLINE_FORM,
  LABEL_RUN_INTERRUPTED_UNTIL,
  LABEL_TEXTAREA_NAME_MESSAGETEXT,
  LABEL_TOOL_REQUEST_USER,
  LABEL_TOOL_REQUEST_USER_2,
  SELECTOR_CHAT_COMPOSER_DOCK,
  SELECTOR_CHAT_COMPOSER_SEND,
  SELECTOR_CHAT_MESSAGE_INLINE,
  // Lifecycle helpers
  restoreNotificationApi,
  restoreAttachmentManagerApi,
  // Helper functions
  createPersistedWorkspaceStateLoader,
  createLiveReadyButEmptyPersistedHistoryState,
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

/* eslint-disable-next-line max-lines-per-function -- organizational wrapper for send error test groups */
describe('CopilotChatPanel composer interactions', () => {
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
  /* eslint-disable-next-line max-lines-per-function -- integration tests for inline form validation and submission, each requiring full setup */
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

  /* eslint-disable-next-line max-lines-per-function -- complex integration test with two-stage send: form request yields inline form, form submission sends structured payload */
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
  /* eslint-disable-next-line max-lines-per-function -- integration tests for inline form state lifecycle management */
  describe('inline form state management', () => {
  /* eslint-disable-next-line max-lines-per-function -- complex integration test covering pending form state, composer enablement, and form expiration */
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

  /* eslint-disable-next-line max-lines-per-function -- complex integration test spanning session switches with inline form state retention and composer re-enablement */
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
})
