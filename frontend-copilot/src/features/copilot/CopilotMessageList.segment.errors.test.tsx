/** @vitest-environment jsdom */

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

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const DESC_CN_008 = 'Shenzhen：晴 / 24°C / 湿度 60%'
const LABEL_HTTPS_API_EXAMPLE = 'https://api.example.com/v1'
const LABEL_LOCATION_SHENZHEN = '{"location":"Shenzhen"}'
const LABEL_OPENAI_COMPATIBLE = 'openai-compatible'
const LABEL_OPENAI_GPT = 'openai/gpt-4.1'
const LABEL_PROVIDER_OPENAI = 'provider-openai'
const LABEL_RUN_CANCELLED = 'run-cancelled'
const LABEL_RUN_FAILED = 'run-failed'
const LABEL_RUN_REASONING = 'run-reasoning'
const LABEL_TOOL_CALL = 'tool-call-1'
const LABEL_TOOL_FAILED_BOOM = 'Tool failed: boom'
const LABEL_TOOL_REMOTE_SEARCH = 'tool.remote-search'
const LABEL_TOOL_REMOTE_SEARCH_2 = 'tool.remote-search:call-1'


/* eslint-disable-next-line max-lines-per-function */
describe('CopilotMessageList segment errors', () => {
  // 已拆分为 2 个子 describe（run failure visibility / failed tool cards），父级仅做语义分组
  /* eslint-disable-next-line max-lines-per-function */
  describe('failed run rendering', () => {
    describe('run failure visibility', () => {
    it('keeps rendered segments visible when a run fails and shows a simplified terminal message', () => {
      const html = renderConversation({
        ...createIdleCopilotRunState(),
        phase: 'failed',
        runId: LABEL_RUN_FAILED,
        threadId: 'session-1',
        failure: {
          code: 'tool_execution_failed',
          message: LABEL_TOOL_FAILED_BOOM,
          details: {
            toolId: LABEL_TOOL_REMOTE_SEARCH,
          },
        },
        segments: [
          {
            id: 'assistant:run-failed:1',
            kind: 'assistant',
            runId: LABEL_RUN_FAILED,
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
            runId: LABEL_RUN_FAILED,
            startedSequence: 2,
            lastSequence: 3,
            status: 'failed',
            toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
            toolId: LABEL_TOOL_REMOTE_SEARCH,
            toolPhase: 'failed',
            title: '工具调用失败',
            summary: '工具执行失败。',
            inputSummary: LABEL_LOCATION_SHENZHEN,
            resultSummary: null,
            errorSummary: 'boom',
          },
          {
            id: 'diagnostic:run-failed:4',
            kind: 'diagnostic',
            runId: LABEL_RUN_FAILED,
            startedSequence: 4,
            lastSequence: 4,
            status: 'completed',
            diagnostic: {
              code: 'tool_execution_failed',
              message: LABEL_TOOL_FAILED_BOOM,
              stage: 'tool_execution',
              details: {
                toolId: LABEL_TOOL_REMOTE_SEARCH,
              },
            },
          },
          {
            id: 'terminal:run-failed:failed',
            kind: 'terminal',
            runId: LABEL_RUN_FAILED,
            startedSequence: 5,
            lastSequence: 5,
            status: 'failed',
            terminalPhase: 'failed',
            assistantMessageId: null,
            cancelReason: null,
            failure: {
              code: 'tool_execution_failed',
              message: LABEL_TOOL_FAILED_BOOM,
              details: {
                toolId: LABEL_TOOL_REMOTE_SEARCH,
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
    })

    describe('failed tool cards', () => {
    it('keeps the safe fallback title when the failed tool card only carries a blank toolId', () => {
      const html = renderConversation({
        ...createIdleCopilotRunState(),
        phase: 'failed',
        runId: 'run-failed-blank-tool-id',
        threadId: 'session-1',
        failure: {
          code: 'tool_execution_failed',
          message: LABEL_TOOL_FAILED_BOOM,
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
            toolCallId: LABEL_TOOL_CALL,
            toolId: '   ',
            toolPhase: 'failed',
            title: '工具调用失败',
            summary: '工具执行失败。',
            inputSummary: LABEL_LOCATION_SHENZHEN,
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
            toolCallId: LABEL_TOOL_CALL,
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
            toolCallId: LABEL_TOOL_CALL,
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
                toolCallId: LABEL_TOOL_CALL,
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
  })
  })

  // 已拆分为 2 个子 describe（authentication failures / transient errors），父级仅做语义分组
  /* eslint-disable-next-line max-lines-per-function */
  describe('authentication and transient errors', () => {
    describe('authentication failures', () => {
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
    })

    describe('transient errors and diagnostics', () => {
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
  })
  })

  // 已拆分为 2 个子 describe（cancelled runs / reasoning content），父级仅做语义分组
  /* eslint-disable-next-line max-lines-per-function */
  describe('cancelled and reasoning display', () => {
    describe('cancelled runs', () => {
    it('keeps completed segments visible when a run is cancelled and appends a terminal marker', () => {
      const html = renderConversation({
        ...createIdleCopilotRunState(),
        phase: 'cancelled',
        runId: LABEL_RUN_CANCELLED,
        threadId: 'session-1',
        cancelReason: 'user_cancelled',
        segments: [
          {
            id: 'assistant:run-cancelled:1',
            kind: 'assistant',
            runId: LABEL_RUN_CANCELLED,
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
            runId: LABEL_RUN_CANCELLED,
            startedSequence: 2,
            lastSequence: 2,
            status: 'cancelled',
            toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
            toolId: LABEL_TOOL_REMOTE_SEARCH,
            toolPhase: 'cancelled',
            title: '调用天气工具',
            summary: '正在获取 Shenzhen 的天气。',
            inputSummary: LABEL_LOCATION_SHENZHEN,
            resultSummary: null,
            errorSummary: null,
          },
          {
            id: 'terminal:run-cancelled:cancelled',
            kind: 'terminal',
            runId: LABEL_RUN_CANCELLED,
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
    })

    describe('reasoning content display', () => {
    it('renders reasoning content as a dedicated collapsed card without merging it into assistant text', () => {
      const html = renderConversation({
        ...createIdleCopilotRunState(),
        phase: 'completed',
        runId: LABEL_RUN_REASONING,
        threadId: 'session-1',
        resolvedModelId: 'qwen-plus',
        resolvedModelRoute: createRuntimeModelRoute(),
        resolvedToolIds: [],
        requestOptions: {},
        segments: [
          {
            id: 'reasoning:run-reasoning:1',
            kind: 'reasoning',
            runId: LABEL_RUN_REASONING,
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
            runId: LABEL_RUN_REASONING,
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
            runId: LABEL_RUN_REASONING,
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
  })
  })

  describe('streaming reasoning', () => {
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
  })
})

function createTestModelCatalog() {
  return createCopilotModelCatalog([
    createProviderProfile({
      id: LABEL_PROVIDER_OPENAI,
      name: 'OpenAI Compatible',
      availableModels: [
        {
          id: 'provider-openai:openai/gpt-4.1',
          modelId: LABEL_OPENAI_GPT,
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