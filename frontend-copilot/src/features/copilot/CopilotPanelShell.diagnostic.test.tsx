/** @vitest-environment jsdom */

import { act, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import { CopilotPanelShell } from './CopilotPanelShell'
import { createEmptyComposerDraft } from './copilot-chat-helpers'
import { createCopilotErrorDetailSource } from './error-detail-overlay-view-model'
import type { CopilotMessageListItem } from './run-segment-view-model'
import {
  clickElement,
  createDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
  renderWithRoot,
} from './CopilotChatPanel.test-support'

afterEach(() => {
  vi.useRealTimers()
})

describe('CopilotPanelShell diagnostic visibility', () => {
  it('renders a concise persisted history retry prompt and triggers retry', async () => {
    const onRetrySessionHistory = vi.fn()
    const rendered = renderWithRoot(
      <CopilotPanelShell
        state={createReadyState()}
        retrying={false}
        onRetry={vi.fn()}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell({
          capabilities: {
            capabilitiesVersion: 'history-shell',
          },
        })}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createPersistedSessionHistoryState({
          detailStatus: 'error',
          detailError: 'detail unavailable',
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

    expect(rendered.getByTestId('chat-history-retry-button').textContent).toContain('历史消息加载失败，点击重试')
    expect(rendered.queryByTestId('chat-message-scroll-region')).toBeNull()

    await clickElement(rendered.getByTestId('chat-history-retry-button'))

    expect(onRetrySessionHistory).toHaveBeenCalledOnce()

    rendered.unmount()
  })

  it('renders a lightweight persisted history skeleton while loading detail', () => {
    const html = renderToStaticMarkup(
      <CopilotPanelShell
        state={createReadyState()}
        retrying={false}
        onRetry={vi.fn()}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell({
          capabilities: {
            capabilitiesVersion: 'history-shell',
          },
        })}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createPersistedSessionHistoryState({
          detailStatus: 'loading',
        })}
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

    expect(html).toContain('data-testid="chat-history-loading-skeleton"')
    expect(html).not.toContain('data-testid="chat-message-scroll-region"')
    expect(html).not.toContain('data-testid="chat-history-retry-button"')
  })

  it('does not show the skeleton when a thread switch finishes within 300ms', async () => {
    vi.useFakeTimers()
    const rendered = renderWithRoot(buildHistoryLoadingGateShell({
      sessionId: 'thread-1',
      detailStatus: 'ready',
      hasLoadedDetail: true,
    }))

    rendered.rerender(buildHistoryLoadingGateShell({
      sessionId: 'thread-2',
      detailStatus: 'loading',
    }))

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(299)
    })

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).toBeNull()

    rendered.rerender(buildHistoryLoadingGateShell({
      sessionId: 'thread-2',
      detailStatus: 'ready',
      hasLoadedDetail: true,
    }))

    await act(async () => {
      vi.advanceTimersByTime(1)
    })

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).toBeNull()
    rendered.unmount()
  })

  it('shows the skeleton only after 300ms when switching to another persisted thread', async () => {
    vi.useFakeTimers()
    const rendered = renderWithRoot(buildHistoryLoadingGateShell({
      sessionId: 'thread-1',
      detailStatus: 'ready',
      hasLoadedDetail: true,
    }))

    rendered.rerender(buildHistoryLoadingGateShell({
      sessionId: 'thread-2',
      detailStatus: 'loading',
    }))

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(299)
    })

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(1)
    })

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).not.toBeNull()
    rendered.unmount()
  })

  it('keeps the skeleton visible for at least 500ms once it appears', async () => {
    vi.useFakeTimers()
    const rendered = renderWithRoot(buildHistoryLoadingGateShell({
      sessionId: 'thread-1',
      detailStatus: 'ready',
      hasLoadedDetail: true,
    }))

    rendered.rerender(buildHistoryLoadingGateShell({
      sessionId: 'thread-2',
      detailStatus: 'loading',
    }))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).not.toBeNull()

    rendered.rerender(buildHistoryLoadingGateShell({
      sessionId: 'thread-2',
      detailStatus: 'ready',
      hasLoadedDetail: true,
    }))

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).not.toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(499)
    })

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).not.toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(1)
    })

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).toBeNull()
    rendered.unmount()
  })

  it('resets the loading gate when the user switches again before the previous minimum display ends', async () => {
    vi.useFakeTimers()
    const rendered = renderWithRoot(buildHistoryLoadingGateShell({
      sessionId: 'thread-1',
      detailStatus: 'ready',
      hasLoadedDetail: true,
    }))

    rendered.rerender(buildHistoryLoadingGateShell({
      sessionId: 'thread-2',
      detailStatus: 'loading',
    }))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).not.toBeNull()

    rendered.rerender(buildHistoryLoadingGateShell({
      sessionId: 'thread-3',
      detailStatus: 'loading',
    }))

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(299)
    })

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(1)
    })

    expect(rendered.queryByTestId('chat-history-loading-skeleton')).not.toBeNull()
    rendered.unmount()
  })

  it('keeps startup restore on the existing immediate skeleton path and does not gate new blank sessions', async () => {
    vi.useFakeTimers()
    const startupRendered = renderWithRoot(buildHistoryLoadingGateShell({
      sessionId: 'thread-startup',
      detailStatus: 'loading',
    }))

    expect(startupRendered.queryByTestId('chat-history-loading-skeleton')).not.toBeNull()

    startupRendered.unmount()

    const liveRendered = renderWithRoot(buildHistoryLoadingGateShell({
      sessionId: 'thread-live',
      detailStatus: 'loading',
      isPersistedThread: false,
    }))

    expect(liveRendered.queryByTestId('chat-history-loading-skeleton')).toBeNull()
    expect(liveRendered.queryByTestId('chat-message-scroll-region')).not.toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(800)
    })

    expect(liveRendered.queryByTestId('chat-history-loading-skeleton')).toBeNull()
    expect(liveRendered.queryByTestId('chat-message-scroll-region')).not.toBeNull()
    liveRendered.unmount()
  })

  it('prefers transient conversation content over persisted loading gating', () => {
    const html = renderToStaticMarkup(
      <CopilotPanelShell
        state={createReadyState()}
        retrying={false}
        onRetry={vi.fn()}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell({
          capabilities: {
            capabilitiesVersion: 'history-shell',
          },
        })}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createPersistedSessionHistoryState({
          detailStatus: 'loading',
        })}
        sendError={null}
        modelGroups={[]}
        thinkingCapability={null}
        composerDraft={createEmptyComposerDraft()}
        onComposerDraftChange={vi.fn()}
        onSend={vi.fn()}
        onCancelCurrentRun={vi.fn()}
        sendStatus="sending"
        canCancelSend={false}
        sendDisabledReason={null}
        historyDrift={null}
        historyRebindAcknowledged={false}
        onAcknowledgeHistoryRebind={vi.fn()}
        hasTransientConversation
        conversation={[
          {
            id: 'user:transient-1',
            kind: 'user',
            title: '',
            content: '即时消息',
            status: 'completed',
          },
        ]}
        assistantPlaceholder={{
          shouldRender: true,
          dismissReason: null,
        }}
        composerInputRef={createRef<HTMLTextAreaElement>()}
        composerHeight={160}
        onComposerResizeStart={vi.fn()}
      />,
    )

    expect(html).toContain('data-testid="chat-message-scroll-region"')
    expect(html).toContain('即时消息')
    expect(html).not.toContain('data-testid="chat-history-loading-skeleton"')
  })

  it('keeps an active restored session visible even when selectedAgent is temporarily null', () => {
    const html = renderToStaticMarkup(
      <CopilotPanelShell
        state={createReadyState()}
        retrying={false}
        onRetry={vi.fn()}
        selectedAgent={null}
        sessionShell={createSessionShell({
          capabilities: {
            capabilitiesVersion: 'history-shell',
          },
        })}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        sessionHistory={createPersistedSessionHistoryState({
          detailStatus: 'ready',
          timelineItems: [
            {
              kind: 'assistant_message',
              runId: 'run-1',
              sequenceStart: 1,
              text: '启动恢复历史',
            },
          ],
        })}
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
        historyDrift={null}
        historyRebindAcknowledged={false}
        onAcknowledgeHistoryRebind={vi.fn()}
        conversation={[
          {
            id: 'history:user:run-1',
            kind: 'user',
            title: '',
            content: '启动恢复历史',
            status: 'completed',
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

    expect(html).toContain('data-testid="chat-message-scroll-region"')
    expect(html).toContain('启动恢复历史')
    expect(html).not.toContain('暂无可用助手')
  })

  it('shows a concise restore diagnostic when history recovery fails before any session is available', () => {
    const html = renderToStaticMarkup(
      <CopilotPanelShell
        state={createReadyState()}
        retrying={false}
        onRetry={vi.fn()}
        selectedAgent={createSelectedAgent()}
        sessionShell={null}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
        historyRestoreError="history list unavailable"
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

    expect(html).toContain('data-testid="chat-history-restore-error"')
    expect(html).toContain('历史话题恢复失败，稍后自动重试。')
  })

  it('hides runtime diagnostic cards when debug mode is disabled while keeping other content visible', () => {
    const html = renderShell(false)

    expect(html).toContain('已生成的回答')
    expect(html).toContain('发送失败')
    expect(html).toContain('工具执行失败，请重试。')
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

    expect(rendered.container.textContent).not.toContain('Tool failed: boom')

    await clickElement(rendered.getByTestId('chat-message-error-detail-button-1'))

    expect(rendered.getByTestId('error-detail-overlay').textContent).toContain('工具执行失败，请重试。')
    expect(rendered.getByTestId('error-detail-overlay').textContent).toContain('Tool failed: boom')
    expect(rendered.getByTestId('error-detail-overlay-group-summary').textContent).toContain('摘要')

    await clickElement(rendered.getByTestId('error-detail-overlay-close'))

    expect(rendered.queryByTestId('error-detail-overlay')).toBeNull()

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
            capabilitiesVersion: 'history-shell',
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
            capabilitiesVersion: 'history-shell',
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
      content: 'Tool failed: boom',
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
      id: 'terminal:run-1:failed',
      kind: 'terminal',
      runId: 'run-1',
      sequence: 3,
      title: '发送失败',
      content: '工具执行失败，请重试。',
      status: 'failed',
      terminalPhase: 'failed',
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
      errorDetail: createCopilotErrorDetailSource({
        source: 'streaming',
        title: '发送失败',
        summaryMessage: '工具执行失败，请重试。',
        rawMessage: 'Tool failed: boom',
        code: 'tool_execution_failed',
        stage: 'streaming',
        requestedMethod: 'run/stream',
        details: {
          toolId: 'tool.weather-current',
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
      id: 'terminal:run-1:failed',
      kind: 'terminal',
      runId: 'run-1',
      sequence: 3,
      title: '发送失败',
      content: '工具执行失败，请重试。',
      status: 'failed',
      terminalPhase: 'failed',
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
      errorDetail: createCopilotErrorDetailSource({
        source: 'streaming',
        title: '发送失败',
        summaryMessage: '工具执行失败，请重试。',
        rawMessage: 'Tool failed: boom',
        code: 'tool_execution_failed',
        stage: 'streaming',
        requestedMethod: 'run/stream',
        details: {
          toolId: 'tool.weather-current',
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
                capabilitiesVersion: 'history-shell',
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
    />
  )
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
