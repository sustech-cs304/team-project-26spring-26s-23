/** @vitest-environment jsdom */

import { act } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { CopilotChatPanel } from './CopilotChatPanel'
import type { RuntimeRunEvent } from './chat-contract'
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
import { createPersistedWorkspaceState, createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'

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

describe('Copilot thinking selector', () => {
  it('shows supported thinking options in the floating panel and exposes a short unsupported tooltip', async () => {
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: 'provider-zai',
            name: 'ZAI',
            endpoint: 'https://api.z.ai/api/paas/v4',
            defaultModel: 'glm-5-turbo',
            availableModels: [
              {
                id: 'provider-zai:glm-5-turbo',
                modelId: 'glm-5-turbo',
                displayName: 'GLM 5 Turbo',
                groupName: 'ZAI',
                capabilities: ['reasoning', 'tools'],
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
              {
                id: 'provider-zai:openai/gpt-4.1',
                modelId: 'openai/gpt-4.1',
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
          primaryAssistantModel: 'glm-5-turbo',
        },
      }),
    }))

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => undefined}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell({
          capabilities: {
            defaultModelPreference: 'glm-5-turbo',
          },
        })}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await flushUi()

    const thinkingTrigger = rendered.getByTestId('chat-thinking-trigger') as HTMLButtonElement
    expect(thinkingTrigger.disabled).toBe(false)
    expect(thinkingTrigger.title).toBe('思考档位')

    await clickElement(thinkingTrigger)
    const thinkingPanel = rendered.getByTestId('chat-thinking-panel')
    expect(thinkingPanel.textContent).toContain('推理强度')
    expect(thinkingPanel.textContent).toContain('无')
    expect(thinkingPanel.textContent).toContain('自动')
    expect(rendered.container.textContent).not.toContain('当前模型不支持')

    await clickElement(rendered.getByTestId('chat-model-picker-trigger'))
    await clickElement(rendered.getByTestId('chat-model-option-provider-zai-provider-zai:openai/gpt-4.1'))

    expect(rendered.queryByTestId('chat-thinking-panel')).toBeNull()
    expect(thinkingTrigger.title).toContain('当前模型不支持')

    rendered.unmount()
  })

  it('remembers the latest thinking selection per model and falls back when the next model does not support that level', async () => {
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: 'provider-thinking',
            name: 'Thinking Provider',
            defaultModel: 'model-a',
            availableModels: [
              {
                id: 'provider-thinking:model-a',
                modelId: 'model-a',
                displayName: 'Model A',
                groupName: 'Thinking',
                capabilities: ['reasoning', 'tools'],
                thinkingCapability: {
                  supported: true,
                  levels: ['low', 'medium', 'high'],
                  defaultLevel: 'low',
                },
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
              {
                id: 'provider-thinking:model-b',
                modelId: 'model-b',
                displayName: 'Model B',
                groupName: 'Thinking',
                capabilities: ['reasoning', 'tools'],
                thinkingCapability: {
                  supported: true,
                  levels: ['auto'],
                  defaultLevel: 'auto',
                },
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
              {
                id: 'provider-thinking:model-c',
                modelId: 'model-c',
                displayName: 'Model C',
                groupName: 'Thinking',
                capabilities: ['reasoning', 'tools'],
                thinkingCapability: {
                  supported: true,
                  levels: ['low'],
                  defaultLevel: 'low',
                },
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
            ],
          }),
        ],
        defaultModelRouting: {
          primaryAssistantModel: 'model-a',
        },
      }),
    }))

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => undefined}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell({
          capabilities: {
            defaultModelPreference: 'model-a',
          },
        })}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await flushUi()

    const thinkingTrigger = rendered.getByTestId('chat-thinking-trigger') as HTMLButtonElement
    expect(thinkingTrigger.getAttribute('aria-label')).toContain('低')

    await selectThinkingOption(rendered, 'high')
    expect(thinkingTrigger.getAttribute('aria-label')).toContain('高')

    await clickElement(rendered.getByTestId('chat-model-picker-trigger'))
    await clickElement(rendered.getByTestId('chat-model-option-provider-thinking-provider-thinking:model-c'))
    expect(thinkingTrigger.getAttribute('aria-label')).toContain('低')

    await clickElement(rendered.getByTestId('chat-model-picker-trigger'))
    await clickElement(rendered.getByTestId('chat-model-option-provider-thinking-provider-thinking:model-a'))
    expect(thinkingTrigger.getAttribute('aria-label')).toContain('高')

    rendered.unmount()
  })

  it('forwards the selected thinking level through the request build chain', async () => {
    const sendMessage = vi.fn(async function* (
      _input: Parameters<typeof import('./chat-contract').sendRuntimeMessage>[0],
    ): AsyncGenerator<RuntimeRunEvent> {
      return
    })
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: 'provider-request',
            name: 'Request Provider',
            defaultModel: 'model-request',
            availableModels: [
              {
                id: 'provider-request:model-request',
                modelId: 'model-request',
                displayName: 'Request Model',
                groupName: 'Request',
                capabilities: ['reasoning', 'tools'],
                thinkingCapability: {
                  supported: true,
                  levels: ['low', 'medium', 'high'],
                  defaultLevel: 'low',
                },
                supportsStreaming: true,
                currency: 'usd',
                inputPrice: '1',
                outputPrice: '2',
              },
            ],
          }),
        ],
        defaultModelRouting: {
          primaryAssistantModel: 'model-request',
        },
      }),
    }))

    const rendered = renderWithRoot(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => undefined}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell({
          capabilities: {
            defaultModelPreference: 'model-request',
          },
        })}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
      />,
    )

    await flushUi()

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement

    await selectThinkingOption(rendered, 'medium')
    await setFormControlValue(messageInput, '测试思考档位透传')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      thinkingLevelIntent: 'medium',
      message: {
        content: '测试思考档位透传',
      },
    })

    rendered.unmount()
  })
})

async function flushUi() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function selectThinkingOption(
  rendered: ReturnType<typeof renderWithRoot>,
  value: 'off' | 'auto' | 'low' | 'medium' | 'high' | 'max',
) {
  await act(async () => {
    await clickElement(rendered.getByTestId('chat-thinking-trigger'))
  })
  await act(async () => {
    await clickElement(rendered.getByTestId(`chat-thinking-option-${value}`))
  })
}
