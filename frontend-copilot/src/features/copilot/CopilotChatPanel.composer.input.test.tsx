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
})
