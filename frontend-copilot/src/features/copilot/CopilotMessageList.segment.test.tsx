import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { CopilotMessageList } from './CopilotMessageList'
import {
  createRuntimeModelRoute,
  createRuntimeReasoningSuppressionBasis,
  createRuntimeThinkingCapability,
  createRuntimeThinkingSelection,
} from './chat-contract.test-support'
import { createIdleCopilotRunState } from './run-segment-reducer'
import { createCopilotModelCatalog } from './model-picker'
import {
  buildCopilotMessageListItems,
  createUserMessageListItem,
  type CopilotMessageListItem,
} from './run-segment-view-model'
import type { CopilotRunState } from './types'
import { createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'

describe('CopilotMessageList segment rendering', () => {
  it('renders assistant headers with catalog icon and model name instead of the fixed assistant label', () => {
    const modelCatalog = createTestModelCatalog()
    const conversation: CopilotMessageListItem[] = [
      {
        id: 'assistant:run-streaming:1',
        kind: 'assistant',
        runId: 'run-streaming',
        sequence: 1,
        title: '助手响应',
        content: '正在生成内容',
        status: 'streaming',
        resolvedModelId: 'openai/gpt-4.1',
        resolvedModelRoute: createRuntimeModelRoute({
          providerProfileId: 'provider-openai',
          snapshot: {
            provider: 'openai',
            endpointType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            modelId: 'openai/gpt-4.1',
          },
        }),
        resolvedToolIds: [],
        requestOptions: {},
      },
      {
        id: 'tool:run-streaming:tool.weather-current:call-1',
        kind: 'tool',
        runId: 'run-streaming',
        sequence: 2,
        status: 'completed',
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
        toolPhase: 'completed',
        title: '天气工具已返回结果',
        content: 'Shenzhen：晴 / 24°C / 湿度 60%',
        inputSummary: null,
        resultSummary: null,
        errorSummary: null,
      },
    ]

    const html = renderToStaticMarkup(
      <CopilotMessageList conversation={conversation} models={modelCatalog.models} />,
    )

    expect(html).not.toContain('助手响应')
    expect(html).toContain('GPT 4.1')
    expect(html).toContain('chat-message-assistant-icon-0')
    expect(html).toContain('GPT 4.1 图标')
    expect(html).toContain('正在生成内容')
    expect(html).toContain('天气工具被调用')
    expect(html).not.toContain('天气工具已返回结果')
    expect(html).not.toContain('Shenzhen：晴 / 24°C / 湿度 60%')
    expect(html).toContain('chat-message-tool-toggle-1')
    expect(html).not.toContain('chat-message-tool-panel-1')
    expect(html).toContain('copilot-chat__message--streaming')
    expect(html).toContain('copilot-chat__message--completed')
    expect(html).not.toContain('流式输出中')
    expect(html).not.toContain('已完成')
  })

  it('falls back to resolved model id when the catalog entry no longer exists', () => {
    const conversation: CopilotMessageListItem[] = [{
      id: 'assistant:run-fallback:1',
      kind: 'assistant',
      runId: 'run-fallback',
      sequence: 1,
      title: '助手响应',
      content: '模型目录已经变更。',
      status: 'completed',
      resolvedModelId: 'legacy/retired-model',
      resolvedModelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-legacy',
        snapshot: {
          provider: 'openai',
          endpointType: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          modelId: 'legacy/retired-model',
        },
      }),
      resolvedToolIds: [],
      requestOptions: {},
    }]

    const html = renderToStaticMarkup(
      <CopilotMessageList conversation={conversation} models={createTestModelCatalog().models} />,
    )

    expect(html).not.toContain('助手响应')
    expect(html).toContain('legacy/retired-model')
    expect(html).toContain('legacy/retired-model 图标')
  })

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
    expect(html).toContain('天气工具被调用')
    expect(html).toContain('第二段')
    expect(html.indexOf('第一段')).toBeLessThan(html.indexOf('天气工具被调用'))
    expect(html.indexOf('天气工具被调用')).toBeLessThan(html.indexOf('第二段'))
  })

  it('keeps rendered segments visible when a run fails and shows a simplified terminal message', () => {
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
    expect(html).not.toContain('boom')
    expect(html).not.toContain('运行诊断')
    expect(html).not.toContain('诊断：tool_execution / tool_execution_failed / Tool failed: boom')
    expect(html).toContain('发送失败')
    expect(html).toContain('工具执行失败，请重试。')
    expect(html.indexOf('已生成的第一段')).toBeLessThan(html.indexOf('发送失败'))
  })

  it('does not render removed thinking metadata detail rows in diagnostic mode', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'failed',
      runId: 'run-thinking-details',
      threadId: 'session-1',
      requestedThinkingSelection: createRuntimeThinkingSelection({
        series: 'compat-discrete-levels-v1',
        level: 'medium',
      }),
      appliedThinkingSelection: createRuntimeThinkingSelection({
        series: 'compat-discrete-levels-v1',
        level: 'auto',
      }),
      requestedThinkingLevel: 'medium',
      appliedThinkingLevel: 'auto',
      thinkingCapabilitySnapshot: createRuntimeThinkingCapability({
        status: 'unknown-with-override',
        source: 'override',
        supportedLevels: ['off', 'auto', 'medium'],
        defaultLevel: 'auto',
        reasonCode: 'override_candidate_levels_applied',
        providerHint: 'unknown-route-override',
        overrideLevels: ['off', 'auto', 'medium'],
      }),
      segments: [
        {
          id: 'assistant:run-thinking-details:1',
          kind: 'assistant',
          runId: 'run-thinking-details',
          assistantMessageId: 'run-thinking-details:assistant',
          text: '这是一条回答。',
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
          id: 'terminal:run-thinking-details:failed',
          kind: 'terminal',
          runId: 'run-thinking-details',
          startedSequence: 2,
          lastSequence: 2,
          status: 'failed',
          terminalPhase: 'failed',
          assistantMessageId: 'run-thinking-details:assistant',
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
    })

    expect(html).not.toContain('请求系列值')
    expect(html).not.toContain('应用系列值')
    expect(html).not.toContain('能力来源')
    expect(html).not.toContain('原因码')
    expect(html).not.toContain('Provider Hint')
    expect(html).not.toContain('思考轨迹')
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
    expect(html).toContain('天气工具已取消')
    expect(html).toContain('已取消')
    expect(html).toContain('本次响应已取消：user_cancelled')
    expect(html.indexOf('已保留的回答前半段')).toBeLessThan(html.indexOf('本次响应已取消：user_cancelled'))
  })

  it('renders reasoning content as a dedicated collapsed card without merging it into assistant text', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'completed',
      runId: 'run-reasoning',
      threadId: 'session-1',
      resolvedModelId: 'qwen-plus',
      resolvedModelRoute: createRuntimeModelRoute(),
      resolvedToolIds: [],
      requestOptions: {},
      segments: [
        {
          id: 'reasoning:run-reasoning:1',
          kind: 'reasoning',
          runId: 'run-reasoning',
          startedSequence: 1,
          lastSequence: 1,
          status: 'completed',
          text: '先分析用户问题，再整理答案。',
          observedStartedAt: 1_000,
          observedFinishedAt: 3_279,
          isCollapsedByDefault: true,
        },
        {
          id: 'assistant:run-reasoning:2',
          kind: 'assistant',
          runId: 'run-reasoning',
          assistantMessageId: 'run-reasoning:assistant',
          text: '最终答复。',
          firstContentSequence: 2,
          startedSequence: 2,
          lastSequence: 2,
          status: 'completed',
          resolvedModelId: 'qwen-plus',
          resolvedModelRoute: createRuntimeModelRoute(),
          resolvedToolIds: [],
          requestOptions: {},
        },
        {
          id: 'terminal:run-reasoning:completed',
          kind: 'terminal',
          runId: 'run-reasoning',
          startedSequence: 3,
          lastSequence: 3,
          status: 'completed',
          terminalPhase: 'completed',
          assistantMessageId: 'run-reasoning:assistant',
          cancelReason: null,
          failure: null,
          resolvedModelId: 'qwen-plus',
          resolvedModelRoute: createRuntimeModelRoute(),
          resolvedToolIds: [],
          requestOptions: {},
        },
      ],
    })

    expect(html).toContain('chat-message-reasoning-card-1')
    expect(html).toContain('chat-message-reasoning-toggle-1')
    expect(html).toContain('思考 2.2s')
    expect(html).not.toContain('chat-message-reasoning-panel-1')
    expect(html).toContain('最终答复。')
    expect(html.indexOf('思考')).toBeLessThan(html.indexOf('最终答复。'))
    expect(html).not.toContain('copilot-chat__message-text--markdown">先分析用户问题，再整理答案。')
  })

  it('suppresses reasoning cards when run state marks the trace as hidden for this run', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'completed',
      runId: 'run-hidden-reasoning',
      threadId: 'session-1',
      requestedThinkingLevel: 'auto',
      appliedThinkingLevel: 'auto',
      reasoningSuppressed: true,
      reasoningTraceState: 'suppressed',
      reasoningSuppressionBasis: createRuntimeReasoningSuppressionBasis({
        shouldSuppress: true,
        source: 'capability-visibility',
        reasonCode: 'capability_visibility_suppressed',
        appliedThinkingLevel: 'auto',
        reasoningVisibility: 'suppressed',
      }),
      segments: [
        {
          id: 'reasoning:run-hidden-reasoning:1',
          kind: 'reasoning',
          runId: 'run-hidden-reasoning',
          startedSequence: 1,
          lastSequence: 1,
          status: 'completed',
          text: '这段推理内容不应显示。',
          observedStartedAt: 1_000,
          observedFinishedAt: 1_500,
          isCollapsedByDefault: true,
        },
        {
          id: 'assistant:run-hidden-reasoning:2',
          kind: 'assistant',
          runId: 'run-hidden-reasoning',
          assistantMessageId: 'run-hidden-reasoning:assistant',
          text: '最终答复仍应显示。',
          firstContentSequence: 2,
          startedSequence: 2,
          lastSequence: 2,
          status: 'completed',
          resolvedModelId: 'qwen-plus',
          resolvedModelRoute: createRuntimeModelRoute(),
          resolvedToolIds: [],
          requestOptions: {},
        },
      ],
    })

    expect(html).not.toContain('chat-message-reasoning-card-1')
    expect(html).not.toContain('这段推理内容不应显示。')
    expect(html).toContain('最终答复仍应显示。')
    expect(html).not.toContain('思考轨迹')
    expect(html).not.toContain('抑制依据')
    expect(html).not.toContain('capability_visibility_suppressed')
  })

  it('shows the reasoning streaming status only on the dedicated reasoning card', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'streaming',
      runId: 'run-reasoning-streaming',
      threadId: 'session-1',
      segments: [
        {
          id: 'reasoning:run-reasoning-streaming:1',
          kind: 'reasoning',
          runId: 'run-reasoning-streaming',
          startedSequence: 1,
          lastSequence: 1,
          status: 'streaming',
          text: '正在推理中。',
          observedStartedAt: 1_000,
          observedFinishedAt: null,
          isCollapsedByDefault: true,
        },
      ],
    })

    expect(html).toContain('chat-message-reasoning-card-1')
    expect(html).toContain('chat-message-reasoning-status-1')
    expect(html).toContain('生成中')
    expect(html).not.toContain('chat-message-assistant-icon-1')
  })

  it('renders assistant content as structured markdown with dividers and MathJax formulas', () => {
    const modelCatalog = createTestModelCatalog()
    const conversation: CopilotMessageListItem[] = [{
      id: 'assistant:run-markdown:1',
      kind: 'assistant',
      runId: 'run-markdown',
      sequence: 1,
      title: '助手响应',
      content: '# 标题\n\n---\n\n- 列表项\n\n**加粗** 与 `代码`\n\n行内公式 $E = mc^2$\n\n$$\na^2+b^2=c^2\n$$\n\n| 列 | 值 |\n| --- | --- |\n| A | B |',
      status: 'completed',
      resolvedModelId: 'openai/gpt-4.1',
      resolvedModelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openai',
        snapshot: {
          provider: 'openai',
          endpointType: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          modelId: 'openai/gpt-4.1',
        },
      }),
      resolvedToolIds: [],
      requestOptions: {},
    }]

    const html = renderToStaticMarkup(
      <CopilotMessageList conversation={conversation} models={modelCatalog.models} />,
    )

    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<hr')
    expect(html).toContain('copilot-chat__markdown-divider')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>列表项</li>')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<code>代码</code>')
    expect(html).toContain('<table>')
    expect(html).toContain('mjx-container')
    expect(html).toContain('jax="SVG"')
    expect(html).not.toContain('**加粗**')
    expect(html).not.toContain('| --- |')
    expect(html).toContain('copilot-chat__message-text--markdown')
  })

  it('keeps user content as plain text and does not render markdown syntax as html', () => {
    const html = renderToStaticMarkup(
      <CopilotMessageList
        conversation={[createUserMessageListItem('**用户原文**\n第二行')]}
        models={createTestModelCatalog().models}
      />,
    )

    expect(html).toContain(`**用户原文**
第二行`)
    expect(html).toContain('copilot-chat__message-text--plain')
    expect(html).not.toContain('<strong>用户原文</strong>')
    expect(html).not.toContain('<br/>')
  })

  it('uses a dedicated assistant markdown divider style instead of the old dotted visual', () => {
    const cssFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './copilot-message-list.css')
    const css = readFileSync(cssFilePath, 'utf8')

    expect(css).toContain('.copilot-chat__markdown-divider')
    expect(css).toContain('border-top: 1px solid')
    expect(css).not.toContain('radial-gradient')
    expect(css).not.toContain('border-style: dotted')
  })

  it('uses pre-wrap semantics for multiline user messages', () => {
    const cssFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './copilot-message-list.css')
    const css = readFileSync(cssFilePath, 'utf8')

    expect(css).toContain('.copilot-chat__message-text--plain')
    expect(css).toContain('white-space: pre-wrap;')
  })
})

function createTestModelCatalog() {
  return createCopilotModelCatalog([
    createProviderProfile({
      id: 'provider-openai',
      name: 'OpenAI Compatible',
      availableModels: [
        {
          id: 'provider-openai:openai/gpt-4.1',
          modelId: 'openai/gpt-4.1',
          displayName: 'GPT 4.1',
          groupName: 'OpenAI',
          capabilities: ['reasoning', 'tools'],
          supportsStreaming: true,
          currency: 'usd',
          inputPrice: '1',
          outputPrice: '2',
        },
      ],
    }),
  ])
}

function renderConversation(runState: CopilotRunState): string {
  const conversation = buildCopilotMessageListItems({
    history: [createUserMessageListItem('请先查天气再回答')],
    runState,
  })

  return renderToStaticMarkup(
    <CopilotMessageList conversation={conversation} models={createTestModelCatalog().models} />,
  )
}
