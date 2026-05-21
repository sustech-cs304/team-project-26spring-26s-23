import { describe, expect, it } from 'vitest'

import type { CopilotRunDiagnosticSummary } from './types'
import {
  appendAssistantDelta,
  cancelAssistantTurn,
  cancelStreamingToolTurns,
  completeAssistantTurn,
  createErrorTurn,
  createPendingAssistantTurn,
  createUserTurn,
  failAssistantTurn,
  upsertToolStepTurn,
  type CopilotConversationTurn,
} from './copilot-conversation-turns'
import type { RuntimeRunCompletedEvent, RuntimeToolEvent } from './thread-run-contract'
import { createRuntimeModelRoute, createRuntimeRunCompletedEvent, createRuntimeToolEvent } from './thread-run-contract.test-support'

const LABEL_TOOL_SEARCH = 'tool.remote-search'
const DIAGNOSTIC_NULL: CopilotRunDiagnosticSummary | null = null

describe('createUserTurn', () => {
  it('creates a user turn with completed status', () => {
    const result = createUserTurn('你好')

    expect(result.kind).toBe('user')
    expect(result.content).toBe('你好')
    expect(result.status).toBe('completed')
    expect(result.title).toBe('')
    expect(result.id.startsWith('user:')).toBe(true)
  })

  it('generates unique ids for different calls', () => {
    const a = createUserTurn('hello')
    const b = createUserTurn('hello')

    expect(a.id).not.toBe(b.id)
  })
})

describe('createPendingAssistantTurn', () => {
  it('creates a streaming assistant turn', () => {
    const result = createPendingAssistantTurn({
      assistantMessageId: 'run-1:assistant',
    })

    expect(result).toMatchObject({
      id: 'run-1:assistant',
      kind: 'assistant',
      title: '助手响应',
      content: '',
      status: 'streaming',
      diagnostic: null,
    })
  })

  it('includes diagnostic when provided', () => {
    const diagnostic: CopilotRunDiagnosticSummary = { code: 'skill_index_loaded', message: '', stage: 'load_skill_index', details: {} }
    const result = createPendingAssistantTurn({
      assistantMessageId: 'a1',
      diagnostic,
    })

    expect(result.diagnostic).toBe(diagnostic)
  })
})

describe('appendAssistantDelta', () => {
  it('appends content to a matching turn', () => {
    const turns: CopilotConversationTurn[] = [
      {
        id: 'r1:assistant',
        kind: 'assistant',
        title: '',
        content: '第一部分',
        status: 'streaming',
      },
    ]

    const updated = appendAssistantDelta(turns, {
      assistantMessageId: 'r1:assistant',
      delta: ' 补充',
    })

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      content: '第一部分 补充',
      status: 'streaming',
    })
  })

  it('leaves non-matching turns unchanged', () => {
    const turns: CopilotConversationTurn[] = [
      {
        id: 'r1:assistant',
        kind: 'assistant',
        title: '',
        content: 'A',
        status: 'streaming',
      },
      {
        id: 'r2:assistant',
        kind: 'assistant',
        title: '',
        content: 'B',
        status: 'streaming',
      },
    ]

    const updated = appendAssistantDelta(turns, {
      assistantMessageId: 'r1:assistant',
      delta: ' ok',
    })

    expect(updated[0].content).toBe('A ok')
    expect(updated[1].content).toBe('B')
  })
})

describe('completeAssistantTurn', () => {
  function createCompletedEvent(
    overrides?: Partial<RuntimeRunCompletedEvent['payload']>,
  ): RuntimeRunCompletedEvent {
    return createRuntimeRunCompletedEvent({
      runId: 'run-1',
      sessionId: 's1',
      sequence: 10,
      payload: {
        assistantMessageId: 'run-1:assistant',
        assistantText: '完整回答',
        resolvedModelId: 'qwen-plus',
        resolvedModelRoute: createRuntimeModelRoute(),
        resolvedToolIds: [LABEL_TOOL_SEARCH],
        requestOptions: { t: 1 },
        ...overrides,
      },
    })
  }

  it('completes the matching assistant turn', () => {
    const turns: CopilotConversationTurn[] = [
      {
        id: 'run-1:assistant',
        kind: 'assistant',
        title: '助手响应',
        content: '流式内容',
        status: 'streaming',
      },
    ]

    const updated = completeAssistantTurn(
      turns,
      createCompletedEvent(),
      DIAGNOSTIC_NULL,
    )

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      id: 'run-1:assistant',
      kind: 'assistant',
      content: '完整回答',
      status: 'completed',
      resolvedModelId: 'qwen-plus',
    })
    expect(updated[0].resolvedToolIds).toEqual([LABEL_TOOL_SEARCH])
    expect(updated[0].requestOptions).toEqual({ t: 1 })
  })

  it('creates a new assistant turn if no matching turn exists', () => {
    const turns: CopilotConversationTurn[] = []

    const updated = completeAssistantTurn(
      turns,
      createCompletedEvent({ assistantMessageId: 'run-new:assistant' }),
      DIAGNOSTIC_NULL,
    )

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      id: 'run-new:assistant',
      kind: 'assistant',
      content: '完整回答',
      status: 'completed',
    })
  })

  it('clones resolved tool ids and request options', () => {
    const turns: CopilotConversationTurn[] = [
      { id: 'run-1:assistant', kind: 'assistant', title: '', content: '', status: 'streaming' },
    ]
    const event = createCompletedEvent({
      resolvedToolIds: [LABEL_TOOL_SEARCH],
      requestOptions: { trace: true },
    })

    const updated = completeAssistantTurn(turns, event, DIAGNOSTIC_NULL)

    expect(updated[0].resolvedToolIds).not.toBe(event.payload.resolvedToolIds)
    expect(updated[0].requestOptions).not.toBe(event.payload.requestOptions)
  })
})

describe('upsertToolStepTurn', () => {
  it('inserts a new tool turn', () => {
    const turns: CopilotConversationTurn[] = [
      {
        id: 'run-1:assistant',
        kind: 'assistant',
        title: '',
        content: '',
        status: 'streaming',
      },
    ]

    const event = createRuntimeToolEvent({
      runId: 'run-1',
      sessionId: 's1',
      sequence: 5,
      payload: {
        toolCallId: 'tool.search:call-1',
        toolId: LABEL_TOOL_SEARCH,
        phase: 'started',
        title: '搜索中',
        summary: '正在搜索...',
        inputSummary: '{"q":"test"}',
      },
    })

    const updated = upsertToolStepTurn(turns, event, {
      assistantMessageId: 'run-1:assistant',
    })

    expect(updated).toHaveLength(2)
    expect(updated[0].kind).toBe('tool')
    expect(updated[0]).toMatchObject({
      toolCallId: 'tool.search:call-1',
      toolId: LABEL_TOOL_SEARCH,
      status: 'streaming',
      toolPhase: 'started',
    })
    expect(updated[1].kind).toBe('assistant')
  })

  it('updates existing tool turn by toolCallId', () => {
    const turns: CopilotConversationTurn[] = [
      {
        id: 'tool:tool.search:call-1',
        kind: 'tool',
        title: '搜索中',
        content: '正在搜索...',
        status: 'streaming',
        toolCallId: 'tool.search:call-1',
        toolId: LABEL_TOOL_SEARCH,
        toolPhase: 'started',
        inputSummary: '{"q":"test"}',
        resultSummary: null,
        errorSummary: null,
      },
    ]

    const completedEvent = createRuntimeToolEvent({
      runId: 'run-1',
      sequence: 6,
      payload: {
        toolCallId: 'tool.search:call-1',
        toolId: LABEL_TOOL_SEARCH,
        phase: 'completed',
        title: '搜索完成',
        summary: '已找到结果',
        inputSummary: '{"q":"test"}',
        resultSummary: 'results',
      },
    })

    const updated = upsertToolStepTurn(turns, completedEvent, {
      assistantMessageId: null,
    })

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      title: '搜索完成',
      content: '已找到结果',
      status: 'completed',
      toolPhase: 'completed',
      resultSummary: 'results',
    })
  })

  it('inserts at end when assistantMessageId is null', () => {
    const turns: CopilotConversationTurn[] = [
      createUserTurn('hello'),
    ]

    const event = createRuntimeToolEvent({
      payload: {
        toolCallId: 'tool.search:call-1',
        toolId: LABEL_TOOL_SEARCH,
        phase: 'started',
        title: '搜索',
        summary: '...',
        inputSummary: '{}',
      },
    })

    const updated = upsertToolStepTurn(turns, event, {
      assistantMessageId: null,
    })

    expect(updated).toHaveLength(2)
    expect(updated[0]?.kind === 'user' ? updated[0].kind : undefined).toBe('user')
    expect(updated[1].kind).toBe('tool')
  })

  it('inserts before assistant when assistant is streaming with empty content', () => {
    const turns: CopilotConversationTurn[] = [
      {
        id: 'run-1:assistant',
        kind: 'assistant',
        title: '',
        content: '',
        status: 'streaming',
      },
    ]

    const event = createRuntimeToolEvent({
      payload: {
        toolCallId: 'tool.search:call-1',
        toolId: LABEL_TOOL_SEARCH,
        phase: 'started',
        title: '搜索',
        summary: '...',
        inputSummary: '{}',
      },
    })

    const updated = upsertToolStepTurn(turns, event, {
      assistantMessageId: 'run-1:assistant',
    })

    expect(updated[0].kind).toBe('tool')
    expect(updated[1].kind).toBe('assistant')
  })

  it('inserts at end when assistant not streaming or has content', () => {
    const turns: CopilotConversationTurn[] = [
      {
        id: 'run-1:assistant',
        kind: 'assistant',
        title: '',
        content: 'has content',
        status: 'completed',
      },
    ]

    const event = createRuntimeToolEvent({
      payload: {
        toolCallId: 'tool.search:call-1',
        toolId: LABEL_TOOL_SEARCH,
        phase: 'completed',
        title: '搜索',
        summary: 'done',
        inputSummary: '{}',
      },
    })

    const updated = upsertToolStepTurn(turns, event, {
      assistantMessageId: 'run-1:assistant',
    })

    expect(updated[0].kind).toBe('assistant')
    expect(updated[1].kind).toBe('tool')
  })

  it('maps tool phases correctly', () => {
    const turns: CopilotConversationTurn[] = []

    const waitingEvent = createRuntimeToolEvent({
      payload: {
        toolCallId: 'tool.1:call',
        toolId: LABEL_TOOL_SEARCH,
        phase: 'waiting_approval',
        title: '待批准',
        summary: '...',
        inputSummary: '{}',
      },
    })

    const updated = upsertToolStepTurn(turns, waitingEvent, { assistantMessageId: null })

    expect(updated[0].status).toBe('streaming')
    expect(updated[0].toolPhase).toBe('waiting_approval')
  })
})

describe('cancelStreamingToolTurns', () => {
  it('cancels only streaming tool turns', () => {
    const turns: CopilotConversationTurn[] = [
      {
        id: 't1',
        kind: 'tool',
        title: '',
        content: '',
        status: 'streaming',
        toolCallId: 'c1',
        toolId: 't',
        toolPhase: 'started',
      },
      {
        id: 't2',
        kind: 'tool',
        title: '',
        content: '',
        status: 'completed',
        toolCallId: 'c2',
        toolId: 't',
        toolPhase: 'completed',
      },
      {
        id: 'a1',
        kind: 'assistant',
        title: '',
        content: '',
        status: 'streaming',
      },
    ]

    const updated = cancelStreamingToolTurns(turns)

    expect(updated[0]).toMatchObject({
      status: 'cancelled',
      toolPhase: 'cancelled',
    })
    expect(updated[1]).toMatchObject({
      status: 'completed',
      toolPhase: 'completed',
    })
    expect(updated[2]).toMatchObject({
      status: 'streaming',
    })
  })
})

describe('failAssistantTurn', () => {
  it('converts matching assistant turn to error', () => {
    const turns: CopilotConversationTurn[] = [
      {
        id: 'run-1:assistant',
        kind: 'assistant',
        title: '助手响应',
        content: '部分内容',
        status: 'streaming',
      },
    ]

    const updated = failAssistantTurn(turns, {
      assistantMessageId: 'run-1:assistant',
      content: '连接失败',
      diagnostic: DIAGNOSTIC_NULL,
    })

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      id: 'run-1:assistant',
      kind: 'error',
      title: '发送失败',
      content: '连接失败',
      status: 'failed',
    })
  })

  it('creates error turn when assistantMessageId is null', () => {
    const turns: CopilotConversationTurn[] = [
      createUserTurn('hello'),
    ]

    const updated = failAssistantTurn(turns, {
      assistantMessageId: null,
      content: '发送失败',
      diagnostic: DIAGNOSTIC_NULL,
    })

    expect(updated).toHaveLength(2)
    expect(updated[1].kind).toBe('error')
    expect(updated[1].content).toBe('发送失败')
    expect(updated[1].status).toBe('failed')
  })

  it('creates error turn when no matching assistant turn exists', () => {
    const turns: CopilotConversationTurn[] = []

    const updated = failAssistantTurn(turns, {
      assistantMessageId: 'nonexistent',
      content: '失败信息',
      diagnostic: DIAGNOSTIC_NULL,
    })

    expect(updated).toHaveLength(1)
    expect(updated[0].kind).toBe('error')
    expect(updated[0].id).toBe('nonexistent')
  })
})

describe('cancelAssistantTurn', () => {
  it('cancels matching assistant turn', () => {
    const turns: CopilotConversationTurn[] = [
      {
        id: 'run-1:assistant',
        kind: 'assistant',
        title: '助手响应',
        content: '内容',
        status: 'streaming',
      },
    ]

    const updated = cancelAssistantTurn(turns, {
      assistantMessageId: 'run-1:assistant',
      reason: 'cancelled',
      diagnostic: DIAGNOSTIC_NULL,
    })

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      status: 'cancelled',
      title: '已取消',
      content: '内容',
    })
  })

  it('fills in reason when content is empty', () => {
    const turns: CopilotConversationTurn[] = [
      {
        id: 'run-1:assistant',
        kind: 'assistant',
        title: '',
        content: '',
        status: 'streaming',
      },
    ]

    const updated = cancelAssistantTurn(turns, {
      assistantMessageId: 'run-1:assistant',
      reason: 'cancelled',
      diagnostic: DIAGNOSTIC_NULL,
    })

    expect(updated[0].content).toBe('本次响应已取消：cancelled')
  })

  it('fills in reason with generic text for empty reason', () => {
    const turns: CopilotConversationTurn[] = [
      {
        id: 'run-1:assistant',
        kind: 'assistant',
        title: '',
        content: '',
        status: 'streaming',
      },
    ]

    const updated = cancelAssistantTurn(turns, {
      assistantMessageId: 'run-1:assistant',
      reason: '   ',
      diagnostic: DIAGNOSTIC_NULL,
    })

    expect(updated[0].content).toBe('本次响应已取消。')
  })

  it('returns turns unchanged when assistantMessageId is null', () => {
    const turns: CopilotConversationTurn[] = [
      createUserTurn('hello'),
    ]

    const updated = cancelAssistantTurn(turns, {
      assistantMessageId: null,
      reason: 'reason',
      diagnostic: DIAGNOSTIC_NULL,
    })

    expect(updated).toBe(turns)
  })
})

describe('createErrorTurn', () => {
  it('creates an error turn', () => {
    const result = createErrorTurn('发送失败')

    expect(result).toMatchObject({
      kind: 'error',
      title: '发送失败',
      content: '发送失败',
      status: 'failed',
      diagnostic: null,
    })
    expect(result.id.startsWith('error:')).toBe(true)
  })

  it('includes diagnostic when provided', () => {
    const diagnostic: CopilotRunDiagnosticSummary = { code: 'err', message: 'msg', stage: 'execute_model', details: {} }
    const result = createErrorTurn('fail', diagnostic)

    expect(result.diagnostic).toBe(diagnostic)
  })
})
