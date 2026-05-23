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
const LABEL_HISTORY_SHELL = 'history-shell'
const LABEL_OPENAI_GPT = 'openai/gpt-4.1'
const LABEL_PROVIDER_OPENAI = 'provider-openai'
const SELECTOR_CHAT_HISTORY_LOADING = 'chat-history-loading-skeleton'
const SELECTOR_CHAT_MESSAGE_SCROLL = 'chat-message-scroll-region'


afterEach(() => {
  vi.useRealTimers()
})

// 顶层集成测试 describe，包含 5+ 子 describe，覆盖 diagnostic 面板全场景，无法安全拆分
/* eslint-disable-next-line max-lines-per-function */
describe('CopilotPanelShell diagnostic visibility', () => {
  describe('persisted history retry and loading', () => {
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
              capabilitiesVersion: LABEL_HISTORY_SHELL,
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

      expect(rendered.getByTestId('chat-history-retry-button').textContent).toContain('历史消息加载失败，点击重试')
      expect(rendered.queryByTestId(SELECTOR_CHAT_MESSAGE_SCROLL)).toBeNull()

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
              capabilitiesVersion: LABEL_HISTORY_SHELL,
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

      expect(html).toContain(`data-testid="${SELECTOR_CHAT_HISTORY_LOADING}"`)
      expect(html).not.toContain(`data-testid="${SELECTOR_CHAT_MESSAGE_SCROLL}"`)
      expect(html).not.toContain('data-testid="chat-history-retry-button"')
    })
  })

  it('scrolls a restored persisted conversation to the latest message when history detail becomes ready', async () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    try {
      const rendered = renderWithRoot(buildHistoryLoadingGateShell({
        sessionId: 'thread-1',
        detailStatus: 'ready',
        hasLoadedDetail: true,
        conversation: [
          {
            id: 'history:user-1',
            kind: 'user',
            title: '',
            content: '天气如何',
            status: 'completed',
          },
          {
            id: 'history:assistant-1',
            kind: 'assistant',
            runId: 'run-1',
            sequence: 1,
            title: '助手响应',
            content: '天气晴朗。',
            status: 'completed',
            resolvedModelId: null,
            resolvedModelRoute: null,
            resolvedToolIds: [],
            requestOptions: {},
          },
          {
            id: 'history:user-2',
            kind: 'user',
            title: '',
            content: '后天呢',
            status: 'completed',
          },
          {
            id: 'history:assistant-2',
            kind: 'assistant',
            runId: 'run-2',
            sequence: 2,
            title: '助手响应',
            content: '后天继续晴朗。',
            status: 'completed',
            resolvedModelId: null,
            resolvedModelRoute: null,
            resolvedToolIds: [],
            requestOptions: {},
          },
        ],
      }))

      await act(async () => {
        await Promise.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL).textContent).toContain('后天呢')
      expect(scrollIntoView).toHaveBeenCalled()

      rendered.unmount()
    } finally {
      if (originalScrollIntoView === undefined) {
        delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
      } else {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView,
        })
      }
    }
  })

  it('does not scroll when the restored conversation has no messages yet', async () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    try {
      const rendered = renderWithRoot(buildHistoryLoadingGateShell({
        sessionId: 'thread-empty',
        detailStatus: 'ready',
        hasLoadedDetail: true,
        conversation: [],
      }))

      await act(async () => {
        await Promise.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL).textContent).not.toContain('助手响应')
      expect(scrollIntoView).not.toHaveBeenCalled()

      rendered.unmount()
    } finally {
      if (originalScrollIntoView === undefined) {
        delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
      } else {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView,
        })
      }
    }
  })

  // 包含 3 个紧密相关的 history loading gate 测试，需共享 fake timers 和复杂 shell 构建
  /* eslint-disable-next-line max-lines-per-function */
  describe('history loading gate', () => {
    it('keeps previous content visible, locks the composer, and switches directly to the new thread when loading finishes within 300ms', async () => {
      vi.useFakeTimers()
      const rendered = renderWithRoot(buildHistoryLoadingGateShell({
        sessionId: 'thread-1',
        detailStatus: 'ready',
        hasLoadedDetail: true,
        conversation: createHistoryLoadingGateConversation('旧话题回答'),
        composerDraft: createHistoryLoadingGateComposerDraft('旧话题草稿'),
        modelGroups: createHistoryLoadingGateModelGroups(),
      }))

      rendered.rerender(buildHistoryLoadingGateShell({
        sessionId: 'thread-2',
        detailStatus: 'loading',
        conversation: createHistoryLoadingGateConversation('新话题回答'),
        composerDraft: createHistoryLoadingGateComposerDraft('新话题草稿'),
        modelGroups: createHistoryLoadingGateModelGroups(),
      }))

      expect(rendered.queryByTestId(SELECTOR_CHAT_HISTORY_LOADING)).toBeNull()
      expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL).textContent).toContain('旧话题回答')
      expect(rendered.container.textContent).not.toContain('新话题回答')

      const retainedInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
      const retainedSendButton = rendered.getByTestId('chat-composer-send-button') as HTMLButtonElement
      const retainedModelTrigger = rendered.getByTestId('chat-model-picker-trigger') as HTMLButtonElement
      expect(retainedInput.value).toBe('旧话题草稿')
      expect(retainedInput.disabled).toBe(true)
      expect(retainedSendButton.disabled).toBe(true)
      expect(retainedSendButton.title).toBe('正在切换话题，请稍候。')
      expect(retainedModelTrigger.disabled).toBe(true)

      await act(async () => {
        vi.advanceTimersByTime(299)
      })

      expect(rendered.queryByTestId(SELECTOR_CHAT_HISTORY_LOADING)).toBeNull()
      expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL).textContent).toContain('旧话题回答')

      rendered.rerender(buildHistoryLoadingGateShell({
        sessionId: 'thread-2',
        detailStatus: 'ready',
        hasLoadedDetail: true,
        conversation: createHistoryLoadingGateConversation('新话题回答'),
        composerDraft: createHistoryLoadingGateComposerDraft('新话题草稿'),
        modelGroups: createHistoryLoadingGateModelGroups(),
      }))

      await act(async () => {
        vi.advanceTimersByTime(1)
      })

      expect(rendered.queryByTestId(SELECTOR_CHAT_HISTORY_LOADING)).toBeNull()
      expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL).textContent).toContain('新话题回答')
      expect(rendered.container.textContent).not.toContain('旧话题回答')

      const readyInput = rendered.container.querySelector('textarea[name="messageText"]') as HTMLTextAreaElement
      const readySendButton = rendered.getByTestId('chat-composer-send-button') as HTMLButtonElement
      const readyModelTrigger = rendered.getByTestId('chat-model-picker-trigger') as HTMLButtonElement
      expect(readyInput.value).toBe('新话题草稿')
      expect(readyInput.disabled).toBe(false)
      expect(readySendButton.disabled).toBe(false)
      expect(readyModelTrigger.disabled).toBe(false)
      rendered.unmount()
    })

    it('switches from retained previous content to the skeleton after 300ms when the next persisted thread is still loading', async () => {
      vi.useFakeTimers()
      const rendered = renderWithRoot(buildHistoryLoadingGateShell({
        sessionId: 'thread-1',
        detailStatus: 'ready',
        hasLoadedDetail: true,
        conversation: createHistoryLoadingGateConversation('旧话题回答'),
        composerDraft: createHistoryLoadingGateComposerDraft('旧话题草稿'),
        modelGroups: createHistoryLoadingGateModelGroups(),
      }))

      rendered.rerender(buildHistoryLoadingGateShell({
        sessionId: 'thread-2',
        detailStatus: 'loading',
        conversation: createHistoryLoadingGateConversation('新话题回答'),
        composerDraft: createHistoryLoadingGateComposerDraft('新话题草稿'),
        modelGroups: createHistoryLoadingGateModelGroups(),
      }))

      expect(queryActiveByTestId(rendered.container, SELECTOR_CHAT_HISTORY_LOADING)).toBeNull()
      expect(queryActiveByTestId(rendered.container, SELECTOR_CHAT_MESSAGE_SCROLL)?.textContent).toContain('旧话题回答')

      await act(async () => {
        vi.advanceTimersByTime(299)
      })

      expect(queryActiveByTestId(rendered.container, SELECTOR_CHAT_HISTORY_LOADING)).toBeNull()
      expect(queryActiveByTestId(rendered.container, SELECTOR_CHAT_MESSAGE_SCROLL)?.textContent).toContain('旧话题回答')

      await act(async () => {
        vi.advanceTimersByTime(1)
      })

      expect(queryActiveByTestId(rendered.container, SELECTOR_CHAT_HISTORY_LOADING)).not.toBeNull()
      expect(queryActiveByTestId(rendered.container, SELECTOR_CHAT_MESSAGE_SCROLL)).toBeNull()
      expect(readActiveTextContent(rendered.container)).not.toContain('旧话题回答')
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

      expect(queryActiveByTestId(rendered.container, SELECTOR_CHAT_HISTORY_LOADING)).not.toBeNull()

      rendered.rerender(buildHistoryLoadingGateShell({
        sessionId: 'thread-2',
        detailStatus: 'ready',
        hasLoadedDetail: true,
      }))

      expect(rendered.queryByTestId(SELECTOR_CHAT_HISTORY_LOADING)).not.toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(499)
      })

      expect(rendered.queryByTestId(SELECTOR_CHAT_HISTORY_LOADING)).not.toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(1)
      })

      expect(queryActiveByTestId(rendered.container, SELECTOR_CHAT_HISTORY_LOADING)).toBeNull()
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

      expect(queryActiveByTestId(rendered.container, SELECTOR_CHAT_HISTORY_LOADING)).not.toBeNull()

      rendered.rerender(buildHistoryLoadingGateShell({
        sessionId: 'thread-3',
        detailStatus: 'loading',
      }))

      expect(queryActiveByTestId(rendered.container, SELECTOR_CHAT_HISTORY_LOADING)).toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(299)
      })

      expect(queryActiveByTestId(rendered.container, SELECTOR_CHAT_HISTORY_LOADING)).toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(1)
      })

      expect(queryActiveByTestId(rendered.container, SELECTOR_CHAT_HISTORY_LOADING)).not.toBeNull()
      rendered.unmount()
    })

    it('keeps startup restore on the existing immediate skeleton path and does not gate new blank sessions', async () => {
      vi.useFakeTimers()
      const startupRendered = renderWithRoot(buildHistoryLoadingGateShell({
        sessionId: 'thread-startup',
        detailStatus: 'loading',
      }))

      expect(startupRendered.queryByTestId(SELECTOR_CHAT_HISTORY_LOADING)).not.toBeNull()

      startupRendered.unmount()

      const liveRendered = renderWithRoot(buildHistoryLoadingGateShell({
        sessionId: 'thread-live',
        detailStatus: 'loading',
        isPersistedThread: false,
      }))

      expect(liveRendered.queryByTestId(SELECTOR_CHAT_HISTORY_LOADING)).toBeNull()
      expect(liveRendered.queryByTestId(SELECTOR_CHAT_MESSAGE_SCROLL)).not.toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(800)
      })

      expect(liveRendered.queryByTestId(SELECTOR_CHAT_HISTORY_LOADING)).toBeNull()
      expect(liveRendered.queryByTestId(SELECTOR_CHAT_MESSAGE_SCROLL)).not.toBeNull()
      liveRendered.unmount()
    })
  })

  describe('skeleton suppression', () => {
    it('suppresses the persisted history skeleton when renderLoadingSkeleton is false', () => {
      const html = renderToStaticMarkup(
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
            detailStatus: 'loading',
          })}
          renderLoadingSkeleton={false}
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

      expect(html).not.toContain(`data-testid="${SELECTOR_CHAT_HISTORY_LOADING}"`)
    })

    it('transitions from hidden loading to ready without a skeleton exit stage when renderLoadingSkeleton is false', async () => {
      vi.useFakeTimers()
      const rendered = renderWithRoot(buildHistoryLoadingGateShell({
        sessionId: 'thread-hidden',
        detailStatus: 'loading',
        renderLoadingSkeleton: false,
      }))

      expect(rendered.queryByTestId(SELECTOR_CHAT_HISTORY_LOADING)).toBeNull()

      rendered.rerender(buildHistoryLoadingGateShell({
        sessionId: 'thread-hidden',
        detailStatus: 'ready',
        hasLoadedDetail: true,
        conversation: createHistoryLoadingGateConversation('新话题回答'),
        renderLoadingSkeleton: false,
      }))

      await act(async () => {
        vi.advanceTimersByTime(160)
      })

      expect(rendered.queryByTestId(SELECTOR_CHAT_HISTORY_LOADING)).toBeNull()
      expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL).textContent).toContain('新话题回答')

      rendered.unmount()
    })

    it('does not stage a hidden loading-to-ready cross-fade before a restored thread is revealed', async () => {
      vi.useFakeTimers()
      const rendered = renderWithRoot(buildHistoryLoadingGateShell({
        sessionId: 'thread-hidden-stage',
        detailStatus: 'loading',
        renderLoadingSkeleton: false,
      }))

      rendered.rerender(buildHistoryLoadingGateShell({
        sessionId: 'thread-hidden-stage',
        detailStatus: 'ready',
        hasLoadedDetail: true,
        conversation: createHistoryLoadingGateConversation('新话题回答'),
        renderLoadingSkeleton: false,
      }))

      await act(async () => {})

      expect(rendered.container.querySelector('.cross-fade__stage--entering')).toBeNull()
      expect(rendered.getByTestId(SELECTOR_CHAT_MESSAGE_SCROLL).textContent).toContain('新话题回答')

      rendered.unmount()
    })
  })

  // 包含 4 个 transient/edge case 测试，覆盖交互式 shell 与 sse 流
  /* eslint-disable-next-line max-lines-per-function */
  describe('transient and edge cases', () => {
    it('prefers transient conversation content over persisted loading gating', () => {
      const html = renderToStaticMarkup(
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
          composerLockedReason={null}
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

      expect(html).toContain(`data-testid="${SELECTOR_CHAT_MESSAGE_SCROLL}"`)
      expect(html).toContain('即时消息')
      expect(html).not.toContain(`data-testid="${SELECTOR_CHAT_HISTORY_LOADING}"`)
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
              capabilitiesVersion: LABEL_HISTORY_SHELL,
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
          composerLockedReason={null}
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

      expect(html).toContain(`data-testid="${SELECTOR_CHAT_MESSAGE_SCROLL}"`)
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

      expect(html).toContain('data-testid="chat-history-restore-error"')
      expect(html).toContain('历史话题恢复失败，稍后自动重试。')
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