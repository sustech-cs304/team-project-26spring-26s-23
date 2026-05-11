/** @vitest-environment jsdom */

import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CopilotChatPanel } from './CopilotChatPanel'
import type { RuntimeRunEvent } from './chat-contract'
import type { CopilotMessageDispatchInput } from './copilot-send-controller'
import {
  createRuntimeCanonicalThinkingSelection,
  createRuntimeRunCompletedEvent,
  createRuntimeRunStartResponse,
  createRuntimeThinkingCapability,
  createRuntimeThinkingControlSpec,
  createRuntimeThinkingSelection,
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
import { getThinkingBudgetProgressFromTokens } from '../../workbench/thinking-display'
import { createPersistedWorkspaceState, createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'
import type { ModelCapability, ProviderModelProfile } from '../../workbench/types'
import type {
  RuntimeThinkingCapability,
  RuntimeThinkingLevel,
} from './thread-run-contract'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const LABEL_COMPAT_DISCRETE_LEVELS = 'compat-discrete-levels-v1'
const LABEL_COMPAT_OFF_AUTO = 'compat-off-auto-v1'
const SELECTOR_CHAT_THINKING_BUDGET = 'chat-thinking-budget-input'
const SELECTOR_CHAT_THINKING_EDITOR = 'chat-thinking-editor-discrete'
const SELECTOR_CHAT_THINKING_EDITOR_2 = 'chat-thinking-editor-budget'
const SELECTOR_CHAT_THINKING_TRIGGER = 'chat-thinking-trigger'


declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

describe('Copilot thinking selector', () => {
  describe('backend canonical capability', () => {
    it('uses backend canonical capability instead of local model declaration as chat control truth', async () => {
      const backendBudgetCapability = createBudgetCapability()
      const getThinkingCapability = vi.fn(async (input: {
        sessionId: string
        thinkingCapabilityOverride?: Record<string, unknown> | null
      }) => ({
        ok: true as const,
        sessionId: input.sessionId,
        capability: backendBudgetCapability,
      }))
      const loadWorkspaceState = createLoadWorkspaceState([
        createProviderProfile({
          id: 'provider-truth',
          name: 'Truth Provider',
          availableModels: [
            {
              id: 'provider-truth:truth-model',
              modelId: 'truth-model',
              displayName: 'Truth Model',
              groupName: 'Truth',
              capabilities: ['reasoning', 'tools'] as ModelCapability[],
              thinkingCapability: {
                supported: true,
                series: LABEL_COMPAT_DISCRETE_LEVELS,
                input: {
                  kind: 'discrete',
                  levels: ['low', 'medium', 'high'],
                },
                defaultSelection: {
                  mode: 'preset',
                  level: 'low',
                },
              },
              supportsStreaming: true,
              currency: 'usd',
              inputPrice: '1',
              outputPrice: '2',
            },
          ],
        }),
      ], 'truth-model')

      const rendered = renderThinkingPanel({
        getThinkingCapability,
        loadWorkspaceState,
        sessionModelPreference: 'truth-model',
      })

      await flushUi()
      await flushUi()
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))

      expect(getThinkingCapability).toHaveBeenCalledWith(expect.objectContaining({
        thinkingCapabilityOverride: expect.objectContaining({
          supported: true,
          series: LABEL_COMPAT_DISCRETE_LEVELS,
          template: expect.objectContaining({
            editorType: 'discrete',
            defaultValue: {
              valueType: 'code',
              code: 'low',
              labelZh: '低',
            },
          }),
        }),
      }))
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_EDITOR_2)).not.toBeNull()
      expect(rendered.queryByTestId(SELECTOR_CHAT_THINKING_EDITOR)).toBeNull()

      rendered.unmount()
    })
  })

  describe('runtime capability verification', () => {
    it('relies on runtime capability results instead of frontend built-in rules for chat thinking availability', async () => {
      const getThinkingCapability = vi.fn(async (input: {
        runtimeUrl: string
        sessionId: string
        modelRoute: {
          routeRef?: {
            modelId: string
          } | null
        }
      }) => ({
        ok: true as const,
        sessionId: input.sessionId,
        capability: createRuntimeThinkingCapability({
          status: 'unknown-without-override',
          source: 'unknown',
          supported: false,
          supportedLevels: [],
          defaultLevel: null,
          reasonCode: 'route_not_verified',
          providerHint: 'runtime-truth-only',
          overrideLevels: [],
        }),
      }))
      const loadWorkspaceState = vi.fn(async () => ({
        ok: true as const,
        source: 'stored' as const,
        state: createPersistedWorkspaceState({
          providerProfiles: [
            createProviderProfile({
              id: 'provider-runtime-truth',
              name: 'Runtime Truth Provider',
              endpoint: 'https://api.z.ai/api/paas/v4',
              primaryModelId: 'glm-5-turbo',
              availableModels: [
                {
                  id: 'provider-runtime-truth:glm-5-turbo',
                  modelId: 'glm-5-turbo',
                  displayName: 'GLM 5 Turbo',
                  groupName: 'RuntimeTruth',
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
          sessionShell={createSessionShell()}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          loadWorkspaceState={loadWorkspaceState}
          getThinkingCapability={getThinkingCapability}
        />,
      )

      await flushUi()
      await flushUi()

      const thinkingTrigger = rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER) as HTMLButtonElement
      expect(getThinkingCapability).toHaveBeenCalledTimes(1)
      expect(thinkingTrigger.title).toBe('当前模型暂不支持思考设置')
      expect(thinkingTrigger.getAttribute('aria-label')).toBe('当前模型暂不支持思考设置')
      expect(rendered.queryByTestId('chat-thinking-panel')).toBeNull()

      await clickElement(thinkingTrigger)
      expect(rendered.queryByTestId('chat-thinking-panel')).toBeNull()

      rendered.unmount()
    })
  })

  describe('control type rendering', () => {
    it('renders fixed capability as a locked control instead of normal discrete buttons', async () => {
      const getThinkingCapability = createThinkingCapabilityGetter({
        'fixed-model': createPresetCapability({
          series: 'compat-fixed-reasoning-v1',
          kind: 'fixed',
          levels: ['auto'],
          defaultLevel: 'auto',
        }),
      })
      const loadWorkspaceState = createLoadWorkspaceState([
        createProviderProfile({
          id: 'provider-fixed',
          name: 'Fixed Provider',
          availableModels: [
            createReasoningModel({
              id: 'provider-fixed:fixed-model',
              modelId: 'fixed-model',
              displayName: 'Fixed Model',
            }),
          ],
        }),
      ], 'fixed-model')

      const rendered = renderThinkingPanel({
        getThinkingCapability,
        loadWorkspaceState,
        sessionModelPreference: 'fixed-model',
      })

      await flushUi()
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))

      expect(rendered.getByTestId('chat-thinking-editor-fixed')).not.toBeNull()
      expect(rendered.getByTestId('chat-thinking-fixed-lock').textContent).toContain('锁定')
      expect(rendered.queryByTestId(SELECTOR_CHAT_THINKING_EDITOR)).toBeNull()

      rendered.unmount()
    })

    it('renders binary, off-auto, discrete and budget controls from backend control spec', async () => {
      const getThinkingCapability = createThinkingCapabilityGetter({
        'binary-model': createPresetCapability({
          series: 'compat-binary-toggle-v1',
          kind: 'binary',
          levels: ['off', 'high'],
          defaultLevel: 'high',
        }),
        'off-auto-model': createPresetCapability({
          series: LABEL_COMPAT_OFF_AUTO,
          kind: 'off-auto',
          levels: ['off', 'auto'],
          defaultLevel: 'auto',
        }),
        'discrete-model': createPresetCapability({
          series: LABEL_COMPAT_DISCRETE_LEVELS,
          kind: 'discrete',
          levels: ['off', 'auto', 'medium', 'high'],
          defaultLevel: 'medium',
        }),
        'budget-model': createBudgetCapability(),
      })
      const providerId = 'provider-kinds'
      const loadWorkspaceState = createLoadWorkspaceState([
        createProviderProfile({
          id: providerId,
          name: 'Kinds Provider',
          availableModels: [
            createReasoningModel({
              id: `${providerId}:binary-model`,
              modelId: 'binary-model',
              displayName: 'Binary Model',
            }),
            createReasoningModel({
              id: `${providerId}:off-auto-model`,
              modelId: 'off-auto-model',
              displayName: 'Off Auto Model',
            }),
            createReasoningModel({
              id: `${providerId}:discrete-model`,
              modelId: 'discrete-model',
              displayName: 'Discrete Model',
            }),
            createReasoningModel({
              id: `${providerId}:budget-model`,
              modelId: 'budget-model',
              displayName: 'Budget Model',
            }),
          ],
        }),
      ], 'binary-model')

      const rendered = renderThinkingPanel({
        getThinkingCapability,
        loadWorkspaceState,
        sessionModelPreference: 'binary-model',
      })

      await flushUi()
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_EDITOR)).not.toBeNull()
      expect(rendered.getByTestId('chat-thinking-option-off').textContent).toContain('无')
      expect(rendered.getByTestId('chat-thinking-option-high').textContent).toContain('高')

      await selectModel(rendered, providerId, `${providerId}:off-auto-model`)
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_EDITOR)).not.toBeNull()
      expect(rendered.getByTestId('chat-thinking-option-auto').textContent).toContain('自动')

      await selectModel(rendered, providerId, `${providerId}:discrete-model`)
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_EDITOR)).not.toBeNull()
      expect(rendered.getByTestId('chat-thinking-option-medium').textContent).toContain('中')
      expect(rendered.getByTestId('chat-thinking-option-high').textContent).toContain('高')

      await selectModel(rendered, providerId, `${providerId}:budget-model`)
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_EDITOR_2)).not.toBeNull()
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_BUDGET)).not.toBeNull()

      rendered.unmount()
    })

    it('hides the budget button when the capability does not expose exact budget selection', async () => {
      const getThinkingCapability = createThinkingCapabilityGetter({
        'dynamic-only-model': createBudgetCapability({
          controlSpec: createRuntimeThinkingControlSpec({
            kind: 'budget',
            selectionKind: 'budget',
            presetOptions: [createRuntimeCanonicalThinkingSelection({ value: 'off' })],
            budget: null,
          }),
          allowedValues: [
            { valueType: 'budget', mode: 'off', budgetTokens: null, labelZh: '关闭' },
            { valueType: 'budget', mode: 'dynamic', budgetTokens: null, labelZh: '动态' },
          ],
          defaultValue: {
            valueType: 'budget',
            mode: 'dynamic',
            budgetTokens: null,
            labelZh: '动态',
          },
        }),
      })
      const providerId = 'provider-no-exact-budget'
      const loadWorkspaceState = createLoadWorkspaceState([
        createProviderProfile({
          id: providerId,
          name: 'No Exact Budget Provider',
          availableModels: [
            createReasoningModel({
              id: `${providerId}:dynamic-only-model`,
              modelId: 'dynamic-only-model',
              displayName: 'Dynamic Only Model',
            }),
          ],
        }),
      ], 'dynamic-only-model')

      const rendered = renderThinkingPanel({
        getThinkingCapability,
        loadWorkspaceState,
        sessionModelPreference: 'dynamic-only-model',
      })

      await flushUi()
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))

      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_EDITOR_2)).not.toBeNull()
      expect(rendered.queryByTestId('chat-thinking-budget-mode-budget')).toBeNull()
      expect(rendered.queryByTestId(SELECTOR_CHAT_THINKING_BUDGET)).toBeNull()

      rendered.unmount()
    })
  })

  describe('override and memory', () => {
    it('shows a lightweight override source badge for unknown plus override capability', async () => {
      const overrideCapability = createPresetCapability({
        status: 'unknown-with-override',
        source: 'override',
        series: LABEL_COMPAT_OFF_AUTO,
        kind: 'off-auto',
        levels: ['off', 'auto'],
        defaultLevel: 'auto',
        overrideLevels: ['off', 'auto'],
        provenance: {
          routeStatus: 'unknown',
          override: {
            present: true,
            applied: true,
            source: 'settings-model',
            format: 'series-input',
          },
        },
      })
      const getThinkingCapability = vi.fn(async (input: {
        sessionId: string
        thinkingCapabilityOverride?: Record<string, unknown> | null
      }) => ({
        ok: true as const,
        sessionId: input.sessionId,
        capability: overrideCapability,
      }))
      const loadWorkspaceState = createLoadWorkspaceState([
        createProviderProfile({
          id: 'provider-override',
          name: 'Override Provider',
          availableModels: [
            {
              ...createReasoningModel({
                id: 'provider-override:unknown-route-model',
                modelId: 'unknown-route-model',
                displayName: 'Unknown Route Model',
              }),
              thinkingCapability: {
                supported: true,
                series: LABEL_COMPAT_OFF_AUTO,
                input: {
                  kind: 'off-auto',
                },
                defaultSelection: {
                  mode: 'preset',
                  level: 'auto',
                },
              },
            },
          ],
        }),
      ], 'unknown-route-model')

      const rendered = renderThinkingPanel({
        getThinkingCapability,
        loadWorkspaceState,
        sessionModelPreference: 'unknown-route-model',
      })

      await flushUi()
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))

      expect(rendered.queryByTestId('chat-thinking-override-hint')).toBeNull()
      expect(getThinkingCapability).toHaveBeenCalledWith(expect.objectContaining({
        thinkingCapabilityOverride: expect.objectContaining({
          supported: true,
          series: LABEL_COMPAT_OFF_AUTO,
          template: expect.objectContaining({
            editorType: 'discrete',
            defaultValue: {
              valueType: 'code',
              code: 'minimal',
              labelZh: '极简',
            },
          }),
        }),
      }))

      rendered.unmount()
    })

    it('remembers structured selections per model and does not apply budget memory to a discrete model', async () => {
      const providerId = 'provider-memory'
      const getThinkingCapability = createThinkingCapabilityGetter({
        'budget-memory-model': createBudgetCapability({
          defaultSelection: createRuntimeCanonicalThinkingSelection({ kind: 'budget', budgetTokens: 4096 }),
        }),
        'discrete-memory-model': createPresetCapability({
          series: LABEL_COMPAT_DISCRETE_LEVELS,
          kind: 'discrete',
          levels: ['off', 'auto', 'medium'],
          defaultLevel: 'auto',
        }),
      })
      const loadWorkspaceState = createLoadWorkspaceState([
        createProviderProfile({
          id: providerId,
          name: 'Memory Provider',
          availableModels: [
            createReasoningModel({
              id: `${providerId}:budget-memory-model`,
              modelId: 'budget-memory-model',
              displayName: 'Budget Memory Model',
            }),
            createReasoningModel({
              id: `${providerId}:discrete-memory-model`,
              modelId: 'discrete-memory-model',
              displayName: 'Discrete Memory Model',
            }),
          ],
        }),
      ], 'budget-memory-model')

      const rendered = renderThinkingPanel({
        getThinkingCapability,
        loadWorkspaceState,
        sessionModelPreference: 'budget-memory-model',
      })

      await flushUi()
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))
      await setRangeValue(
        rendered.getByTestId(SELECTOR_CHAT_THINKING_BUDGET) as HTMLInputElement,
        getThinkingBudgetProgressFromTokens(32768),
      )
      expect(rendered.getByTestId('chat-thinking-budget-value').textContent).toContain('32K')

      await selectModel(rendered, providerId, `${providerId}:discrete-memory-model`)
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_EDITOR)).not.toBeNull()
      expect(rendered.getByTestId('chat-thinking-option-auto').className).toContain('thinking-pill--selected')

      await selectModel(rendered, providerId, `${providerId}:budget-memory-model`)
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))
      expect(rendered.getByTestId('chat-thinking-budget-value').textContent).toContain('32K')

      rendered.unmount()
    })
  })

  describe('send and run metadata', () => {
    it('sends structured budget selection without reviving compat thinkingLevelIntent payloads', async () => {
      const sendMessage = vi.fn(async function* (
        input: CopilotMessageDispatchInput,
      ): AsyncGenerator<RuntimeRunEvent> {
        void input
        yield* []
      })
      const getThinkingCapability = createThinkingCapabilityGetter({
        'budget-send-model': createBudgetCapability(),
      })
      const loadWorkspaceState = createLoadWorkspaceState([
        createProviderProfile({
          id: 'provider-send',
          name: 'Send Provider',
          availableModels: [
            createReasoningModel({
              id: 'provider-send:budget-send-model',
              modelId: 'budget-send-model',
              displayName: 'Budget Send Model',
            }),
          ],
        }),
      ], 'budget-send-model')

      const rendered = renderThinkingPanel({
        getThinkingCapability,
        loadWorkspaceState,
        sendMessage,
        sessionModelPreference: 'budget-send-model',
      })

      await flushUi()
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))
      await setRangeValue(
        rendered.getByTestId(SELECTOR_CHAT_THINKING_BUDGET) as HTMLInputElement,
        getThinkingBudgetProgressFromTokens(32768),
      )
      await setFormControlValue(rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement, '发送预算型推理')
      await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)

      expect(sendMessage).toHaveBeenCalledTimes(1)
      expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
        thinkingSelection: {
          series: 'compat-budget-tokens-v1',
          mode: 'budget',
          level: null,
          budgetTokens: 32768,
        },
        message: {
          content: '发送预算型推理',
        },
      })
      expect(sendMessage.mock.calls[0]?.[0]).not.toHaveProperty('thinkingLevelIntent')

      rendered.unmount()
    })

    it('prefers the active run metadata snapshot as the current capability truth for the selected route', async () => {
      const queriedCapability = createPresetCapability({
        series: LABEL_COMPAT_DISCRETE_LEVELS,
        kind: 'discrete',
        levels: ['off', 'auto', 'medium'],
        defaultLevel: 'auto',
      })
      const runSnapshotCapability = createBudgetCapability({
        defaultSelection: createRuntimeCanonicalThinkingSelection({ kind: 'budget', budgetTokens: 8192 }),
      })
      const runSnapshotSelection = createRuntimeThinkingSelection({
        series: 'compat-budget-tokens-v1',
        mode: 'budget',
        level: null,
        budgetTokens: 8192,
      })
      const getThinkingCapability = createThinkingCapabilityGetter({
        'run-metadata-model': queriedCapability,
      })
      const sendMessage = vi.fn(async function* (
        input: CopilotMessageDispatchInput,
      ): AsyncGenerator<RuntimeRunEvent> {
        input.onRunStart?.(createRuntimeRunStartResponse({
          run: {
            threadId: input.sessionId,
            thinkingCapabilitySnapshot: runSnapshotCapability,
            requestedThinkingSelection: runSnapshotSelection,
            appliedThinkingSelection: runSnapshotSelection,
            requestedThinkingLevel: null,
            appliedThinkingLevel: null,
          },
        }))

        yield {
          type: 'run_started',
          runId: 'run-metadata-1',
          sessionId: input.sessionId,
          sequence: 1,
          payload: {
            assistantMessageId: 'run-metadata-1:assistant',
          },
        }
        yield createRuntimeRunCompletedEvent({
          runId: 'run-metadata-1',
          sessionId: input.sessionId,
        })
      })
      const loadWorkspaceState = createLoadWorkspaceState([
        createProviderProfile({
          id: 'provider-run-metadata',
          name: 'Run Metadata Provider',
          availableModels: [
            createReasoningModel({
              id: 'provider-run-metadata:run-metadata-model',
              modelId: 'run-metadata-model',
              displayName: 'Run Metadata Model',
            }),
          ],
        }),
      ], 'run-metadata-model')

      const rendered = renderThinkingPanel({
        getThinkingCapability,
        loadWorkspaceState,
        sendMessage,
        sessionModelPreference: 'run-metadata-model',
      })

      await flushUi()
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_EDITOR)).not.toBeNull()
      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))

      await setFormControlValue(rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement, 'run metadata capability')
      await submitForm(rendered.getByTestId('chat-composer-dock') as HTMLFormElement)
      await flushUi()
      await flushUi()

      await clickElement(rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER))
      expect(rendered.getByTestId(SELECTOR_CHAT_THINKING_EDITOR_2)).not.toBeNull()
      expect(rendered.getByTestId('chat-thinking-budget-value').textContent).toContain('8K')

      rendered.unmount()
    })
  })

  describe('provider error handling', () => {
    it('surfaces provider runtime status from thinking capability query errors in the trigger tooltip', async () => {
      const getThinkingCapability = vi.fn(async () => {
        throw new (await import('./chat-contract')).RuntimeRequestError('adapter_missing: provider adapter not registered', {
          code: 'adapter_missing',
          status: 409,
          details: {
            providerId: 'openai',
            adapterId: 'openai',
          },
        })
      })
      const loadWorkspaceState = vi.fn(async () => ({
        ok: true as const,
        source: 'stored' as const,
        state: createPersistedWorkspaceState({
          providerProfiles: [
            createProviderProfile({
              id: 'provider-openai',
              providerId: 'openai',
              protocol: 'openai',
              name: 'OpenAI',
              primaryModelId: 'gpt-4.1',
              availableModels: [
                {
                  id: 'provider-openai:gpt-4.1',
                  modelId: 'gpt-4.1',
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
            primaryAssistantModel: 'gpt-4.1',
          },
        }),
      }))

      const rendered = renderWithRoot(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => undefined}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell()}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          loadWorkspaceState={loadWorkspaceState}
          getThinkingCapability={getThinkingCapability}
        />,
      )

      await flushUi()

      const thinkingTrigger = rendered.getByTestId(SELECTOR_CHAT_THINKING_TRIGGER) as HTMLButtonElement
      expect(thinkingTrigger.title).toContain('当前无法调整思考设置')
      expect(thinkingTrigger.disabled).toBe(false)

      rendered.unmount()
    })
  })
})

function renderThinkingPanel(input: {
  getThinkingCapability: Parameters<typeof CopilotChatPanel>[0]['getThinkingCapability']
  loadWorkspaceState: Parameters<typeof CopilotChatPanel>[0]['loadWorkspaceState']
  sendMessage?: Parameters<typeof CopilotChatPanel>[0]['sendMessage']
  sessionModelPreference: string
}) {
  return renderWithRoot(
    <CopilotChatPanel
      state={createReadyState()}
      retrying={false}
      retry={() => undefined}
      selectedAgent={createSelectedAgent()}
      sessionShell={createSessionShell()}
      directoryState={createDirectoryState()}
      sessionStatus="idle"
      sessionError={null}
      loadWorkspaceState={input.loadWorkspaceState}
      getThinkingCapability={input.getThinkingCapability}
      sendMessage={input.sendMessage}
    />,
  )
}

function createLoadWorkspaceState(providerProfiles: ReturnType<typeof createPersistedWorkspaceState>['providerProfiles'], primaryAssistantModel: string) {
  return vi.fn(async () => ({
    ok: true as const,
    source: 'stored' as const,
    state: createPersistedWorkspaceState({
      providerProfiles,
      defaultModelRouting: {
        primaryAssistantModel,
      },
    }),
  }))
}

function createReasoningModel(input: {
  id: string
  modelId: string
  displayName: string
}): ProviderModelProfile {
  return {
    id: input.id,
    modelId: input.modelId,
    displayName: input.displayName,
    groupName: 'Thinking',
    capabilities: ['reasoning', 'tools'] as ModelCapability[],
    supportsStreaming: true,
    currency: 'usd',
    inputPrice: '1',
    outputPrice: '2',
  }
}

function createThinkingCapabilityGetter(capabilitiesByModelId: Record<string, RuntimeThinkingCapability>) {
  return vi.fn(async (input: {
    sessionId: string
    modelRoute: {
      routeRef?: {
        modelId: string
      } | null
    }
  }) => ({
    ok: true as const,
    sessionId: input.sessionId,
    capability: capabilitiesByModelId[input.modelRoute.routeRef?.modelId ?? ''],
  }))
}

function createPresetCapability(input: {
  status?: RuntimeThinkingCapability['status']
  source?: RuntimeThinkingCapability['source']
  series: string
  kind: 'fixed' | 'binary' | 'off-auto' | 'discrete'
  levels: RuntimeThinkingLevel[]
  defaultLevel: RuntimeThinkingLevel
  overrideLevels?: RuntimeThinkingCapability['overrideLevels']
  provenance?: RuntimeThinkingCapability['provenance']
}) {
  return createRuntimeThinkingCapability({
    status: input.status ?? 'verified-supported',
    source: input.source ?? 'verified',
    supported: true,
    series: input.series,
    controlSpec: createRuntimeThinkingControlSpec({
      kind: input.kind,
      selectionKind: 'preset',
      presetOptions: input.levels.map((level) => createRuntimeCanonicalThinkingSelection({ value: level })),
      ...(input.kind === 'fixed'
        ? {
            fixedSelection: createRuntimeCanonicalThinkingSelection({ value: input.levels[0] ?? input.defaultLevel }),
          }
        : {}),
    }),
    defaultSelection: createRuntimeCanonicalThinkingSelection({ value: input.defaultLevel }),
    supportedLevels: [...input.levels],
    defaultLevel: input.defaultLevel,
    overrideLevels: input.overrideLevels ?? [],
    ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
  })
}

function createBudgetCapability(overrides: Partial<RuntimeThinkingCapability> = {}) {
  return createRuntimeThinkingCapability({
    status: overrides.status ?? 'verified-supported',
    source: overrides.source ?? 'verified',
    supported: true,
    series: overrides.series ?? 'compat-budget-tokens-v1',
    controlSpec: overrides.controlSpec ?? createRuntimeThinkingControlSpec({
      kind: 'budget',
      selectionKind: 'budget',
      presetOptions: [createRuntimeCanonicalThinkingSelection({ value: 'off' })],
      budget: {
        minTokens: 0,
        maxTokens: 32768,
        stepTokens: 1024,
      },
    }),
    defaultSelection: overrides.defaultSelection ?? createRuntimeCanonicalThinkingSelection({
      kind: 'budget',
      budgetTokens: 4096,
    }),
    supportedLevels: overrides.supportedLevels ?? ['off'],
    defaultLevel: overrides.defaultLevel ?? null,
    overrideLevels: overrides.overrideLevels ?? [],
    ...(overrides.provenance === undefined ? {} : { provenance: overrides.provenance }),
  })
}

async function flushUi() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function selectModel(
  rendered: ReturnType<typeof renderWithRoot>,
  providerId: string,
  optionId: string,
) {
  await clickElement(rendered.getByTestId('chat-model-picker-trigger'))
  await clickElement(rendered.getByTestId(`chat-model-option-${providerId}-${optionId}`))
  await flushUi()
}

async function setRangeValue(input: HTMLInputElement, value: number) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

  if (valueSetter === undefined) {
    throw new Error('Unable to resolve native value setter for range input')
  }

  await act(async () => {
    const previousValue = input.value
    valueSetter.call(input, String(value))
    const tracker = (input as HTMLInputElement & { _valueTracker?: { setValue: (nextValue: string) => void } })._valueTracker
    tracker?.setValue(previousValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
