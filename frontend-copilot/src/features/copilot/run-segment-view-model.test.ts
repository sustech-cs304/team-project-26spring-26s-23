import { describe, expect, it } from 'vitest'

import {
  createRuntimeModelRoute,
  createRuntimeThinkingCapability,
} from './chat-contract.test-support'
import {
  buildCopilotRunSegmentViewModel,
  formatCopilotReasoningDurationLabel,
  resolveCopilotReasoningElapsedMs,
} from './run-segment-view-model'

describe('run segment view model', () => {
  it('projects reasoning observation timestamps into the reasoning view item', () => {
    const items = buildCopilotRunSegmentViewModel({
      segments: [{
        id: 'reasoning:run-1:1',
        kind: 'reasoning',
        runId: 'run-1',
        startedSequence: 2,
        lastSequence: 4,
        status: 'completed',
        text: '先分析，再回答。',
        observedStartedAt: 1_000,
        observedFinishedAt: 3_279,
        isCollapsedByDefault: true,
      }],
      activeModelRoute: createRuntimeModelRoute(),
      resolvedModelId: null,
      resolvedModelRoute: null,
    })

    expect(items).toEqual([{
      id: 'reasoning:run-1:1',
      kind: 'reasoning',
      runId: 'run-1',
      sequence: 2,
      title: '思考',
      content: '先分析，再回答。',
      observedStartedAt: 1_000,
      observedFinishedAt: 3_279,
      status: 'completed',
      isCollapsedByDefault: true,
    }])
  })

  it('projects run thinking metadata onto assistant and terminal items', () => {
    const thinkingCapabilitySnapshot = createRuntimeThinkingCapability({
      status: 'unknown-with-override',
      source: 'override',
      supportedLevels: ['off', 'auto', 'medium'],
      defaultLevel: 'auto',
      reasonCode: 'override_candidate_levels_applied',
      providerHint: 'unknown-route-override',
      overrideLevels: ['off', 'auto', 'medium'],
    })

    const items = buildCopilotRunSegmentViewModel({
      segments: [
        {
          id: 'assistant:run-1:1',
          kind: 'assistant',
          runId: 'run-1',
          assistantMessageId: 'run-1:assistant',
          text: '回答内容',
          firstContentSequence: 1,
          startedSequence: 1,
          lastSequence: 1,
          status: 'completed',
          resolvedModelId: null,
          resolvedModelRoute: null,
          resolvedToolIds: [],
          requestOptions: {},
        },
        {
          id: 'terminal:run-1:failed',
          kind: 'terminal',
          runId: 'run-1',
          startedSequence: 2,
          lastSequence: 2,
          status: 'failed',
          terminalPhase: 'failed',
          assistantMessageId: 'run-1:assistant',
          cancelReason: null,
          failure: {
            code: 'thinking_not_supported_for_route',
            message: 'route rejected',
            details: {},
          },
          resolvedModelId: null,
          resolvedModelRoute: null,
          resolvedToolIds: [],
          requestOptions: {},
        },
      ],
      activeModelRoute: createRuntimeModelRoute(),
      resolvedModelId: null,
      resolvedModelRoute: null,
      requestedThinkingLevel: 'medium',
      appliedThinkingLevel: 'auto',
      thinkingCapabilitySnapshot,
    })

    expect(items[0]).toMatchObject({
      kind: 'assistant',
      requestedThinkingLevel: 'medium',
      appliedThinkingLevel: 'auto',
      thinkingCapabilitySnapshot,
    })
    expect(items[1]).toMatchObject({
      kind: 'terminal',
      requestedThinkingLevel: 'medium',
      appliedThinkingLevel: 'auto',
      thinkingCapabilitySnapshot,
    })
  })

  it('formats reasoning duration labels at 0.1 second precision for streaming and finished cards', () => {
    const streamingReasoning = {
      title: '思考',
      observedStartedAt: 1_000,
      observedFinishedAt: null,
    }
    const completedReasoning = {
      title: '思考',
      observedStartedAt: 1_000,
      observedFinishedAt: 3_279,
    }

    expect(resolveCopilotReasoningElapsedMs(streamingReasoning, 2_345)).toBe(1_345)
    expect(formatCopilotReasoningDurationLabel(streamingReasoning, 2_345)).toBe('思考 1.3s')
    expect(resolveCopilotReasoningElapsedMs(completedReasoning, 9_999)).toBe(2_279)
    expect(formatCopilotReasoningDurationLabel(completedReasoning, 9_999)).toBe('思考 2.2s')
  })
})
