import { describe, expect, it, vi } from 'vitest'

import {
  applyRuntimeRunEventToCopilotRunState,
  createIdleCopilotRunState,
  createStartingCopilotRunState,
  markCopilotRunCancelled,
} from './run-segment-reducer'
import { createRuntimeModelRoute, createRuntimeRunCompletedEvent, createRuntimeToolEvent } from './thread-run-contract.test-support'

describe('run segment reducer', () => {
  it('merges compat events into a segment-ready run state with multiple assistant/tool segments', () => {
    const initialState = createStartingCopilotRunState({
      threadId: 'session-1',
      activeModelRoute: createRuntimeModelRoute(),
      requestOptions: { trace: true },
    })

    const stateAfterEvents = [
      {
        type: 'run_started' as const,
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 1,
        payload: {
          assistantMessageId: 'run-1:assistant',
        },
      },
      {
        type: 'text_delta' as const,
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          assistantMessageId: 'run-1:assistant',
          delta: '第一段',
        },
      },
      createRuntimeToolEvent({
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 3,
        payload: {
          toolCallId: 'tool.weather-current:call-1',
          toolId: 'tool.weather-current',
          phase: 'completed',
          title: '天气工具已返回结果',
          summary: 'Shenzhen：晴 / 24°C / 湿度 60%',
          resultSummary: 'Shenzhen：晴 / 24°C / 湿度 60%',
        },
      }),
      {
        type: 'text_delta' as const,
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 4,
        payload: {
          assistantMessageId: 'run-1:assistant',
          delta: '第二段',
        },
      },
      createRuntimeRunCompletedEvent({
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 5,
        payload: {
          assistantMessageId: 'run-1:assistant',
          assistantText: '第一段第二段',
          resolvedModelId: 'qwen-plus',
          resolvedModelRoute: createRuntimeModelRoute(),
          resolvedToolIds: ['tool.weather-current'],
          requestOptions: { trace: true },
        },
      }),
    ].reduce(applyRuntimeRunEventToCopilotRunState, initialState)

    expect(stateAfterEvents.phase).toBe('completed')
    expect(stateAfterEvents.threadId).toBe('session-1')
    expect(stateAfterEvents.runId).toBe('run-1')
    expect(stateAfterEvents.segments.map((segment) => segment.kind)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'terminal',
    ])
    expect(stateAfterEvents.segments.filter((segment) => segment.kind === 'assistant')).toHaveLength(2)
    expect(stateAfterEvents.segments.find((segment) => segment.kind === 'tool')).toMatchObject({
      kind: 'tool',
      toolCallId: 'tool.weather-current:call-1',
      status: 'completed',
    })
    expect(stateAfterEvents.segments[stateAfterEvents.segments.length - 1]).toMatchObject({
      kind: 'terminal',
      terminalPhase: 'completed',
    })
  })

  it('keeps reasoning segments distinct from tool and assistant content', () => {
    const initialState = createStartingCopilotRunState({
      threadId: 'session-1',
      activeModelRoute: createRuntimeModelRoute(),
      requestOptions: { trace: true },
    })

    const stateAfterEvents = [
      {
        type: 'run_started' as const,
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 1,
        payload: {
          assistantMessageId: 'run-1:assistant',
        },
      },
      {
        type: 'reasoning_delta' as const,
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          delta: '先思考。',
        },
      },
      createRuntimeToolEvent({
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 3,
        payload: {
          toolCallId: 'tool.weather-current:call-1',
          toolId: 'tool.weather-current',
          phase: 'completed',
          title: '天气工具已返回结果',
          summary: 'Shenzhen：晴 / 24°C / 湿度 60%',
          resultSummary: 'Shenzhen：晴 / 24°C / 湿度 60%',
        },
      }),
      {
        type: 'reasoning_delta' as const,
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 4,
        payload: {
          delta: '再思考。',
        },
      },
      {
        type: 'text_delta' as const,
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 5,
        payload: {
          assistantMessageId: 'run-1:assistant',
          delta: '最终回答',
        },
      },
      createRuntimeRunCompletedEvent({
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 6,
        payload: {
          assistantMessageId: 'run-1:assistant',
          assistantText: '最终回答',
          resolvedModelId: 'qwen-plus',
          resolvedModelRoute: createRuntimeModelRoute(),
          resolvedToolIds: ['tool.weather-current'],
          requestOptions: { trace: true },
        },
      }),
    ].reduce(applyRuntimeRunEventToCopilotRunState, initialState)

    expect(stateAfterEvents.segments.map((segment) => segment.kind)).toEqual([
      'reasoning',
      'tool',
      'reasoning',
      'assistant',
      'terminal',
    ])
    expect(stateAfterEvents.segments[0]).toMatchObject({
      kind: 'reasoning',
      text: '先思考。',
      status: 'completed',
    })
    expect(stateAfterEvents.segments[2]).toMatchObject({
      kind: 'reasoning',
      text: '再思考。',
      status: 'completed',
    })
    expect(stateAfterEvents.segments[3]).toMatchObject({
      kind: 'assistant',
      text: '最终回答',
      status: 'completed',
    })
  })

  it('records reasoning observation start and finish times when the segment begins and completes', () => {
    const initialState = createStartingCopilotRunState({
      threadId: 'session-1',
      activeModelRoute: createRuntimeModelRoute(),
      requestOptions: { trace: true },
    })
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(4_279)

    const stateAfterEvents = [
      {
        type: 'reasoning_delta' as const,
        runId: 'run-observed-reasoning',
        sessionId: 'session-1',
        sequence: 1,
        payload: {
          delta: '先分析。',
        },
      },
      {
        type: 'text_delta' as const,
        runId: 'run-observed-reasoning',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          assistantMessageId: 'run-observed-reasoning:assistant',
          delta: '最终答复。',
        },
      },
    ].reduce(applyRuntimeRunEventToCopilotRunState, initialState)

    expect(stateAfterEvents.segments[0]).toMatchObject({
      kind: 'reasoning',
      text: '先分析。',
      status: 'completed',
      observedStartedAt: 1_000,
      observedFinishedAt: 4_279,
    })
    expect(stateAfterEvents.segments[1]).toMatchObject({
      kind: 'assistant',
      text: '最终答复。',
      status: 'streaming',
    })

    nowSpy.mockRestore()
  })

  it('marks streaming segments cancelled when transport abort happens before terminal event', () => {
    const streamingState = applyRuntimeRunEventToCopilotRunState(
      applyRuntimeRunEventToCopilotRunState(createIdleCopilotRunState(), {
        type: 'run_started',
        runId: 'run-cancel',
        sessionId: 'session-1',
        sequence: 1,
        payload: {
          assistantMessageId: 'run-cancel:assistant',
        },
      }),
      {
        type: 'text_delta',
        runId: 'run-cancel',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          assistantMessageId: 'run-cancel:assistant',
          delta: '第一段',
        },
      },
    )

    const cancelledState = markCopilotRunCancelled(streamingState, {
      reason: 'cancelled',
    })

    expect(cancelledState.phase).toBe('cancelled')
    expect(cancelledState.cancelReason).toBe('cancelled')
    expect(cancelledState.segments[cancelledState.segments.length - 1]).toMatchObject({
      kind: 'terminal',
      terminalPhase: 'cancelled',
    })
  })
})
