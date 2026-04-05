/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import {
  buildRuntimeDebugSummary,
  buildRuntimeMessageSendInput,
  createEmptyComposerDraft,
  buildSessionDebugSummary,
  cancelStreamingToolTurns,
  createComposerDraftFromSession,
  createPendingAssistantTurn,
  formatRuntimeMessageSendError,
  parseRequestOptionsText,
  upsertToolStepTurn,
} from './copilot-chat-helpers'
import { RuntimeRequestError } from './thread-run-contract'
import { createRuntimeModelRoute, createRuntimeToolEvent } from './thread-run-contract.test-support'
import {
  createDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
} from './CopilotChatPanel.test-support'
import type { CopilotBootstrapState } from './types'

describe('copilot chat helpers', () => {
  it('builds runtime and session debug summaries for console logging', () => {
    expect(buildRuntimeDebugSummary({
      state: createReadyState() as Extract<CopilotBootstrapState, { status: 'ready' }>,
      directoryState: createDirectoryState(),
      selectedAgent: createSelectedAgent(),
    })).toEqual({
      runtimeSource: 'hosted',
      connectionSummary: '宿主管理 · http://127.0.0.1:8765 · development（已解析）',
      runtimeUrl: 'http://127.0.0.1:8765',
      hostedStatus: 'ready',
      directoryStatus: 'ready',
      selectedAgent: {
        id: 'general',
        label: '通用智能体',
      },
    })

    expect(buildSessionDebugSummary(createSessionShell())).toEqual({
      sessionId: 'session-1',
      boundAgent: 'general',
      capabilitiesVersion: 'cap-v12',
      allAvailableTools: ['tool.file-convert', 'tool.remote-search'],
      recommendedTools: ['tool.file-convert'],
      defaultEnabledTools: ['tool.file-convert'],
      defaultEnabledSource: {
        boundAgent: 'general',
        defaultModelPreference: 'openai/gpt-4.1',
        toolSelectionMode: 'recommendation-only',
      },
    })
  })

  it('creates composer defaults from empty state and seeds the session preferred model id while deferring route resolution', () => {
    expect(createEmptyComposerDraft()).toEqual({
      messageText: '',
      selectedModelId: '',
      selectedModelRoute: null,
      thinkingLevelIntent: null,
      thinkingLevelByModelKey: {},
      enabledTools: [],
      requestOptionsText: '{}',
    })

    const draft = createComposerDraftFromSession(createSessionShell())

    expect(draft).toEqual({
      messageText: '',
      selectedModelId: 'openai/gpt-4.1',
      selectedModelRoute: null,
      thinkingLevelIntent: null,
      thinkingLevelByModelKey: {},
      enabledTools: [],
      requestOptionsText: '{}',
    })
  })

  it('builds request-scoped message input with sessionId, boundAgent validation value, modelRoute, enabledTools and requestOptions', () => {
    const sessionShell = createSessionShell()
    const input = buildRuntimeMessageSendInput({
      runtimeUrl: 'http://127.0.0.1:8765',
      sessionShell,
      draft: {
        messageText: '请总结这份文档',
        selectedModelId: 'provider-openai:openai/gpt-4.1',
        selectedModelRoute: createRuntimeModelRoute({
          providerProfileId: 'provider-openai',
          snapshot: {
            provider: 'openai',
            endpointType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            modelId: 'qwen-plus',
          },
        }),
        thinkingLevelIntent: 'auto',
        thinkingLevelByModelKey: {
          'provider-openai|openai|openai-compatible|https://api.example.com/v1|qwen-plus': 'auto',
        },
        enabledTools: ['tool.remote-search', 'tool.file-convert', 'tool.remote-search'],
        requestOptionsText: '{"trace":true}',
      },
      requestOptions: {
        trace: true,
      },
    })

    expect(input).toEqual({
      runtimeUrl: 'http://127.0.0.1:8765',
      sessionId: 'session-1',
      agent: 'general',
      message: {
        role: 'user',
        content: '请总结这份文档',
      },
      modelRoute: {
        providerProfileId: 'provider-openai',
        snapshot: {
          provider: 'openai',
          endpointType: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          modelId: 'qwen-plus',
        },
      },
      thinkingLevelIntent: 'auto',
      enabledTools: ['tool.remote-search', 'tool.file-convert'],
      requestOptions: {
        trace: true,
      },
    })
  })

  it('parses minimal requestOptions json object and rejects non-object payloads', () => {
    expect(parseRequestOptionsText('{"trace":true}')).toEqual({ trace: true })
    expect(() => parseRequestOptionsText('[]')).toThrow('requestOptions 必须是 JSON 对象。')
  })

  it('inserts tool steps ahead of the pending assistant turn and updates the same step on completion/failure', () => {
    const assistantTurn = createPendingAssistantTurn({
      assistantMessageId: 'run-1:assistant',
    })
    const startedEvent = createRuntimeToolEvent({
      payload: {
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
        phase: 'started',
        title: '调用天气工具',
        summary: '正在获取 Shenzhen 的天气。',
        inputSummary: '{"location": "Shenzhen"}',
      },
    })
    const completedEvent = createRuntimeToolEvent({
      sequence: 3,
      payload: {
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
        phase: 'completed',
        title: '天气工具已返回结果',
        summary: 'Shenzhen：晴 / 24°C / 湿度 60%',
        inputSummary: '{"location": "Shenzhen"}',
        resultSummary: 'Shenzhen：晴 / 24°C / 湿度 60%',
      },
    })
    const failedEvent = createRuntimeToolEvent({
      sequence: 4,
      payload: {
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
        phase: 'failed',
        title: '工具调用失败',
        summary: '工具执行失败。',
        inputSummary: '{"location": "Shenzhen"}',
        errorSummary: 'boom',
      },
    })

    const withStarted = upsertToolStepTurn([assistantTurn], startedEvent, {
      assistantMessageId: 'run-1:assistant',
    })
    expect(withStarted).toHaveLength(2)
    expect(withStarted[0]).toMatchObject({
      kind: 'tool',
      toolCallId: 'tool.weather-current:call-1',
      toolPhase: 'started',
      status: 'streaming',
      content: '正在获取 Shenzhen 的天气。',
    })
    expect(withStarted[1].kind).toBe('assistant')

    const withCompleted = upsertToolStepTurn(withStarted, completedEvent, {
      assistantMessageId: 'run-1:assistant',
    })
    expect(withCompleted).toHaveLength(2)
    expect(withCompleted[0]).toMatchObject({
      kind: 'tool',
      toolCallId: 'tool.weather-current:call-1',
      toolPhase: 'completed',
      status: 'completed',
      title: '天气工具已返回结果',
      resultSummary: 'Shenzhen：晴 / 24°C / 湿度 60%',
    })

    const withFailed = upsertToolStepTurn(withStarted, failedEvent, {
      assistantMessageId: 'run-1:assistant',
    })
    expect(withFailed).toHaveLength(2)
    expect(withFailed[0]).toMatchObject({
      kind: 'tool',
      toolCallId: 'tool.weather-current:call-1',
      toolPhase: 'failed',
      status: 'failed',
      title: '工具调用失败',
      errorSummary: 'boom',
    })
  })

  it('cancels only in-flight tool steps while keeping other turns unchanged', () => {
    const cancelled = cancelStreamingToolTurns([
      {
        id: 'tool:pending',
        kind: 'tool',
        title: '调用天气工具',
        content: '正在获取 Shenzhen 的天气。',
        status: 'streaming',
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
        toolPhase: 'started',
      },
      {
        id: 'tool:done',
        kind: 'tool',
        title: '天气工具已返回结果',
        content: 'Shenzhen：晴 / 24°C / 湿度 60%',
        status: 'completed',
        toolCallId: 'tool.weather-current:call-2',
        toolId: 'tool.weather-current',
        toolPhase: 'completed',
      },
      {
        id: 'assistant:1',
        kind: 'assistant',
        title: '助手响应',
        content: '第一段',
        status: 'streaming',
      },
    ])

    expect(cancelled[0]).toMatchObject({
      kind: 'tool',
      status: 'cancelled',
      toolPhase: 'cancelled',
    })
    expect(cancelled[1]).toMatchObject({
      kind: 'tool',
      status: 'completed',
      toolPhase: 'completed',
    })
    expect(cancelled[2]).toMatchObject({
      kind: 'assistant',
      status: 'streaming',
    })
  })

  it('formats structured backend errors into explicit user-facing messages', () => {
    expect(formatRuntimeMessageSendError(new RuntimeRequestError('agent_mismatch: session bound agent differs', {
      code: 'agent_mismatch',
      status: 409,
    }))).toContain('agent_mismatch：当前消息携带的 agent 校验值与会话绑定智能体不一致')

    expect(formatRuntimeMessageSendError(new RuntimeRequestError('tool_not_found: unknown tool', {
      code: 'tool_not_found',
      status: 400,
    }))).toContain('tool_not_found：本次消息启用了后端未注册的 toolId')

    expect(formatRuntimeMessageSendError(new RuntimeRequestError('invalid_request: bad payload', {
      code: 'invalid_request',
      status: 400,
    }))).toContain('invalid_request：消息请求结构无效')
  })
})
