import { describe, expect, it } from 'vitest'

import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import { createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'
import { createSessionShell } from './CopilotChatPanel.test-support'
import { createCopilotModelCatalog } from './model-picker'
import { evaluatePersistedHistoryDrift } from './persisted-history-drift'

describe('persisted history drift evaluation', () => {
  it('returns null when history or session shell is unavailable', () => {
    const providerProfiles = [createProviderProfile()]
    const models = createCopilotModelCatalog(providerProfiles).models
    const sessionShell = createSessionShell()
    const history = createHistoryState()

    expect(evaluatePersistedHistoryDrift({
      history: null,
      sessionShell,
      providerProfiles,
      models,
    })).toBeNull()
    expect(evaluatePersistedHistoryDrift({
      history,
      sessionShell: null,
      providerProfiles,
      models,
    })).toBeNull()
  })

  it('surfaces removed providers and missing tools from replay snapshots', () => {
    const providerProfiles = [createProviderProfile()]
    const models = createCopilotModelCatalog(providerProfiles).models
    const sessionShell = createSessionShell({
      capabilities: {
        allAvailableTools: [],
      },
    })
    const history = createHistoryState({
      availabilityDrift: {
        status: 'provider_removed',
      },
      historicalSnapshot: {
        resolvedModelId: 'legacy-model',
        resolvedModelRoute: {
          routeRef: {
            routeKind: 'provider-model',
            profileId: 'provider-legacy',
            modelId: 'legacy-model',
          },
        },
        resolvedToolIds: ['tool.file-convert'],
        appliedThinkingSelection: {
          series: 'unified-4-level-v1',
          mode: 'preset',
          level: 'medium',
          value: {
            valueType: 'code',
            code: 'medium',
            labelZh: '中',
          },
        },
      },
    })

    const drift = evaluatePersistedHistoryDrift({
      history,
      sessionShell,
      providerProfiles,
      models,
    })

    expect(drift).not.toBeNull()
    expect(drift?.historicalModelId).toBe('legacy-model')
    expect(drift?.historicalToolIds).toEqual(['tool.file-convert'])
    expect(drift?.historicalThinkingSummary).toContain('中')
    expect(drift?.warnings.map((warning) => warning.code)).toEqual([
      'historical_provider_removed',
      'historical_tool_unregistered',
    ])
    expect(drift?.requiresExplicitRebind).toBe(true)
  })

  it('surfaces unsupported historical thinking on still-available models', () => {
    const providerProfiles = [createProviderProfile({
      id: 'provider-openai',
      name: 'OpenAI Compatible',
      availableModels: [
        {
          id: 'provider-openai:legacy-model',
          modelId: 'legacy-model',
          displayName: 'Legacy Model',
          groupName: 'OpenAI',
          capabilities: ['reasoning', 'tools'],
          thinkingCapability: {
            supported: false,
            source: 'test-fixture',
          },
          supportsStreaming: true,
          currency: 'usd',
          inputPrice: '1',
          outputPrice: '2',
        },
      ],
    })]
    const models = createCopilotModelCatalog(providerProfiles).models
    const sessionShell = createSessionShell()
    const history = createHistoryState({
      historicalSnapshot: {
        resolvedModelId: 'legacy-model',
        resolvedModelRoute: {
          routeRef: {
            routeKind: 'provider-model',
            profileId: 'provider-openai',
            modelId: 'legacy-model',
          },
        },
        resolvedToolIds: [],
        appliedThinkingSelection: {
          series: 'unified-4-level-v1',
          mode: 'preset',
          level: 'medium',
          value: {
            valueType: 'code',
            code: 'medium',
            labelZh: '中',
          },
        },
      },
    })

    const drift = evaluatePersistedHistoryDrift({
      history,
      sessionShell,
      providerProfiles,
      models,
    })

    expect(drift).not.toBeNull()
    expect(drift?.warnings.map((warning) => warning.code)).toEqual([
      'historical_thinking_no_longer_supported',
    ])
    expect(drift?.warnings[0]?.message).toContain('思考能力当前已不再受支持')
    expect(drift?.requiresExplicitRebind).toBe(true)
  })

  it('falls back to latest configuration snapshots when replay data is unavailable', () => {
    const providerProfiles = [createProviderProfile({
      id: 'provider-openai',
      name: 'OpenAI Compatible',
      availableModels: [
        {
          id: 'provider-openai:current-model',
          modelId: 'current-model',
          displayName: 'Current Model',
          groupName: 'OpenAI',
          capabilities: ['tools'],
          supportsStreaming: true,
          currency: 'usd',
          inputPrice: '1',
          outputPrice: '2',
        },
      ],
    })]
    const models = createCopilotModelCatalog(providerProfiles).models
    const sessionShell = createSessionShell()
    const history = createHistoryState({
      replayStatus: 'idle',
      historicalSnapshot: null,
      latestConfigurationSnapshot: {
        modelSnapshot: {
          resolvedModelId: 'legacy-model',
          resolvedModelRoute: {
            routeRef: {
              routeKind: 'provider-model',
              profileId: 'provider-openai',
              modelId: 'legacy-model',
            },
          },
        },
        toolsSnapshot: {
          resolvedToolIds: ['tool.file-convert'],
        },
      },
    })

    const drift = evaluatePersistedHistoryDrift({
      history,
      sessionShell,
      providerProfiles,
      models,
    })

    expect(drift).not.toBeNull()
    expect(drift?.historicalModelId).toBe('legacy-model')
    expect(drift?.historicalToolIds).toEqual(['tool.file-convert'])
    expect(drift?.historicalThinkingSummary).toBeNull()
    expect(drift?.warnings.map((warning) => warning.code)).toEqual([
      'historical_valid_currently_missing',
    ])
    expect(drift?.requiresExplicitRebind).toBe(true)
  })
})

function createHistoryState(input: {
  historicalSnapshot?: Record<string, unknown> | null
  latestConfigurationSnapshot?: Record<string, unknown> | null
  availabilityDrift?: Record<string, unknown> | null
  replayStatus?: AssistantSessionHistoryState['replayStatus']
} = {}): AssistantSessionHistoryState {
  const runSummary = {
    runId: 'run-history-1',
    threadId: 'session-1',
    status: 'completed',
    createdAt: '2026-04-13T15:00:00Z',
    updatedAt: '2026-04-13T15:05:00Z',
    startedAt: '2026-04-13T15:00:01Z',
    terminalAt: '2026-04-13T15:05:00Z',
    resolvedModelId: 'legacy-model',
    requestedMessageText: '你好',
    assistantText: '历史摘要',
  }
  const replayStatus = input.replayStatus ?? 'ready'

  return {
    summary: {
      threadId: 'session-1',
      boundAgentId: 'general',
      title: '历史线程',
      titleSource: 'deterministic',
      summary: '历史摘要',
      summarySource: 'deterministic',
      createdAt: '2026-04-13T15:00:00Z',
      updatedAt: '2026-04-13T15:05:00Z',
      lastActivityAt: '2026-04-13T15:05:00Z',
      lastRunId: 'run-history-1',
      lastRunStatus: 'completed',
      lastUserMessagePreview: '你好',
      lastAssistantMessagePreview: '历史摘要',
      driftSummary: input.availabilityDrift ?? null,
    },
    detailStatus: 'ready',
    detailError: null,
    timelineItems: [],
    runSummaries: [runSummary],
    latestConfigurationSnapshot: input.latestConfigurationSnapshot ?? null,
    availabilityDrift: input.availabilityDrift ?? null,
    selectedRunId: 'run-history-1',
    replayStatus,
    replayError: null,
    replay: replayStatus === 'ready'
      ? {
          ok: true,
          version: 'chat-history-v1',
          run: { ...runSummary },
          historicalSnapshot: input.historicalSnapshot ?? {
            resolvedModelId: 'legacy-model',
            resolvedModelRoute: {
              routeRef: {
                routeKind: 'provider-model',
                profileId: 'provider-openai',
                modelId: 'legacy-model',
              },
            },
            resolvedToolIds: [],
          },
          orderedEvents: [],
          toolCallBlocks: [],
          diagnosticBlocks: [],
          terminalState: null,
          availabilityInterpretation: null,
        }
      : null,
  }
}
