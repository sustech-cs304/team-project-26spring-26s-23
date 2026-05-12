/** @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { act } from 'react'
import { afterEach, beforeAll, afterAll, describe, expect, it, } from 'vitest'

import { CopilotChatPanel } from './CopilotChatPanel'
import {
  createDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
  dragComposerResizeHandle,
  pressTextareaKey,
  renderWithRoot,
  setFormControlValue,
  submitForm,
} from './CopilotChatPanel.test-support'
import {
  // Constants
  LABEL_TEXTAREA_NAME_MESSAGETEXT,
  LABEL_TOOL_READ,
  SELECTOR_CHAT_COMPOSER_DOCK,
  SELECTOR_CHAT_COMPOSER_SEND,
  SELECTOR_CHAT_MESSAGE_SCROLL,
  // Lifecycle helpers
  restoreNotificationApi,
  restoreAttachmentManagerApi,
  // Helper functions
  createResolvedSendMessageSpy,
  createDeferredSignal,
  createFailedBeforeAssistantSendMessageSpy,
  createPersistedWorkspaceStateLoader,
  createFileWithPath,
  createPasteEvent,
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

/* eslint-disable-next-line max-lines-per-function -- organizational wrapper for composer input test groups */
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
