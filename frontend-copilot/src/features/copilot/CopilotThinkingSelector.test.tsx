/** @vitest-environment jsdom */

import { act } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { CopilotChatPanel } from './CopilotChatPanel'
import type { RuntimeRunEvent } from './chat-contract'
import { createRuntimeThinkingCapability } from './chat-contract.test-support'
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
    const getThinkingCapability = createThinkingCapabilityGetterSpy()
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
        getThinkingCapability={getThinkingCapability}
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
    await flushUi()

    expect(rendered.queryByTestId('chat-thinking-panel')).toBeNull()
    expect(thinkingTrigger.title).toContain('当前模型不支持')

    rendered.unmount()
  })

  it('remembers the latest thinking selection per model and falls back when the next model does not support that level', async () => {
    const getThinkingCapability = createThinkingCapabilityGetterSpy()
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
        getThinkingCapability={getThinkingCapability}
      />,
    )

    await flushUi()

    const thinkingTrigger = rendered.getByTestId('chat-thinking-trigger') as HTMLButtonElement
    expect(thinkingTrigger.getAttribute('aria-label')).toContain('低')

    await selectThinkingOption(rendered, 'high')
    expect(thinkingTrigger.getAttribute('aria-label')).toContain('高')

    await clickElement(rendered.getByTestId('chat-model-picker-trigger'))
    await clickElement(rendered.getByTestId('chat-model-option-provider-thinking-provider-thinking:model-c'))
    await flushUi()
    expect(thinkingTrigger.getAttribute('aria-label')).toContain('低')

    await clickElement(rendered.getByTestId('chat-model-picker-trigger'))
    await clickElement(rendered.getByTestId('chat-model-option-provider-thinking-provider-thinking:model-a'))
    await flushUi()
    expect(thinkingTrigger.getAttribute('aria-label')).toContain('高')

    rendered.unmount()
  })

  it('forwards the selected thinking level through the request build chain', async () => {
    const getThinkingCapability = createThinkingCapabilityGetterSpy()
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
        getThinkingCapability={getThinkingCapability}
      />,
    )

    await flushUi()
    await flushUi()

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement

    await clickElement(rendered.getByTestId('chat-thinking-trigger'))
    expect(rendered.getByTestId('chat-thinking-override-hint').textContent).toContain('设置页 override')
    await clickElement(rendered.getByTestId('chat-thinking-option-medium'))
    await setFormControlValue(messageInput, '测试思考档位透传')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      thinkingLevelIntent: 'medium',
      thinkingCapabilityOverride: {
        supported: true,
        levels: ['low', 'medium', 'high'],
        defaultLevel: 'low',
      },
      message: {
        content: '测试思考档位透传',
      },
    })

    rendered.unmount()
  })

  it('shows a failed chat message when the backend rejects the selected thinking level for the current route', async () => {
    const getThinkingCapability = createThinkingCapabilityGetterSpy()
    const sendMessage = vi.fn(async function* (
      input: Parameters<typeof import('./chat-contract').sendRuntimeMessage>[0],
    ): AsyncGenerator<RuntimeRunEvent> {
      yield {
        type: 'run_started',
        runId: 'run-thinking-invalid',
        sessionId: input.sessionId,
        sequence: 1,
        payload: {
          assistantMessageId: 'run-thinking-invalid:assistant',
        },
      }
      yield {
        type: 'run_diagnostic',
        runId: 'run-thinking-invalid',
        sessionId: input.sessionId,
        sequence: 2,
        payload: {
          code: 'thinking_not_supported_for_route',
          message: "Selected thinking level 'medium' is not supported by the current model route. This request was cancelled instead of continuing without provider thinking parameters.",
          details: {
            intent: 'medium',
            reason: 'route_not_mapped',
          },
          stage: 'adapt_thinking',
        },
      }
      yield {
        type: 'run_failed',
        runId: 'run-thinking-invalid',
        sessionId: input.sessionId,
        sequence: 3,
        payload: {
          code: 'thinking_not_supported_for_route',
          message: "Selected thinking level 'medium' is not supported by the current model route. This request was cancelled instead of continuing without provider thinking parameters.",
          details: {
            intent: 'medium',
            reason: 'route_not_mapped',
          },
        },
      }
    })
    const loadWorkspaceState = vi.fn(async () => ({
      ok: true as const,
      source: 'stored' as const,
      state: createPersistedWorkspaceState({
        providerProfiles: [
          createProviderProfile({
            id: 'provider-thinking-fail',
            name: 'Thinking Fail Provider',
            defaultModel: 'model-thinking-fail',
            availableModels: [
              {
                id: 'provider-thinking-fail:model-thinking-fail',
                modelId: 'model-thinking-fail',
                displayName: 'Thinking Fail Model',
                groupName: 'Thinking',
                capabilities: ['reasoning', 'tools'],
                thinkingCapability: {
                  supported: true,
                  levels: ['medium'],
                  defaultLevel: 'medium',
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
          primaryAssistantModel: 'model-thinking-fail',
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
            defaultModelPreference: 'model-thinking-fail',
          },
        })}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sendMessage={sendMessage}
        loadWorkspaceState={loadWorkspaceState}
        getThinkingCapability={getThinkingCapability}
      />,
    )

    await flushUi()

    const messageInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
    await selectThinkingOption(rendered, 'medium')
    await setFormControlValue(messageInput, '测试不支持的思考档位失败')
    await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
    await flushUi()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(rendered.container.textContent).toContain('发送失败')
    expect(rendered.container.textContent).toContain('thinking_not_supported_for_route: Selected thinking level')
    expect(rendered.container.textContent).toContain('测试不支持的思考档位失败')
    expect(rendered.container.textContent).not.toContain('当前模型不支持')

    rendered.unmount()
  })
})

async function flushUi() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function createThinkingCapabilityGetterSpy() {
  return vi.fn(async (input: {
    sessionId: string
    modelRoute: {
      snapshot: {
        modelId: string
      }
    }
    thinkingCapabilityOverride?: Record<string, unknown> | null
  }) => ({
    ok: true as const,
    sessionId: input.sessionId,
    capability: resolveRuntimeThinkingCapability(input),
  }))
}

function resolveRuntimeThinkingCapability(input: {
  modelRoute: {
    snapshot: {
      modelId: string
    }
  }
  thinkingCapabilityOverride?: Record<string, unknown> | null
}) {
  const override = input.thinkingCapabilityOverride
  if (override?.supported === false) {
    return createRuntimeThinkingCapability({
      status: 'unknown-without-override',
      source: 'unknown',
      supported: false,
      supportedLevels: [],
      defaultLevel: null,
      reasonCode: 'override_declares_unsupported_for_unknown_route',
      providerHint: 'unknown-route',
      overrideLevels: [],
    })
  }

  const overrideLevels = Array.isArray(override?.levels)
    ? override.levels.filter((level): level is 'auto' | 'low' | 'medium' | 'high' | 'xhigh' => (
      level === 'auto' || level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh'
    ))
    : []

  if (override?.supported === true && overrideLevels.length > 0) {
    const supportedLevels = ['off', ...overrideLevels] as const
    const defaultLevel = typeof override.defaultLevel === 'string' && supportedLevels.includes(override.defaultLevel as typeof supportedLevels[number])
      ? override.defaultLevel as typeof supportedLevels[number]
      : (overrideLevels.includes('auto') ? 'auto' : supportedLevels[0])

    return createRuntimeThinkingCapability({
      status: 'unknown-with-override',
      source: 'override',
      supported: true,
      supportedLevels: [...supportedLevels],
      defaultLevel,
      reasonCode: 'override_candidate_levels_applied',
      providerHint: 'unknown-route-override',
      overrideLevels: [...supportedLevels],
    })
  }

  if (input.modelRoute.snapshot.modelId === 'glm-5' || input.modelRoute.snapshot.modelId === 'glm-5-turbo') {
    return createRuntimeThinkingCapability({
      status: 'verified-supported',
      source: 'verified',
      supported: true,
      supportedLevels: ['off', 'auto'],
      defaultLevel: 'auto',
      reasonCode: 'zai_glm_verified_supported',
      providerHint: 'zai-glm-openai-compatible',
      overrideLevels: [],
    })
  }

  return createRuntimeThinkingCapability({
    status: 'unknown-without-override',
    source: 'unknown',
    supported: false,
    supportedLevels: [],
    defaultLevel: null,
    reasonCode: 'route_not_verified',
    providerHint: 'unknown-route',
    overrideLevels: [],
  })
}

async function selectThinkingOption(
  rendered: ReturnType<typeof renderWithRoot>,
  value: 'off' | 'auto' | 'low' | 'medium' | 'high' | 'xhigh',
) {
  await act(async () => {
    await clickElement(rendered.getByTestId('chat-thinking-trigger'))
  })
  await act(async () => {
    await clickElement(rendered.getByTestId(`chat-thinking-option-${value}`))
  })
}
