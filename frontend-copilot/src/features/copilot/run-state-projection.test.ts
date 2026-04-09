import { describe, expect, it } from 'vitest'

import { projectConversationTurnsFromRunState } from './run-state-projection'
import { createIdleCopilotRunState } from './run-segment-reducer'
import type { CopilotConversationTurn } from './copilot-chat-helpers'
import type { CopilotRunState } from './types'
import {
  createRuntimeModelRoute,
  createRuntimeThinkingCapability,
} from './thread-run-contract.test-support'

describe('run state projection', () => {
  it('projects assistant/tool segments into stable legacy turns while preserving prior user turns', () => {
    const userTurns: CopilotConversationTurn[] = [
      {
        id: 'user:1',
        kind: 'user',
        title: '',
        content: '请先查天气再回答',
        status: 'completed',
      },
    ]
    const thinkingCapabilitySnapshot = createRuntimeThinkingCapability({
      status: 'unknown-with-override',
      source: 'override',
      supportedLevels: ['off', 'auto', 'medium'],
      defaultLevel: 'auto',
      reasonCode: 'override_candidate_levels_applied',
      providerHint: 'unknown-route-override',
      overrideLevels: ['off', 'auto', 'medium'],
    })
    const runState: CopilotRunState = {
      ...createIdleCopilotRunState(),
      phase: 'completed',
      runId: 'run-1',
      threadId: 'session-1',
      resolvedModelId: 'qwen-plus',
      resolvedModelRoute: createRuntimeModelRoute(),
      resolvedToolIds: ['tool.weather-current'],
      requestOptions: { trace: true },
      requestedThinkingLevel: 'medium',
      appliedThinkingLevel: 'auto',
      thinkingCapabilitySnapshot: thinkingCapabilitySnapshot,
      segments: [
        {
          id: 'assistant:run-1:1',
          kind: 'assistant',
          runId: 'run-1',
          assistantMessageId: 'run-1:assistant',
          text: '第一段',
          firstContentSequence: 2,
          startedSequence: 1,
          lastSequence: 2,
          status: 'completed',
          resolvedModelId: null,
          resolvedModelRoute: null,
          resolvedToolIds: [],
          requestOptions: {},
        },
        {
          id: 'tool:run-1:tool.weather-current:call-1',
          kind: 'tool',
          runId: 'run-1',
          startedSequence: 3,
          lastSequence: 3,
          status: 'completed',
          toolCallId: 'tool.weather-current:call-1',
          toolId: 'tool.weather-current',
          toolPhase: 'completed',
          title: '天气工具已返回结果',
          summary: 'Shenzhen：晴 / 24°C / 湿度 60%',
          inputSummary: '{"location":"Shenzhen"}',
          resultSummary: 'Shenzhen：晴 / 24°C / 湿度 60%',
          errorSummary: null,
        },
        {
          id: 'assistant:run-1:2',
          kind: 'assistant',
          runId: 'run-1',
          assistantMessageId: 'run-1:assistant',
          text: '第二段',
          firstContentSequence: 4,
          startedSequence: 4,
          lastSequence: 5,
          status: 'completed',
          resolvedModelId: 'qwen-plus',
          resolvedModelRoute: createRuntimeModelRoute(),
          resolvedToolIds: ['tool.weather-current'],
          requestOptions: { trace: true },
        },
        {
          id: 'terminal:run-1:completed',
          kind: 'terminal',
          runId: 'run-1',
          startedSequence: 5,
          lastSequence: 5,
          status: 'completed',
          terminalPhase: 'completed',
          assistantMessageId: 'run-1:assistant',
          cancelReason: null,
          failure: null,
          resolvedModelId: 'qwen-plus',
          resolvedModelRoute: createRuntimeModelRoute(),
          resolvedToolIds: ['tool.weather-current'],
          requestOptions: { trace: true },
        },
      ],
    }

    const projectedTurns = projectConversationTurnsFromRunState({
      userTurns,
      runState,
    })

    expect(projectedTurns.map((turn) => turn.kind)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ])
    expect(projectedTurns[1]).toMatchObject({
      kind: 'assistant',
      content: '第一段',
    })
    expect(projectedTurns[2]).toMatchObject({
      kind: 'tool',
      content: 'Shenzhen：晴 / 24°C / 湿度 60%',
      resultSummary: 'Shenzhen：晴 / 24°C / 湿度 60%',
    })
    expect(projectedTurns[3]).toMatchObject({
      kind: 'assistant',
      content: '第二段',
      resolvedModelId: 'qwen-plus',
      requestedThinkingLevel: 'medium',
      appliedThinkingLevel: 'auto',
      thinkingCapabilitySnapshot,
    })
  })
})
