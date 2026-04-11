import { describe, expect, it } from 'vitest'

import {
  createRuntimeModelRoute,
  createRuntimeReasoningSuppressionBasis,
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
      resolvedToolIds: [],
      requestOptions: {},
      requestedThinkingSelection: null,
      appliedThinkingSelection: null,
      requestedThinkingLevel: null,
      appliedThinkingLevel: null,
      thinkingCapabilitySnapshot: null,
      reasoningSuppressed: false,
      reasoningTraceState: 'visible',
      reasoningSuppressionBasis: null,
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
      resolvedModelId: 'qwen-plus',
      resolvedModelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openai',
        modelId: 'qwen-plus',
      }),
      resolvedToolIds: ['tool.remote-search'],
      requestOptions: { trace: true },
      requestedThinkingSelection: null,
      appliedThinkingSelection: null,
      requestedThinkingLevel: 'medium',
      appliedThinkingLevel: 'auto',
      thinkingCapabilitySnapshot,
      reasoningSuppressed: true,
      reasoningTraceState: 'suppressed',
      reasoningSuppressionBasis: createRuntimeReasoningSuppressionBasis({
        shouldSuppress: true,
        source: 'capability-visibility',
        reasonCode: 'capability_visibility_suppressed',
        appliedThinkingLevel: 'auto',
        reasoningVisibility: 'suppressed',
      }),
    })

    expect(items[0]).toMatchObject({
      kind: 'assistant',
      requestedThinkingLevel: 'medium',
      appliedThinkingLevel: 'auto',
      thinkingCapabilitySnapshot,
      reasoningTraceState: 'suppressed',
      reasoningSuppressionBasis: {
        shouldSuppress: true,
        source: 'capability-visibility',
        reasonCode: 'capability_visibility_suppressed',
        appliedThinkingLevel: 'auto',
        reasoningVisibility: 'suppressed',
      },
    })
    expect(items[1]).toMatchObject({
      kind: 'terminal',
      requestedThinkingLevel: 'medium',
      appliedThinkingLevel: 'auto',
      thinkingCapabilitySnapshot,
      reasoningTraceState: 'suppressed',
      reasoningSuppressionBasis: {
        shouldSuppress: true,
        source: 'capability-visibility',
        reasonCode: 'capability_visibility_suppressed',
        appliedThinkingLevel: 'auto',
        reasoningVisibility: 'suppressed',
      },
      errorDetail: {
        source: 'streaming',
        code: 'thinking_not_supported_for_route',
        stage: 'streaming',
        requestedMethod: 'run/stream',
        rawMessage: 'route rejected',
        resolvedModelId: 'qwen-plus',
        resolvedToolIds: ['tool.remote-search'],
        requestOptions: {
          trace: true,
        },
      },
    })
  })

  it('omits reasoning cards when run state marks the trace as suppressed but keeps visible reasoning unchanged otherwise', () => {
    const suppressedItems = buildCopilotRunSegmentViewModel({
      segments: [{
        id: 'reasoning:run-hidden:1',
        kind: 'reasoning',
        runId: 'run-hidden',
        startedSequence: 1,
        lastSequence: 1,
        status: 'completed',
        text: '这段思考不应显示。',
        observedStartedAt: 1_000,
        observedFinishedAt: 1_500,
        isCollapsedByDefault: true,
      }],
      activeModelRoute: createRuntimeModelRoute(),
      resolvedModelId: null,
      resolvedModelRoute: null,
      resolvedToolIds: [],
      requestOptions: {},
      requestedThinkingSelection: null,
      appliedThinkingSelection: null,
      requestedThinkingLevel: 'auto',
      appliedThinkingLevel: 'auto',
      thinkingCapabilitySnapshot: null,
      reasoningSuppressed: true,
      reasoningTraceState: 'suppressed',
      reasoningSuppressionBasis: createRuntimeReasoningSuppressionBasis({
        shouldSuppress: true,
        source: 'capability-visibility',
        reasonCode: 'capability_visibility_suppressed',
        appliedThinkingLevel: 'auto',
        reasoningVisibility: 'suppressed',
      }),
    })

    const visibleItems = buildCopilotRunSegmentViewModel({
      segments: [{
        id: 'reasoning:run-visible:1',
        kind: 'reasoning',
        runId: 'run-visible',
        startedSequence: 1,
        lastSequence: 1,
        status: 'completed',
        text: '这段思考应该显示。',
        observedStartedAt: 2_000,
        observedFinishedAt: 2_500,
        isCollapsedByDefault: true,
      }],
      activeModelRoute: createRuntimeModelRoute(),
      resolvedModelId: null,
      resolvedModelRoute: null,
      resolvedToolIds: [],
      requestOptions: {},
      requestedThinkingSelection: null,
      appliedThinkingSelection: null,
      requestedThinkingLevel: 'auto',
      appliedThinkingLevel: 'auto',
      thinkingCapabilitySnapshot: null,
      reasoningSuppressed: false,
      reasoningTraceState: 'visible',
      reasoningSuppressionBasis: createRuntimeReasoningSuppressionBasis({
        shouldSuppress: false,
        source: 'none',
        appliedThinkingLevel: 'auto',
      }),
    })

    expect(suppressedItems).toEqual([])
    expect(visibleItems).toMatchObject([{
      kind: 'reasoning',
      content: '这段思考应该显示。',
      observedStartedAt: 2_000,
      observedFinishedAt: 2_500,
    }])
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
