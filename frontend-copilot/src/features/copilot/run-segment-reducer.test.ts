import { describe, expect, it } from 'vitest'

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
