/** @vitest-environment jsdom */

import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

import { CopilotChatPanel } from './CopilotChatPanel'
import { RuntimeRequestError, sendRuntimeMessage, type RuntimeMessageSendResponse } from './chat-contract'
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
      />,
    )

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    const modelTrigger = rendered.getByTestId('chat-model-picker-trigger') as HTMLButtonElement

    expect(modelTrigger.textContent).toContain('Gemini 2.5 Pro Preview')
    expect(getTriggerIconText(modelTrigger)).toBe('G')

    await clickElement(modelTrigger)
    await clickElement(rendered.getByTestId('chat-model-option-anthropic/claude-opus-4.1'))

    expect(modelTrigger.textContent).toContain('Claude Opus 4.1')
    expect(getTriggerIconText(modelTrigger)).toBe('C')

    await setFormControlValue(messageInput, '请总结刚才的内容')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      model: 'anthropic/claude-opus-4.1',
      message: {
        content: '请总结刚才的内容',
      },
    })

    rendered.unmount()
  })

  it('submits on Enter and keeps newline behavior for Ctrl + Enter in the message composer', async () => {
    const sendMessage = createResolvedSendMessageSpy()

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
      />,
    )

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
      />,
    )

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
      />,
    )

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

  it('echoes user and assistant messages after a successful send', async () => {
    const sendMessage = createResolvedSendMessageSpy(async (input) => ({
      ok: true,
      sessionId: input.sessionId,
      boundAgent: {
        agentId: input.agent ?? 'general',
        status: 'ready',
        displayName: '通用智能体',
        description: '默认通用智能体',
        iconKey: null,
      },
      assistantMessage: {
        role: 'assistant',
        content: '这是助手回显',
      },
      resolvedModelId: input.model,
      resolvedToolIds: input.enabledTools,
      requestOptions: input.requestOptions ?? {},
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
      />,
    )

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请回显本条消息')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(rendered.container.textContent).toContain('请回显本条消息')
    expect(rendered.container.textContent).toContain('助手响应')
    expect(rendered.container.textContent).toContain('这是助手回显')

    rendered.unmount()
  })

  it('keeps failed sends as echoed user messages plus an error turn', async () => {
    const sendMessage = vi.fn<(input: Parameters<typeof sendRuntimeMessage>[0]) => Promise<RuntimeMessageSendResponse>>(async () => {
      throw new RuntimeRequestError('tool_not_found: unknown tool', {
        code: 'tool_not_found',
        status: 400,
      })
    })

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
      />,
    )

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await setFormControlValue(messageInput, '请使用不存在的工具')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(rendered.container.textContent).toContain('请使用不存在的工具')
    expect(rendered.container.textContent).toContain('发送失败')
    expect(rendered.container.textContent).toContain('tool_not_found：本次消息启用了后端未注册的 toolId')

    rendered.unmount()
  })
})

function createResolvedSendMessageSpy(
  implementation?: (input: Parameters<typeof sendRuntimeMessage>[0]) => Promise<RuntimeMessageSendResponse>,
) {
  return vi.fn<(input: Parameters<typeof sendRuntimeMessage>[0]) => Promise<RuntimeMessageSendResponse>>(
    implementation ?? (async (input) => ({
      ok: true,
      sessionId: input.sessionId,
      boundAgent: {
        agentId: input.agent ?? 'general',
        status: 'ready',
        displayName: '通用智能体',
        description: '默认通用智能体',
        iconKey: null,
      },
      assistantMessage: {
        role: 'assistant',
        content: '已收到',
      },
      resolvedModelId: input.model,
      resolvedToolIds: input.enabledTools,
      requestOptions: input.requestOptions ?? {},
    })),
  )
}
