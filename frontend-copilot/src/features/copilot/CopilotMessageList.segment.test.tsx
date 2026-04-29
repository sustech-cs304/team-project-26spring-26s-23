import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { CopilotMessageList } from './CopilotMessageList'
import {
  createCopilotTransientErrorState,
} from './copilot-chat-helpers'
import {
  createRuntimeModelRoute,
  createRuntimeReasoningSuppressionBasis,
  createRuntimeThinkingCapability,
  createRuntimeThinkingSelection,
} from './chat-contract.test-support'
import { createCopilotErrorDetailSource } from './error-detail-overlay-view-model'
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
        id: 'tool:run-streaming:tool.remote-search:call-1',
        kind: 'tool',
        runId: 'run-streaming',
        sequence: 2,
        status: 'completed',
        toolCallId: 'tool.remote-search:call-1',
        toolId: 'tool.remote-search',
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
      resolvedToolIds: ['tool.remote-search'],
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
          id: 'tool:run-1:tool.remote-search:call-1',
          kind: 'tool',
          runId: 'run-1',
          startedSequence: 2,
          lastSequence: 3,
          status: 'completed',
          toolCallId: 'tool.remote-search:call-1',
          toolId: 'tool.remote-search',
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
    })

    expect(html).toContain('第一段')
    expect(html).toContain('天气工具被调用')
    expect(html).toContain('第二段')
    expect(html.indexOf('第一段')).toBeLessThan(html.indexOf('天气工具被调用'))
    expect(html.indexOf('天气工具被调用')).toBeLessThan(html.indexOf('第二段'))
  })

  it('renders skill tool calls as normal tool cards without skill activity chrome or leaked body text', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'completed',
      runId: 'run-skill',
      threadId: 'session-1',
      segments: [
        {
          id: 'diagnostic:run-skill:2',
          kind: 'diagnostic',
          runId: 'run-skill',
          startedSequence: 2,
          lastSequence: 2,
          status: 'completed',
          diagnostic: {
            code: 'skill_index_loaded',
            message: 'Skill index loaded for this run.',
            stage: 'load_skill_index',
            details: {
              snapshotRevision: 8,
            },
          },
        },
        {
          id: 'tool:run-skill:skill.activate:call-1',
          kind: 'tool',
          runId: 'run-skill',
          startedSequence: 3,
          lastSequence: 3,
          status: 'completed',
          toolCallId: 'skill.activate:call-1',
          toolId: 'skill.activate',
          toolPhase: 'completed',
          title: '技能激活已返回结果',
          summary: '{"ok":true,"skillId":"writing-clear-docs","displayName":"清晰文档写作","entryContentLength":120,"resourceCount":1}',
          inputSummary: '{"skill_id":"writing-clear-docs"}',
          resultSummary: '{"ok":true,"skillId":"writing-clear-docs","displayName":"清晰文档写作","entryContentLength":120,"resourceCount":1}',
          errorSummary: null,
        },
        {
          id: 'tool:run-skill:skill.read_resource:call-2',
          kind: 'tool',
          runId: 'run-skill',
          startedSequence: 4,
          lastSequence: 4,
          status: 'failed',
          toolCallId: 'skill.read_resource:call-2',
          toolId: 'skill.read_resource',
          toolPhase: 'failed',
          title: '技能资源读取调用失败',
          summary: '内部 Skill 控制工具调用失败。',
          inputSummary: '{"path":"resources/checklist.md","skill_id":"writing-clear-docs"}',
          resultSummary: null,
          errorSummary: '{"errorCode":"resource_not_found","path":"resources/checklist.md","skillId":"writing-clear-docs","content":"Prefer structure","message":"Skill resource was not found in the enabled skill snapshot resource index."}',
        },
      ],
    })

    expect(html).toContain('技能激活被调用')
    expect(html).toContain('技能资源读取调用失败')
    expect(html).not.toContain('Skill 活动')
    expect(html).not.toContain('技能索引已加载')
    expect(html).not.toContain('Prefer structure')
    expect(html).not.toContain('SKILL.md')
    expect(html).not.toContain('skill activity')
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
          toolId: 'tool.remote-search',
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
          id: 'tool:run-failed:tool.remote-search:call-1',
          kind: 'tool',
          runId: 'run-failed',
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
              toolId: 'tool.remote-search',
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
              toolId: 'tool.remote-search',
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

  it('keeps the safe fallback title when the failed tool card only carries a blank toolId', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'failed',
      runId: 'run-failed-blank-tool-id',
      threadId: 'session-1',
      failure: {
        code: 'tool_execution_failed',
        message: 'Tool failed: boom',
        details: {
          toolId: '   ',
        },
      },
      segments: [
        {
          id: 'tool:run-failed-blank-tool-id:tool-1',
          kind: 'tool',
          runId: 'run-failed-blank-tool-id',
          startedSequence: 1,
          lastSequence: 1,
          status: 'failed',
          toolCallId: 'tool-call-1',
          toolId: '   ',
          toolPhase: 'failed',
          title: '工具调用失败',
          summary: '工具执行失败。',
          inputSummary: '{"location":"Shenzhen"}',
          resultSummary: null,
          errorSummary: 'boom',
        },
      ],
    })

    expect(html).toContain('工具调用失败')
    expect(html).not.toContain('调用失败调用失败')
    expect(html).not.toContain('工具被调用')
  })

  it('renders a detail button for failed tool cards without leaking raw MCP diagnostics into the card body', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'failed',
      runId: 'run-mcp-tool-failed',
      threadId: 'session-1',
      failure: {
        code: 'tool_execution_failed',
        message: 'MCP tool failed: transport disconnected',
        details: {
          toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
          toolCallId: 'tool-call-1',
          serverId: 'mcp-stdio-stub',
          serverName: 'stdio stub server',
          remoteToolName: 'search-campus',
          phase: 'tools/call',
          diagnosticSummary: 'connector ready but remote tool returned error',
          stderrSummary: 'stderr tail',
          snapshotRevision: 12,
          catalogVersion: 12,
        },
      },
      segments: [
        {
          id: 'tool:run-mcp-tool-failed:tool-1',
          kind: 'tool',
          runId: 'run-mcp-tool-failed',
          startedSequence: 1,
          lastSequence: 2,
          status: 'failed',
          toolCallId: 'tool-call-1',
          toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
          toolPhase: 'failed',
          title: '工具调用失败',
          summary: 'search-campus 调用失败。',
          inputSummary: '{"keyword":"calendar"}',
          resultSummary: null,
          errorSummary: 'transport disconnected',
        },
        {
          id: 'terminal:run-mcp-tool-failed:failed',
          kind: 'terminal',
          runId: 'run-mcp-tool-failed',
          startedSequence: 3,
          lastSequence: 3,
          status: 'failed',
          terminalPhase: 'failed',
          assistantMessageId: null,
          cancelReason: null,
          failure: {
            code: 'tool_execution_failed',
            message: 'MCP tool failed: transport disconnected',
            details: {
              toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
              toolCallId: 'tool-call-1',
              serverId: 'mcp-stdio-stub',
              serverName: 'stdio stub server',
              remoteToolName: 'search-campus',
              phase: 'tools/call',
              diagnosticSummary: 'connector ready but remote tool returned error',
              stderrSummary: 'stderr tail',
              snapshotRevision: 12,
              catalogVersion: 12,
            },
          },
          resolvedModelId: null,
          resolvedModelRoute: null,
          resolvedToolIds: [],
          requestOptions: {},
        },
      ],
    })

    expect(html).toContain('chat-message-tool-error-detail-button-1')
    expect(html).not.toContain('connector ready but remote tool returned error')
    expect(html).not.toContain('stderr tail')
  })

  it('renders explicit CAS credential guidance for authentication failures', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'failed',
      runId: 'run-auth-failed',
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
          id: 'assistant:run-auth-failed:1',
          kind: 'assistant',
          runId: 'run-auth-failed',
          assistantMessageId: 'run-auth-failed:assistant',
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
          id: 'terminal:run-auth-failed:failed',
          kind: 'terminal',
          runId: 'run-auth-failed',
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
    })

    expect(html).toContain('发送失败')
    expect(html).toContain('CAS 登录失败：用户名或密码错误，请更新设置中的 CAS 密码。')
    expect(html).not.toContain('工具执行失败，请重试。')
  })

  it('renders a detail button for transient failed cards without leaking raw diagnostics into the card body', () => {
    const html = renderToStaticMarkup(
      <CopilotMessageList
        conversation={[createUserMessageListItem('请检查请求选项')]}
        models={createTestModelCatalog().models}
        transientError={createCopilotTransientErrorState({
          message: '请求选项格式无效，请检查 JSON。',
          errorDetail: createCopilotErrorDetailSource({
            source: 'preflight',
            title: '发送失败',
            summaryMessage: '请求选项格式无效，请检查 JSON。',
            rawMessage: 'Unexpected token } in JSON at position 4',
            code: 'request_options_invalid',
            stage: 'preflight',
            requestedMethod: 'run/start',
            details: {
              requestOptionsText: '{ trace: true }',
            },
          }),
        })}
      />,
    )

    expect(html).toContain('chat-message-error-detail-button-1')
    expect(html).toContain('请求选项格式无效，请检查 JSON。')
    expect(html).not.toContain('Unexpected token } in JSON at position 4')
    expect(html).not.toContain('requestOptionsText')
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
          id: 'tool:run-cancelled:tool.remote-search:call-1',
          kind: 'tool',
          runId: 'run-cancelled',
          startedSequence: 2,
          lastSequence: 2,
          status: 'cancelled',
          toolCallId: 'tool.remote-search:call-1',
          toolId: 'tool.remote-search',
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

  it('renders assistant content as structured markdown with dividers, MathJax formulas, and highlighted code blocks', () => {
    const modelCatalog = createTestModelCatalog()
    const conversation: CopilotMessageListItem[] = [{
      id: 'assistant:run-markdown:1',
      kind: 'assistant',
      runId: 'run-markdown',
      sequence: 1,
      title: '助手响应',
      content: '# 标题\n\n---\n\n- 列表项\n\n**加粗** 与 `代码`\n\n```python\ndef bubble_sort(items):\n    return sorted(items)\n```\n\n行内公式 $E = mc^2$\n\n$$\na^2+b^2=c^2\n$$\n\n| 列 | 值 |\n| --- | --- |\n| A | B |',
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
    expect(html).toContain('<code class="copilot-chat__inline-code">代码</code>')
    expect(html).toContain('copilot-chat__code-block')
    expect(html).toContain('copilot-chat__code-block-language">Python</span>')
    expect(html).toContain('data-code-block-action="copy"')
    expect(html).toContain('data-code-block-action="download"')
    expect(html).toContain('data-code-block-action="wrap"')
    expect(html).toContain('hljs language-python')
    expect(html).toContain('<table>')
    expect(html).toContain('mjx-container')
    expect(html).toContain('jax="SVG"')
    expect(html).not.toContain('**加粗**')
    expect(html).not.toContain('| --- |')
    expect(html).toContain('copilot-chat__message-text--markdown')
  })

  it('renders fenced code blocks without a declared language as block code instead of inline code', () => {
    const modelCatalog = createTestModelCatalog()
    const conversation: CopilotMessageListItem[] = [{
      id: 'assistant:run-markdown-no-language:1',
      kind: 'assistant',
      runId: 'run-markdown-no-language',
      sequence: 1,
      title: '助手响应',
      content: '```\nconst answer = 42\n```',
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

    expect(html).toContain('copilot-chat__code-block')
    expect(html).toContain('copilot-chat__code-block-language">Text</span>')
    expect(html).toContain('<pre class="copilot-chat__code-block-pre"><code class="hljs">const answer = 42\n</code></pre>')
    expect(html).not.toContain('copilot-chat__inline-code">const answer = 42')
  })

  it('renders typst fenced blocks with the local fallback highlighter', () => {
    const modelCatalog = createTestModelCatalog()
    const conversation: CopilotMessageListItem[] = [{
      id: 'assistant:run-markdown-typst:1',
      kind: 'assistant',
      runId: 'run-markdown-typst',
      sequence: 1,
      title: '助手响应',
      content: '```typst\n#set text(size: 12pt)\n= Course Note\n// comment\n```',
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

    expect(html).toContain('copilot-chat__code-block-language">Typst</span>')
    expect(html).toContain('data-language-id="typst"')
    expect(html).toContain('hljs language-typst')
    expect(html).toContain('<span class="hljs-keyword">#set</span>')
    expect(html).toContain('<span class="hljs-number">12pt</span>')
    expect(html).toContain('<span class="hljs-title">= Course Note</span>')
    expect(html).toContain('<span class="hljs-comment">// comment</span>')
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

  it('projects and renders controlled inline form segments inside the chat stream', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'completed',
      runId: 'run-form-1',
      threadId: 'session-1',
      segments: [
        {
          id: 'inline-form:run-form-1:tool.request-user-form:call-1',
          kind: 'inline-form',
          runId: 'run-form-1',
          startedSequence: 2,
          lastSequence: 2,
          status: 'completed',
          toolCallId: 'tool.request-user-form:call-1',
          toolId: 'tool.request-user-form',
          formId: 'course-search-form',
          title: '补充课程查询条件',
          summary: '请填写课程编码与学期。',
          description: '仅用于继续当前对话。',
          submitLabel: '提交表单',
          fields: [
            {
              name: 'courseCode',
              label: '课程编码',
              type: 'text',
              required: true,
            },
            {
              name: 'term',
              label: '学期',
              type: 'select',
              required: true,
              options: [
                { value: '2026-spring', label: '2026 春' },
              ],
            },
          ],
          formState: 'pending',
          formValues: {
            courseCode: '',
            term: '',
          },
          submittedPayload: null,
        },
      ],
    })

    expect(html).toContain('chat-message-inline-form-card-1')
    expect(html).toContain('补充课程查询条件')
    expect(html).toContain('课程编码')
    expect(html).toContain('学期')
    expect(html).toContain('提交表单')
  })

  it('renders submitted inline forms as readonly history entries', () => {
    const html = renderConversation({
      ...createIdleCopilotRunState(),
      phase: 'completed',
      runId: 'run-form-2',
      threadId: 'session-1',
      segments: [
        {
          id: 'inline-form:run-form-2:tool.request-user-form:call-1',
          kind: 'inline-form',
          runId: 'run-form-2',
          startedSequence: 2,
          lastSequence: 2,
          status: 'completed',
          toolCallId: 'tool.request-user-form:call-1',
          toolId: 'tool.request-user-form',
          formId: 'course-search-form',
          title: '补充课程查询条件',
          summary: '请填写课程编码与学期。',
          description: null,
          submitLabel: '提交表单',
          fields: [
            {
              name: 'courseCode',
              label: '课程编码',
              type: 'text',
              required: true,
            },
          ],
          formState: 'submitted',
          formValues: {
            courseCode: 'CS304',
          },
          submittedPayload: {
            type: 'inline_form_submission',
          },
        },
      ],
    })

    expect(html).not.toContain('chat-message-inline-form-readonly-1')
    expect(html).toContain('CS304')
    expect(html).not.toContain('chat-message-inline-form-submit-1')
  })

  it('uses a dedicated assistant markdown divider style instead of the old dotted visual', () => {
    const cssFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './copilot-message-list.css')
    const css = readFileSync(cssFilePath, 'utf8')

    expect(css).toContain('.copilot-chat__markdown-divider')
    expect(css).toContain('border-top: 1px solid')
    expect(css).not.toContain('radial-gradient')
    expect(css).not.toContain('border-style: dotted')
  })

  it('styles assistant code blocks with a theme-aware shell and token colors', () => {
    const cssFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './copilot-message-list.css')
    const css = readFileSync(cssFilePath, 'utf8')

    expect(css).toContain('.copilot-chat__code-block')
    expect(css).toContain('.copilot-chat__code-block-header')
    expect(css).toContain('.copilot-chat__code-block-language')
    expect(css).toContain('.copilot-chat__code-block-actions')
    expect(css).toContain('.copilot-chat__code-block-action')
    expect(css).toContain('.copilot-chat__code-block--nowrap .copilot-chat__code-block-pre code')
    expect(css).toContain('--copilot-code-block-bg:')
    expect(css).toContain('--copilot-code-text: #253044;')
    expect(css).toContain(":root[data-theme='dark'] .copilot-chat")
    expect(css).toContain('--copilot-code-text: #e2e8f0;')
    expect(css).toContain('.copilot-chat__code-block-pre .hljs-keyword')
    expect(css).toContain('color: var(--copilot-code-keyword);')
    expect(css).toContain('white-space: pre-wrap;')
    expect(css).toContain('white-space: pre;')
    expect(css).toContain('.copilot-chat__inline-code')
  })

  it('uses pre-wrap semantics for multiline user messages', () => {
    const cssFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './copilot-message-list.css')
    const css = readFileSync(cssFilePath, 'utf8')

    expect(css).toContain('.copilot-chat__message-text--plain')
    expect(css).toContain('white-space: pre-wrap;')
  })
  it('renders approval action buttons without the legacy waiting callout', () => {
    const html = renderConversation({
      phase: 'streaming',
      runId: 'run-1',
      threadId: 'session-1',
      activeModelRoute: null,
      resolvedModelId: null,
      resolvedModelRoute: null,
      resolvedToolIds: [],
      requestOptions: {},
      requestedThinkingSelection: null,
      appliedThinkingSelection: null,
      requestedThinkingLevel: null,
      appliedThinkingLevel: null,
      thinkingCapabilitySnapshot: null,
      thinkingSeriesDecision: null,
      reasoningSuppressionBasis: null,
      reasoningSuppressed: false,
      reasoningTraceState: 'not_observed',
      diagnostic: null,
      failure: null,
      cancelReason: null,
      segments: [{
        id: 'tool:run-1:tool.remote-search:call-1',
        kind: 'tool',
        runId: 'run-1',
        startedSequence: 2,
        lastSequence: 2,
        status: 'streaming',
        toolCallId: 'tool.remote-search:call-1',
        toolId: 'tool.remote-search',
        toolPhase: 'waiting_approval',
        title: '等待批准',
        summary: '需要批准后继续。',
        inputSummary: '{"location":"Shenzhen"}',
        resultSummary: null,
        errorSummary: null,
        approval: {
          mode: 'delay',
          approvalMethod: 'accept_reject',
          riskLevel: 'high',
          timeoutAt: '2026-04-17T16:00:30Z',
          timeoutSeconds: 30,
          timeoutAction: 'deny',
        },
      }],
    })

    expect(html).toContain('拒绝（0s）')
    expect(html).toContain('批准')
    expect(html).not.toContain('等待批准')
    expect(html).not.toContain('后自动拒绝')
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
