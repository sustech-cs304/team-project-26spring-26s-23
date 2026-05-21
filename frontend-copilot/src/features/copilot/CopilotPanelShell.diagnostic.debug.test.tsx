/** @vitest-environment jsdom */

import { act, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import { CopilotPanelShell } from './CopilotPanelShell'
import {
  createEmptyComposerDraft,
  type CopilotChatComposerDraft,
} from './copilot-chat-helpers'
import { createCopilotErrorDetailSource } from './error-detail-overlay-view-model'
import type { CopilotModelGroup } from './model-picker'
import type { CopilotMessageListItem } from './run-segment-view-model'
import {
  clickElement,
  createDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
  renderWithRoot,
} from './CopilotChatPanel.test-support'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const DESC_CN_004 = '工具执行失败，请重试。'
const LABEL_ERROR_DETAIL_OVERLAY = 'error-detail-overlay'
const LABEL_HISTORY_SHELL = 'history-shell'
const LABEL_OPENAI_GPT = 'openai/gpt-4.1'
const LABEL_PROVIDER_OPENAI = 'provider-openai'
const LABEL_TOOL_FAILED_BOOM = 'Tool failed: boom'
const LABEL_TOOL_REMOTE_SEARCH = 'tool.remote-search'
const SELECTOR_CHAT_HISTORY_LOADING = 'chat-history-loading-skeleton'
const SELECTOR_CHAT_MESSAGE_SCROLL = 'chat-message-scroll-region'


afterEach(() => {
  vi.useRealTimers()
})

// 顶层集成测试 describe，包含 5+ 子 describe，覆盖 diagnostic 面板全场景，无法安全拆分
/* eslint-disable-next-line max-lines-per-function */
describe('CopilotPanelShell diagnostic debug', () => {
  describe('debug mode and error overlay', () => {
    it('hides runtime diagnostic cards when debug mode is disabled while keeping other content visible', () => {
      const html = renderShell(false)

      expect(html).toContain('已生成的回答')
      expect(html).toContain('发送失败')
      expect(html).toContain(DESC_CN_004)
      expect(html).not.toContain('运行诊断')
      expect(html).not.toContain('诊断：tool_execution / tool_execution_failed / Tool failed: boom')
    })

    it('shows runtime diagnostic cards when debug mode is enabled', () => {
      const html = renderShell(true)

      expect(html).toContain('已生成的回答')
      expect(html).not.toContain('运行诊断')
      expect(html).not.toContain('诊断：tool_execution / tool_execution_failed / Tool failed: boom')
      expect(html).toContain('发送失败')
    })

    it('opens the shared error detail overlay from failed cards', async () => {
      const rendered = renderInteractiveShell(false)

      expect(rendered.container.textContent).not.toContain(LABEL_TOOL_FAILED_BOOM)

      await clickElement(rendered.getByTestId('chat-message-error-detail-button-2'))

      expect(rendered.getByTestId(LABEL_ERROR_DETAIL_OVERLAY).textContent).toContain(DESC_CN_004)
      expect(rendered.getByTestId(LABEL_ERROR_DETAIL_OVERLAY).textContent).toContain(LABEL_TOOL_FAILED_BOOM)
      expect(rendered.getByTestId('error-detail-overlay-group-summary').textContent).toContain('摘要')

      await clickElement(rendered.getByTestId('error-detail-overlay-close'))

      expect(rendered.queryByTestId(LABEL_ERROR_DETAIL_OVERLAY)).toBeNull()

      rendered.unmount()
    })

    it('opens MCP technical details from the failed tool card entry point', async () => {
      const rendered = renderInteractiveShell(false)

      await clickElement(rendered.getByTestId('chat-message-tool-error-detail-button-1'))

      const overlay = rendered.getByTestId(LABEL_ERROR_DETAIL_OVERLAY)
      expect(overlay.textContent).toContain('工具名称')
      expect(overlay.textContent).toContain('search-campus')
      expect(overlay.textContent).toContain('toolId')
      expect(overlay.textContent).toContain('serverId')
      expect(overlay.textContent).toContain('mcp-stdio-stub')
      expect(overlay.textContent).toContain('调用阶段')
      expect(overlay.textContent).toContain('tools/call')
      expect(overlay.textContent).toContain('诊断摘要')
      expect(overlay.textContent).toContain('stderr 摘要')
      expect(overlay.textContent).toContain('快照版本')

      rendered.unmount()
    })
    it('shows replay failure feedback for the selected run and keeps retry available', async () => {
      const onRetrySessionHistory = vi.fn()
      const rendered = renderWithRoot(
        <CopilotPanelShell
          state={createReadyState()}
          retrying={false}
          onRetry={vi.fn()}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell({
            capabilities: {
              capabilitiesVersion: LABEL_HISTORY_SHELL,
            },
          })}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          sessionHistory={createPersistedSessionHistoryState({
            hasLoadedDetail: true,
            detailStatus: 'ready',
            timelineItems: [
              {
                kind: 'assistant_message',
                runId: 'run-1',
                sequenceStart: 1,
                text: '时间线兜底内容',
              },
            ],
            selectedRunId: 'run-1',
            replayStatus: 'error',
            replayError: 'replay unavailable',
          })}
          onRetrySessionHistory={onRetrySessionHistory}
          sendError={null}
          modelGroups={[]}
          thinkingCapability={null}
          composerDraft={createEmptyComposerDraft()}
          onComposerDraftChange={vi.fn()}
          onSend={vi.fn()}
          onCancelCurrentRun={vi.fn()}
          sendStatus="idle"
          canCancelSend={false}
          sendDisabledReason={null}
          composerLockedReason={null}
          persistedSelectedRunConversationSource="timeline"
          historyDrift={null}
          historyRebindAcknowledged={false}
          onAcknowledgeHistoryRebind={vi.fn()}
          conversation={[
            {
              id: 'assistant:history-fallback',
              kind: 'assistant',
              title: '历史回答',
              content: '时间线兜底内容',
              status: 'completed',
              runId: 'run-1',
              sequence: 1,
              resolvedModelId: null,
              resolvedModelRoute: null,
              resolvedToolIds: [],
              requestOptions: {},
            },
          ]}
          assistantPlaceholder={{
            shouldRender: false,
            dismissReason: 'inactive',
          }}
          composerInputRef={createRef<HTMLTextAreaElement>()}
          composerHeight={160}
          onComposerResizeStart={vi.fn()}
        />,
      )

      expect(rendered.getByTestId('chat-history-replay-error').textContent).toContain('当前运行回放失败，当前展示的是时间线快照。')

      await clickElement(rendered.getByTestId('chat-history-replay-retry-button'))

      expect(onRetrySessionHistory).toHaveBeenCalledOnce()

      rendered.unmount()
    })
  })

  describe('capability hydration', () => {
    it('shows capability hydration failure for restored threads and exposes retry', async () => {
      const onRetrySessionHistory = vi.fn()
      const rendered = renderWithRoot(
        <CopilotPanelShell
          state={createReadyState()}
          retrying={false}
          onRetry={vi.fn()}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell({
            capabilities: {
              capabilitiesVersion: LABEL_HISTORY_SHELL,
            },
          })}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          sessionHistory={createPersistedSessionHistoryState({
            hasLoadedDetail: true,
            detailStatus: 'ready',
            capabilitiesStatus: 'error',
            capabilitiesError: 'capabilities unavailable',
          })}
          onRetrySessionHistory={onRetrySessionHistory}
          sendError={null}
          modelGroups={[]}
          thinkingCapability={null}
          composerDraft={createEmptyComposerDraft()}
          onComposerDraftChange={vi.fn()}
          onSend={vi.fn()}
          onCancelCurrentRun={vi.fn()}
          sendStatus="idle"
          canCancelSend={false}
          sendDisabledReason="历史线程能力恢复失败，请重试后再发送。"
          composerLockedReason={null}
          historyDrift={null}
          historyRebindAcknowledged={false}
          onAcknowledgeHistoryRebind={vi.fn()}
          conversation={[]}
          assistantPlaceholder={{
            shouldRender: false,
            dismissReason: 'inactive',
          }}
          composerInputRef={createRef<HTMLTextAreaElement>()}
          composerHeight={160}
          onComposerResizeStart={vi.fn()}
        />,
      )

      expect(rendered.getByTestId('chat-history-capabilities-error').textContent).toContain('历史线程能力恢复失败，请重试后再继续发送。')

      await clickElement(rendered.getByTestId('chat-history-capabilities-retry-button'))

      expect(onRetrySessionHistory).toHaveBeenCalledOnce()

      rendered.unmount()
    })
  })
})

function queryActiveByTestId(container: HTMLElement, testId: string): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`))
  return candidates.find((candidate) => candidate.closest('.cross-fade__stage--exiting') === null) ?? null
}

function readActiveTextContent(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.cross-fade__stage--exiting').forEach((element) => element.remove())
  return clone.textContent ?? ''
}

function renderShell(debugModeEnabled: boolean): string {
  const conversation: CopilotMessageListItem[] = [
    {
      id: 'assistant:run-1:1',
      kind: 'assistant',
      runId: 'run-1',
      sequence: 1,
      title: '助手响应',
      content: '已生成的回答',
      status: 'completed',
      resolvedModelId: null,
      resolvedModelRoute: null,
      resolvedToolIds: [],
      requestOptions: {},
    },
    {
      id: 'diagnostic:run-1:2',
      kind: 'diagnostic',
      runId: 'run-1',
      sequence: 2,
      title: '运行诊断',
      content: LABEL_TOOL_FAILED_BOOM,
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
      id: 'terminal:run-1:failed',
      kind: 'terminal',
      runId: 'run-1',
      sequence: 3,
      title: '发送失败',
      content: DESC_CN_004,
      status: 'failed',
      terminalPhase: 'failed',
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
      errorDetail: createCopilotErrorDetailSource({
        source: 'streaming',
        title: '发送失败',
        summaryMessage: DESC_CN_004,
        rawMessage: LABEL_TOOL_FAILED_BOOM,
        code: 'tool_execution_failed',
        stage: 'streaming',
        requestedMethod: 'run/stream',
        details: {
          toolId: LABEL_TOOL_REMOTE_SEARCH,
        },
      }),
    },
  ]

  return renderToStaticMarkup(
    <CopilotPanelShell
      state={createReadyState({
        bootstrapFields: {
          runtimeUrl: 'http://127.0.0.1:8765',
          agentName: null,
          debugModeEnabled,
        },
      })}
      retrying={false}
      onRetry={vi.fn()}
      selectedAgent={createSelectedAgent()}
      sessionShell={createSessionShell()}
      directoryState={createDirectoryState()}
      sessionStatus="idle"
      sessionError={null}
      sendError={null}
      modelGroups={[]}
      thinkingCapability={null}
      composerDraft={createEmptyComposerDraft()}
      onComposerDraftChange={vi.fn()}
      onSend={vi.fn()}
      onCancelCurrentRun={vi.fn()}
      sendStatus="idle"
      canCancelSend={false}
      sendDisabledReason={null}
      composerLockedReason={null}
      historyDrift={null}
      historyRebindAcknowledged={false}
      onAcknowledgeHistoryRebind={vi.fn()}
      conversation={conversation}
      assistantPlaceholder={{
        shouldRender: false,
        dismissReason: 'inactive',
      }}
      composerInputRef={createRef<HTMLTextAreaElement>()}
      composerHeight={160}
      onComposerResizeStart={vi.fn()}
    />,
  )
}

// 测试 helper 函数，构建完整 CopilotPanelShell 用于交互式渲染验证
/* eslint-disable-next-line max-lines-per-function */
function renderInteractiveShell(debugModeEnabled: boolean) {
  const conversation: CopilotMessageListItem[] = [
    {
      id: 'assistant:run-1:1',
      kind: 'assistant',
      runId: 'run-1',
      sequence: 1,
      title: '助手响应',
      content: '已生成的回答',
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
      sequence: 2,
      title: '工具调用失败',
      content: 'search-campus 调用失败。',
      status: 'failed',
      toolCallId: 'tool.remote-search:call-1',
      toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
      toolPhase: 'failed',
      inputSummary: '{"keyword":"calendar"}',
      resultSummary: null,
      errorSummary: 'stderr tail',
      errorDetail: createCopilotErrorDetailSource({
        source: 'streaming',
        title: '工具调用失败',
        summaryMessage: DESC_CN_004,
        rawMessage: LABEL_TOOL_FAILED_BOOM,
        code: 'tool_execution_failed',
        stage: 'streaming',
        requestedMethod: 'run/stream',
        details: {
          toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
          toolCallId: 'tool.remote-search:call-1',
          serverId: 'mcp-stdio-stub',
          serverName: 'stdio stub server',
          remoteToolName: 'search-campus',
          phase: 'tools/call',
          diagnosticSummary: 'connector ready but remote tool returned error',
          stderrSummary: 'stderr tail',
          snapshotRevision: 12,
        },
      }),
    },
    {
      id: 'terminal:run-1:failed',
      kind: 'terminal',
      runId: 'run-1',
      sequence: 3,
      title: '发送失败',
      content: DESC_CN_004,
      status: 'failed',
      terminalPhase: 'failed',
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
      errorDetail: createCopilotErrorDetailSource({
        source: 'streaming',
        title: '发送失败',
        summaryMessage: DESC_CN_004,
        rawMessage: LABEL_TOOL_FAILED_BOOM,
        code: 'tool_execution_failed',
        stage: 'streaming',
        requestedMethod: 'run/stream',
        details: {
          toolId: LABEL_TOOL_REMOTE_SEARCH,
        },
      }),
    },
  ]

  return renderWithRoot(
    <CopilotPanelShell
      state={createReadyState({
        bootstrapFields: {
          runtimeUrl: 'http://127.0.0.1:8765',
          agentName: null,
          debugModeEnabled,
        },
      })}
      retrying={false}
      onRetry={vi.fn()}
      selectedAgent={createSelectedAgent()}
      sessionShell={createSessionShell()}
      directoryState={createDirectoryState()}
      sessionStatus="idle"
      sessionError={null}
      sendError={null}
      modelGroups={[]}
      thinkingCapability={null}
      composerDraft={createEmptyComposerDraft()}
      onComposerDraftChange={vi.fn()}
      onSend={vi.fn()}
      onCancelCurrentRun={vi.fn()}
      sendStatus="idle"
      canCancelSend={false}
      sendDisabledReason={null}
      composerLockedReason={null}
      historyDrift={null}
      historyRebindAcknowledged={false}
      onAcknowledgeHistoryRebind={vi.fn()}
      conversation={conversation}
      assistantPlaceholder={{
        shouldRender: false,
        dismissReason: 'inactive',
      }}
      composerInputRef={createRef<HTMLTextAreaElement>()}
      composerHeight={160}
      onComposerResizeStart={vi.fn()}
    />,
  )
}

function buildHistoryLoadingGateShell(input: {
  sessionId?: string
  detailStatus?: AssistantSessionHistoryState['detailStatus']
  hasLoadedDetail?: boolean
  isPersistedThread?: boolean
  modelGroups?: ReturnType<typeof createHistoryLoadingGateModelGroups>
  composerDraft?: ReturnType<typeof createHistoryLoadingGateComposerDraft>
  conversation?: CopilotMessageListItem[]
  sendDisabledReason?: string | null
  renderLoadingSkeleton?: boolean
} = {}) {
  const sessionId = input.sessionId ?? 'thread-1'
  const detailStatus = input.detailStatus ?? 'idle'
  const isPersistedThread = input.isPersistedThread ?? true

  return (
    <CopilotPanelShell
      state={createReadyState()}
      retrying={false}
      onRetry={vi.fn()}
      selectedAgent={createSelectedAgent()}
      sessionShell={createSessionShell({
        sessionId,
        ...(isPersistedThread
          ? {
              capabilities: {
                capabilitiesVersion: LABEL_HISTORY_SHELL,
              },
            }
          : {}),
      })}
      directoryState={createDirectoryState()}
      sessionStatus="idle"
      sessionError={null}
      sessionHistory={createPersistedSessionHistoryStateForThread(sessionId, {
        isPersistedThread,
        detailStatus,
        hasLoadedDetail: input.hasLoadedDetail ?? (detailStatus === 'ready'),
        selectedRunId: isPersistedThread ? 'run-1' : null,
      })}
      renderLoadingSkeleton={input.renderLoadingSkeleton}
      sendError={null}
      modelGroups={input.modelGroups ?? []}
      thinkingCapability={null}
      composerDraft={input.composerDraft ?? createHistoryLoadingGateComposerDraft()}
      onComposerDraftChange={vi.fn()}
      onSend={vi.fn()}
      onCancelCurrentRun={vi.fn()}
      sendStatus="idle"
      canCancelSend={false}
      sendDisabledReason={input.sendDisabledReason ?? null}
      composerLockedReason={null}
      historyDrift={null}
      historyRebindAcknowledged={false}
      onAcknowledgeHistoryRebind={vi.fn()}
      conversation={input.conversation ?? []}
      assistantPlaceholder={{
        shouldRender: false,
        dismissReason: 'inactive',
      }}
      composerInputRef={createRef<HTMLTextAreaElement>()}
      composerHeight={160}
      onComposerResizeStart={vi.fn()}
    />
  )
}

function createHistoryLoadingGateComposerDraft(messageText = ''): CopilotChatComposerDraft {
  return {
    ...createEmptyComposerDraft(),
    messageText,
    selectedModelId: 'provider-openai:openai/gpt-4.1',
    selectedModelRoute: {
      routeRef: {
        routeKind: 'provider-model',
        profileId: LABEL_PROVIDER_OPENAI,
        modelId: LABEL_OPENAI_GPT,
      },
    },
  }
}

function createHistoryLoadingGateConversation(content: string): CopilotMessageListItem[] {
  return [{
    id: `assistant:${content}`,
    kind: 'assistant',
    runId: 'run-history-loading-gate',
    sequence: 1,
    title: '助手响应',
    content,
    status: 'completed',
    resolvedModelId: null,
    resolvedModelRoute: null,
    resolvedToolIds: [],
    requestOptions: {},
  }]
}

function createHistoryLoadingGateModelGroups(): CopilotModelGroup[] {
  return [{
    key: LABEL_PROVIDER_OPENAI,
    title: 'OpenAI',
    models: [{
      id: 'provider-openai:openai/gpt-4.1',
      selectionValue: 'provider-openai:openai/gpt-4.1',
      modelId: LABEL_OPENAI_GPT,
      name: 'GPT-4.1',
      provider: 'OpenAI',
      group: 'OpenAI',
      tags: [],
      icon: {
        label: 'G',
        accent: '#10a37f',
      },
      routeRef: {
        routeKind: 'provider-model',
        profileId: LABEL_PROVIDER_OPENAI,
        modelId: LABEL_OPENAI_GPT,
      },
      route: {
        routeRef: {
          routeKind: 'provider-model',
          profileId: LABEL_PROVIDER_OPENAI,
          modelId: LABEL_OPENAI_GPT,
        },
      },
      available: true,
      unavailableReason: null,
      thinkingCapabilityOverride: null,
    }],
  }]
}

function createPersistedSessionHistoryStateForThread(
  sessionId: string,
  overrides: Partial<AssistantSessionHistoryState> = {},
): AssistantSessionHistoryState {
  const { summary, ...restOverrides } = overrides
  const baseState = createPersistedSessionHistoryState()

  return createPersistedSessionHistoryState({
    ...restOverrides,
    summary: {
      ...baseState.summary,
      threadId: sessionId,
      ...(summary ?? {}),
    },
  })
}

function createPersistedSessionHistoryState(
  overrides: Partial<AssistantSessionHistoryState> = {},
): AssistantSessionHistoryState {
  return {
    summary: {
      threadId: 'thread-1',
      boundAgentId: 'general',
      title: '历史线程',
      titleSource: 'deterministic',
      summary: '历史摘要',
      summarySource: 'deterministic',
      createdAt: '2026-04-13T15:00:00Z',
      updatedAt: '2026-04-13T15:05:00Z',
      lastActivityAt: '2026-04-13T15:05:00Z',
      lastRunId: 'run-1',
      lastRunStatus: 'completed',
      lastUserMessagePreview: '你好',
      lastAssistantMessagePreview: '历史摘要',
      driftSummary: {
        status: 'not_evaluated',
      },
    },
    isPersistedThread: true,
    hasLoadedDetail: false,
    detailStatus: 'idle',
    detailError: null,
    timelineItems: [],
    runSummaries: [],
    latestConfigurationSnapshot: null,
    availabilityDrift: null,
    capabilitiesStatus: 'ready',
    capabilitiesError: null,
    selectedRunId: 'run-1',
    replayStatus: 'idle',
    replayError: null,
    replay: null,
    replayByRunId: {},
    ...overrides,
  }
}