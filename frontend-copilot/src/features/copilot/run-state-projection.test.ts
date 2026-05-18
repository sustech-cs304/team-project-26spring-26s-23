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
      resolvedToolIds: ['tool.remote-search'],
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
          id: 'tool:run-1:tool.remote-search:call-1',
          kind: 'tool',
          runId: 'run-1',
          startedSequence: 3,
          lastSequence: 3,
          status: 'completed',
          toolCallId: 'tool.remote-search:call-1',
          toolId: 'tool.remote-search',
          toolPhase: 'completed',
          title: '天气工具已返回结果',
          summary: '{\n  "condition": "晴",\n  "humidity": 60,\n  "location": "Shenzhen",\n  "summary": "体感舒适，适合外出。",\n  "temperatureC": 24\n}',
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
          resolvedToolIds: ['tool.remote-search'],
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
          resolvedToolIds: ['tool.remote-search'],
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
      content: '{\n  "condition": "晴",\n  "humidity": 60,\n  "location": "Shenzhen",\n  "summary": "体感舒适，适合外出。",\n  "temperatureC": 24\n}',
      resultSummary: 'Shenzhen：晴 / 24°C / 湿度 60%',
    })
    expect(() => JSON.parse(projectedTurns[2]?.content ?? '')).not.toThrow()
    expect(projectedTurns[3]).toMatchObject({
      kind: 'assistant',
      content: '第二段',
      resolvedModelId: 'qwen-plus',
      requestedThinkingLevel: 'medium',
      appliedThinkingLevel: 'auto',
      thinkingCapabilitySnapshot,
    })
  })

  it('keeps failed tool turns visible without projecting a terminal error when the run later completes', () => {
    const projectedTurns = projectConversationTurnsFromRunState({
      userTurns: [{
        id: 'user:1',
        kind: 'user',
        title: '',
        content: '请解释这次工具失败',
        status: 'completed',
      }],
      runState: {
        ...createIdleCopilotRunState(),
        phase: 'completed',
        runId: 'run-tool-recovered',
        threadId: 'session-1',
        resolvedModelId: 'qwen-plus',
        resolvedModelRoute: createRuntimeModelRoute(),
        resolvedToolIds: ['tool.remote-search'],
        requestOptions: { trace: true },
        segments: [
          {
            id: 'tool:run-tool-recovered:tool.remote-search:call-1',
            kind: 'tool',
            runId: 'run-tool-recovered',
            startedSequence: 2,
            lastSequence: 3,
            status: 'failed',
            toolCallId: 'tool.remote-search:call-1',
            toolId: 'tool.remote-search',
            toolPhase: 'failed',
            title: '工具调用失败',
            summary: '工具执行失败。',
            inputSummary: '{"location":"Shenzhen"}',
            resultSummary: null,
            errorSummary: 'boom',
          },
          {
            id: 'assistant:run-tool-recovered:1',
            kind: 'assistant',
            runId: 'run-tool-recovered',
            assistantMessageId: 'run-tool-recovered:assistant',
            text: '我可以解释失败并继续。',
            firstContentSequence: 4,
            startedSequence: 4,
            lastSequence: 5,
            status: 'completed',
            resolvedModelId: 'qwen-plus',
            resolvedModelRoute: createRuntimeModelRoute(),
            resolvedToolIds: ['tool.remote-search'],
            requestOptions: { trace: true },
          },
          {
            id: 'terminal:run-tool-recovered:completed',
            kind: 'terminal',
            runId: 'run-tool-recovered',
            startedSequence: 5,
            lastSequence: 5,
            status: 'completed',
            terminalPhase: 'completed',
            assistantMessageId: 'run-tool-recovered:assistant',
            cancelReason: null,
            failure: null,
            resolvedModelId: 'qwen-plus',
            resolvedModelRoute: createRuntimeModelRoute(),
            resolvedToolIds: ['tool.remote-search'],
            requestOptions: { trace: true },
          },
        ],
      },
    })

    expect(projectedTurns.map((turn) => turn.kind)).toEqual([
      'user',
      'tool',
      'assistant',
    ])
    expect(projectedTurns[1]).toMatchObject({
      kind: 'tool',
      content: '工具执行失败。',
      status: 'failed',
      errorSummary: 'boom',
    })
    expect(projectedTurns[2]).toMatchObject({
      kind: 'assistant',
      content: '我可以解释失败并继续。',
      status: 'completed',
    })
    expect(projectedTurns.find((turn) => turn.kind === 'error')).toBeUndefined()
  })

  it('keeps failed tool turns visible and appends a terminal error turn when the run later fails fatally', () => {
    const projectedTurns = projectConversationTurnsFromRunState({
      userTurns: [{
        id: 'user:1',
        kind: 'user',
        title: '',
        content: '请解释这次工具失败',
        status: 'completed',
      }],
      runState: {
        ...createIdleCopilotRunState(),
        phase: 'failed',
        runId: 'run-tool-then-failed',
        threadId: 'session-1',
        failure: {
          code: 'agent_execution_failed',
          message: 'Model stream collapsed.',
          details: {
            stage: 'execute_model',
          },
        },
        segments: [
          {
            id: 'tool:run-tool-then-failed:tool.remote-search:call-1',
            kind: 'tool',
            runId: 'run-tool-then-failed',
            startedSequence: 2,
            lastSequence: 3,
            status: 'failed',
            toolCallId: 'tool.remote-search:call-1',
            toolId: 'tool.remote-search',
            toolPhase: 'failed',
            title: '工具调用失败',
            summary: '工具执行失败。',
            inputSummary: '{"location":"Shenzhen"}',
            resultSummary: null,
            errorSummary: 'boom',
          },
          {
            id: 'terminal:run-tool-then-failed:failed',
            kind: 'terminal',
            runId: 'run-tool-then-failed',
            startedSequence: 4,
            lastSequence: 4,
            status: 'failed',
            terminalPhase: 'failed',
            assistantMessageId: null,
            cancelReason: null,
            failure: {
              code: 'agent_execution_failed',
              message: 'Model stream collapsed.',
              details: {
                stage: 'execute_model',
              },
            },
            resolvedModelId: null,
            resolvedModelRoute: null,
            resolvedToolIds: [],
            requestOptions: {},
          },
        ],
      },
    })

    expect(projectedTurns.map((turn) => turn.kind)).toEqual([
      'user',
      'tool',
      'error',
    ])
    expect(projectedTurns[1]).toMatchObject({
      kind: 'tool',
      content: '工具执行失败。',
      status: 'failed',
      errorSummary: 'boom',
    })
    expect(projectedTurns[2]).toMatchObject({
      kind: 'error',
      title: '发送失败',
      content: '当前响应失败，请重试。',
      status: 'failed',
    })
  })

  it('preserves explicit authentication failure guidance when projecting failed runs', () => {
    const projectedTurns = projectConversationTurnsFromRunState({
      userTurns: [],
      runState: {
        ...createIdleCopilotRunState(),
        phase: 'failed',
        runId: 'run-auth',
        threadId: 'session-1',
        failure: {
          code: 'authentication_required',
          message: 'CAS 登录失败：用户名或密码错误，请更新设置中的 CAS 密码。',
          details: {
            toolId: 'blackboard.snapshot.sync',
          },
        },
        segments: [
          {
            id: 'assistant:run-auth:1',
            kind: 'assistant',
            runId: 'run-auth',
            assistantMessageId: 'run-auth:assistant',
            text: '之前已有部分输出',
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
            id: 'terminal:run-auth:failed',
            kind: 'terminal',
            runId: 'run-auth',
            startedSequence: 2,
            lastSequence: 2,
            status: 'failed',
            terminalPhase: 'failed',
            assistantMessageId: null,
            cancelReason: null,
            failure: {
              code: 'authentication_required',
              message: 'CAS 登录失败：用户名或密码错误，请更新设置中的 CAS 密码。',
              details: {
                toolId: 'blackboard.snapshot.sync',
              },
            },
            resolvedModelId: null,
            resolvedModelRoute: null,
            resolvedToolIds: [],
            requestOptions: {},
          },
        ],
      },
    })

    expect(projectedTurns).toMatchObject([{
      kind: 'error',
      content: 'CAS 登录失败：用户名或密码错误，请更新设置中的 CAS 密码。',
    }])
  })
})
