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

/* eslint-disable-next-line max-lines-per-function -- organizational wrapper for tool picker test groups */
describe('CopilotChatPanel composer interactions', () => {
  /* eslint-disable-next-line max-lines-per-function -- three integration tests for tool picker interactions, each requiring independent render setup */
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
})
