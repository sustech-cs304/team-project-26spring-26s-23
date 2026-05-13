import { describe, expect, it } from 'vitest'

import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import { evaluatePersistedHistoryDrift, resolvePersistedHistoryDrift } from './persisted-history-drift'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const LABEL_2026_13T15 = '2026-04-13T15:05:00Z'
const LABEL_SUMMARY_MODEL = 'summary-model'


/* eslint-disable-next-line max-lines-per-function -- drift 评估覆盖多层优先级回退逻辑，拆分降低语义完整性 */
describe('persisted history drift evaluation', () => {
  describe('null and legacy results', () => {
    it('returns null when history or backend drift conclusions are unavailable', () => {
    expect(evaluatePersistedHistoryDrift(null)).toBeNull()
    expect(resolvePersistedHistoryDrift(createHistoryState())).toBeNull()
  })

  it('ignores legacy status-only drift records without backend structured conclusions', () => {
    expect(resolvePersistedHistoryDrift(createHistoryState({
      summaryDrift: {
        status: 'historical_provider_removed',
      },
      availabilityDrift: {
        status: 'historical_provider_removed',
      },
      availabilityInterpretation: {
        status: 'historical_provider_removed',
      },
    }))).toBeNull()
    })
  })

  describe('drift resolution priority', () => {
    it('prefers replay availability interpretation over detail and summary drift payloads', () => {
    const summaryDrift = createDriftRecord({
      status: 'historical_tool_unregistered',
      historicalModelId: LABEL_SUMMARY_MODEL,
      historicalToolIds: ['tool.summary'],
      warnings: [{
        code: 'historical_tool_unregistered',
        message: 'summary warning',
      }],
    })
    const detailDrift = createDriftRecord({
      status: 'historical_provider_removed',
      historicalModelId: 'detail-model',
      historicalToolIds: ['tool.detail'],
      warnings: [{
        code: 'historical_provider_removed',
        message: 'detail warning',
      }],
    })
    const replayDrift = createDriftRecord({
      status: 'historical_valid_currently_missing',
      historicalModelId: 'replay-model',
      historicalToolIds: ['tool.replay'],
      historicalThinkingSummary: '服务端历史思考',
      warnings: [{
        code: 'historical_valid_currently_missing',
        message: 'replay warning',
      }],
    })

    const drift = resolvePersistedHistoryDrift(createHistoryState({
      summaryDrift,
      availabilityDrift: detailDrift,
      availabilityInterpretation: replayDrift,
    }))

    expect(drift).toEqual({
      historicalModelId: 'replay-model',
      historicalToolIds: ['tool.replay'],
      historicalThinkingSummary: '服务端历史思考',
      warnings: [{
        code: 'historical_valid_currently_missing',
        message: 'replay warning',
      }],
      requiresExplicitRebind: true,
    })
  })

  it('falls back to thread detail drift when replay is unavailable', () => {
    const detailDrift = createDriftRecord({
      status: 'multiple_issues',
      historicalModelId: 'detail-model',
      historicalToolIds: ['tool.detail'],
      warnings: [{
        code: 'historical_provider_removed',
        message: 'detail provider warning',
      }, {
        code: 'historical_tool_unregistered',
        message: 'detail tool warning',
      }],
    })

    const drift = resolvePersistedHistoryDrift(createHistoryState({
      summaryDrift: createDriftRecord({
        status: 'historical_tool_unregistered',
        historicalModelId: LABEL_SUMMARY_MODEL,
      }),
      availabilityDrift: detailDrift,
      replayStatus: 'idle',
    }))

    expect(drift).toEqual({
      historicalModelId: 'detail-model',
      historicalToolIds: ['tool.detail'],
      historicalThinkingSummary: null,
      warnings: [{
        code: 'historical_provider_removed',
        message: 'detail provider warning',
      }, {
        code: 'historical_tool_unregistered',
        message: 'detail tool warning',
      }],
      requiresExplicitRebind: true,
    })
  })

  it('falls back to thread summary drift before detail loads', () => {
    const drift = evaluatePersistedHistoryDrift(createHistoryState({
      summaryDrift: createDriftRecord({
        status: 'historical_provider_removed',
        historicalModelId: LABEL_SUMMARY_MODEL,
        historicalToolIds: ['tool.summary'],
        historicalThinkingSelection: {
          series: 'unified-4-level-v1',
          mode: 'preset',
          level: 'medium',
          value: {
            valueType: 'code',
            code: 'medium',
            labelZh: '中',
          },
        },
        warnings: [{
          code: 'historical_provider_removed',
          message: 'summary warning',
        }],
      }),
      replayStatus: 'idle',
    }))

    expect(drift).toEqual({
      historicalModelId: LABEL_SUMMARY_MODEL,
      historicalToolIds: ['tool.summary'],
      historicalThinkingSummary: 'unified-4-level-v1 / 中 / medium / preset',
      warnings: [{
        code: 'historical_provider_removed',
        message: 'summary warning',
      }],
      requiresExplicitRebind: true,
    })
  })
  })
})

function createDriftRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const warnings = Array.isArray(overrides.warnings) ? overrides.warnings : []

  return {
    status: 'no_drift',
    historicalModelId: null,
    historicalToolIds: [],
    historicalThinkingSummary: null,
    warnings,
    requiresExplicitRebind: warnings.length > 0,
    ...overrides,
  }
}

function createHistoryState(input: {
  summaryDrift?: Record<string, unknown> | null
  availabilityDrift?: Record<string, unknown> | null
  availabilityInterpretation?: Record<string, unknown> | null
  replayStatus?: AssistantSessionHistoryState['replayStatus']
} = {}): AssistantSessionHistoryState {
  const runSummary = {
    runId: 'run-history-1',
    threadId: 'session-1',
    status: 'completed',
    createdAt: '2026-04-13T15:00:00Z',
    updatedAt: LABEL_2026_13T15,
    startedAt: '2026-04-13T15:00:01Z',
    terminalAt: LABEL_2026_13T15,
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
      updatedAt: LABEL_2026_13T15,
      lastActivityAt: LABEL_2026_13T15,
      lastRunId: 'run-history-1',
      lastRunStatus: 'completed',
      lastUserMessagePreview: '你好',
      lastAssistantMessagePreview: '历史摘要',
      driftSummary: input.summaryDrift ?? null,
    },
    detailStatus: 'ready',
    detailError: null,
    timelineItems: [],
    runSummaries: [{ ...runSummary }],
    latestConfigurationSnapshot: null,
    availabilityDrift: input.availabilityDrift ?? null,
    selectedRunId: 'run-history-1',
    replayStatus,
    replayError: null,
    replay: replayStatus === 'ready'
      ? {
          ok: true,
          version: 'chat-history-v1',
          run: { ...runSummary },
          historicalSnapshot: null,
          orderedEvents: [],
          toolCallBlocks: [],
          diagnosticBlocks: [],
          terminalState: null,
          availabilityInterpretation: input.availabilityInterpretation ?? null,
        }
      : null,
  }
}
