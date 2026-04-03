import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { CopilotMessageList } from './CopilotMessageList'
import { createRuntimeModelRoute } from './chat-contract.test-support'
import { createIdleCopilotRunState } from './run-segment-reducer'
import {
  buildCopilotMessageListItems,
  createUserMessageListItem,
} from './run-segment-view-model'
import type { CopilotRunState } from './types'

describe('CopilotMessageList segment rendering', () => {
  it('renders assistant → tool → assistant in segment order', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'completed',
      runId: 'run-1',
      threadId: 'session-1',
      resolvedModelId: 'qwen-plus',
      resolvedModelRoute: createRuntimeModelRoute(),
      resolvedToolIds: ['tool.weather-current'],
      requestOptions: { trace: true },
      segments: [
        {
          id: 'assistant:run-1:1',
          kind: 'assistant',
          runId: 'run-1',
          assistantMessageId: 'run-1:assistant',
          text: '第一段',
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
          id: 'tool:run-1:tool.weather-current:call-1',
          kind: 'tool',
          runId: 'run-1',
          startedSequence: 2,
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
          lastSequence: 4,
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
    })

    expect(html).toContain('第一段')
    expect(html).toContain('天气工具已返回结果')
    expect(html).toContain('第二段')
    expect(html.indexOf('第一段')).toBeLessThan(html.indexOf('天气工具已返回结果'))
    expect(html.indexOf('天气工具已返回结果')).toBeLessThan(html.indexOf('第二段'))
  })

  it('keeps rendered segments visible when a run fails and adds diagnostic plus terminal markers', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'failed',
      runId: 'run-failed',
      threadId: 'session-1',
      failure: {
        code: 'tool_execution_failed',
        message: 'Tool failed: boom',
        details: {
          toolId: 'tool.weather-current',
        },
      },
      segments: [
        {
          id: 'assistant:run-failed:1',
          kind: 'assistant',
          runId: 'run-failed',
          assistantMessageId: 'run-failed:assistant',
          text: '已生成的第一段',
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
          id: 'tool:run-failed:tool.weather-current:call-1',
          kind: 'tool',
          runId: 'run-failed',
          startedSequence: 2,
          lastSequence: 3,
          status: 'failed',
          toolCallId: 'tool.weather-current:call-1',
          toolId: 'tool.weather-current',
          toolPhase: 'failed',
          title: '工具调用失败',
          summary: '工具执行失败。',
          inputSummary: '{"location":"Shenzhen"}',
          resultSummary: null,
          errorSummary: 'boom',
        },
        {
          id: 'diagnostic:run-failed:4',
          kind: 'diagnostic',
          runId: 'run-failed',
          startedSequence: 4,
          lastSequence: 4,
          status: 'completed',
          diagnostic: {
            code: 'tool_execution_failed',
            message: 'Tool failed: boom',
            stage: 'tool_execution',
            details: {
              toolId: 'tool.weather-current',
            },
          },
        },
        {
          id: 'terminal:run-failed:failed',
          kind: 'terminal',
          runId: 'run-failed',
          startedSequence: 5,
          lastSequence: 5,
          status: 'failed',
          terminalPhase: 'failed',
          assistantMessageId: null,
          cancelReason: null,
          failure: {
            code: 'tool_execution_failed',
            message: 'Tool failed: boom',
            details: {
              toolId: 'tool.weather-current',
            },
          },
          resolvedModelId: null,
          resolvedModelRoute: null,
          resolvedToolIds: [],
          requestOptions: {},
        },
      ],
    })

    expect(html).toContain('已生成的第一段')
    expect(html).toContain('工具调用失败')
    expect(html).toContain('boom')
    expect(html).toContain('运行诊断')
    expect(html).toContain('诊断：tool_execution / tool_execution_failed / Tool failed: boom')
    expect(html).toContain('发送失败')
    expect(html).toContain('tool_execution_failed: Tool failed: boom')
    expect(html.indexOf('已生成的第一段')).toBeLessThan(html.indexOf('发送失败'))
  })

  it('keeps completed segments visible when a run is cancelled and appends a terminal marker', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'cancelled',
      runId: 'run-cancelled',
      threadId: 'session-1',
      cancelReason: 'user_cancelled',
      segments: [
        {
          id: 'assistant:run-cancelled:1',
          kind: 'assistant',
          runId: 'run-cancelled',
          assistantMessageId: 'run-cancelled:assistant',
          text: '已保留的回答前半段',
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
          id: 'tool:run-cancelled:tool.weather-current:call-1',
          kind: 'tool',
          runId: 'run-cancelled',
          startedSequence: 2,
          lastSequence: 2,
          status: 'cancelled',
          toolCallId: 'tool.weather-current:call-1',
          toolId: 'tool.weather-current',
          toolPhase: 'cancelled',
          title: '调用天气工具',
          summary: '正在获取 Shenzhen 的天气。',
          inputSummary: '{"location":"Shenzhen"}',
          resultSummary: null,
          errorSummary: null,
        },
        {
          id: 'terminal:run-cancelled:cancelled',
          kind: 'terminal',
          runId: 'run-cancelled',
          startedSequence: 3,
          lastSequence: 3,
          status: 'cancelled',
          terminalPhase: 'cancelled',
          assistantMessageId: 'run-cancelled:assistant',
          cancelReason: 'user_cancelled',
          failure: null,
          resolvedModelId: null,
          resolvedModelRoute: null,
          resolvedToolIds: [],
          requestOptions: {},
        },
      ],
    })

    expect(html).toContain('已保留的回答前半段')
    expect(html).toContain('调用天气工具')
    expect(html).toContain('已取消')
    expect(html).toContain('本次响应已取消：user_cancelled')
    expect(html.indexOf('已保留的回答前半段')).toBeLessThan(html.indexOf('本次响应已取消：user_cancelled'))
  })
})

function renderConversation(runState: CopilotRunState): string {
  const conversation = buildCopilotMessageListItems({
    history: [createUserMessageListItem('请先查天气再回答')],
    runState,
  })

  return renderToStaticMarkup(
    <CopilotMessageList conversation={conversation} />,
  )
}
