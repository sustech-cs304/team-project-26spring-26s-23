/** @vitest-environment jsdom */

import { act } from 'react'
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

import { CopilotChatPanel } from './CopilotChatPanel'
import {
  createRuntimeModelRoute,
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
import { createPersistedWorkspaceState, createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'
import {
  // Constants
  LABEL_OPENAI_COMPATIBLE,
  LABEL_OPENAI_GPT,
  LABEL_PROVIDER_MODEL,
  LABEL_PROVIDER_OPENAI,
  LABEL_PROVIDER_OPENAI_OPENAI,
  LABEL_TEXTAREA_NAME_MESSAGETEXT,
  LABEL_TOOL_READ,
  LABEL_TOOL_REMOTE_SEARCH,
  SELECTOR_ARIA_PRESSED,
  SELECTOR_CHAT_COMPOSER_DOCK,
  SELECTOR_CHAT_TOOL_OPTION,
  // Lifecycle helpers
  restoreNotificationApi,
  restoreAttachmentManagerApi,
  // Helper functions
  createResolvedSendMessageSpy,
  createPersistedWorkspaceStateLoader,
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
