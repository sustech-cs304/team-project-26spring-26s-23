/** @vitest-environment jsdom */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { CopilotHistoryRunReplaySuccess } from '../../../electron/copilot-history'
import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import { createPersistedWorkspaceState } from '../../workbench/settings/test-support/settings-workspace-test-fixtures'
import {
  buildPersistedConversationFromHistory,
  getPersistedInlineFormRebuildability,
} from './persisted-history-view-model'
import { createIdleCopilotRunState } from './run-segment-reducer'
import {
  hasSufficientPersistedConversationForRun,
  resolvePersistedConversationHandoffWaitReason,
} from './state/useCopilotChatPanelState'
import { CopilotChatPanel } from './CopilotChatPanel'
import {
  clickElement,
  createDirectoryState,
  createEmptyState,
  createFailedState,
  createIdleDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
  renderWithRoot,
} from './CopilotChatPanel.test-support'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const DESC_CN_012 = '表单请求已发送，等待用户提交。'
const LABEL_2026_13T15 = '2026-04-13T15:00:01Z'
const LABEL_2026_13T15_2 = '2026-04-13T15:00:00Z'
const LABEL_2026_13T15_3 = '2026-04-13T15:05:00Z'
const LABEL_2026_13T15_4 = '2026-04-13T15:00:03Z'
const LABEL_2026_13T15_5 = '2026-04-13T15:00:02Z'
const LABEL_COURSE_FORM = 'course-form'
const LABEL_HISTORY_SHELL = 'history-shell'
const LABEL_INLINE_FORM = 'inline-form'
const LABEL_OPENAI_GPT = 'openai/gpt-4.1'
const LABEL_RUN_FORM_HISTORY = 'run-form-history'
const LABEL_RUN_FORM_PENDING = 'run-form-pending-history'
const LABEL_RUN_REASONING_HISTORY = 'run-reasoning-history'
const LABEL_TOOL_REQUEST_USER = 'tool.request-user-form:call-1'
const LABEL_TOOL_REQUEST_USER_2 = 'tool.request-user-form'
const SELECTOR_DATA_TESTID_CHAT = 'data-testid="chat-message-scroll-region"'
const SELECTOR_DATA_TESTID_CHAT_2 = 'data-testid="chat-history-loading-skeleton"'
const SELECTOR_DATA_TESTID_CHAT_3 = 'data-testid="chat-history-retry-button"'


declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
})

/* eslint-disable-next-line max-lines-per-function -- organizational wrapper for all CopilotChatPanel unit tests */
describe('CopilotChatPanel', () => {
  describe('basic rendering', () => {
    it('renders the session-first placeholder when runtime is ready but no session has been created yet', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={null}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
        />,
      )

      expect(html).toContain('可在左侧选择助手并新建会话')
      expect(html).toContain('data-testid="chat-session-placeholder"')
      expect(html).not.toContain('请选择智能体并创建会话')
      expect(html).not.toContain('当前选择：通用智能体')
      expect(html).not.toContain('会话创建状态：待创建')
      expect(html).not.toContain('尚未创建会话')
      expect(html).not.toContain('会话创建成功后会立即拉取')
      expect(html).not.toContain('当前 Runtime URL')
      expect(html).not.toContain('当前 threadId')
      expect(html).not.toContain('发送消息')
    })

    it('renders the minimal message shell for a bound session without the removed debug information blocks', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell()}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
        />,
      )

      expect(html).toContain(SELECTOR_DATA_TESTID_CHAT)
      expect(html).toContain('data-testid="chat-composer-dock"')
      expect(html).toContain('data-testid="chat-composer-toolbar"')
      expect(html).toContain('data-testid="chat-composer-resize-handle"')
      expect(html).toContain('data-testid="chat-composer-surface"')
      expect(html).toContain('data-testid="chat-composer-send-button"')
      expect(html).not.toContain('data-testid="chat-composer-run-status"')
      expect(html).toContain('data-testid="chat-tool-picker-trigger"')
      expect(html).toContain('按 Enter 发送，按 Ctrl + Enter 换行')
      expect(html).toContain('copilot-chat__send-button')
      expect(html).toContain('copilot-chat__stream--scrollbarless')
      expect(html).toContain('aria-label="消息内容"')
      expect(html).toContain('尚未配置模型')
      expect(html).toContain('请先前往设置页添加模型服务商和模型。')
      expect(html.indexOf(SELECTOR_DATA_TESTID_CHAT)).toBeLessThan(
        html.indexOf('data-testid="chat-composer-dock"'),
      )
      expect(html.indexOf('data-testid="chat-composer-toolbar"')).toBeLessThan(
        html.indexOf('data-testid="chat-composer-resize-handle"'),
      )
      expect(html.indexOf('data-testid="chat-composer-resize-handle"')).toBeLessThan(
        html.indexOf('data-testid="chat-composer-surface"'),
      )
      expect(html).not.toContain('type="checkbox"')
      expect(html).not.toContain('requestOptions（JSON 对象）')
      expect(html).not.toContain('推荐工具只用于初始化默认勾选')
      expect(html).not.toContain('本阶段只保留最小透传结构')
      expect(html).not.toContain('发送时会显式提交 sessionId')
      expect(html).not.toContain('当前校验 Agent')
      expect(html).not.toContain('当前发送模型')
      expect(html).not.toContain('当前启用工具')
      expect(html).not.toContain('已连接')
      expect(html).not.toContain('当前 Runtime URL')
      expect(html).not.toContain('Runtime 来源')
      expect(html).not.toContain('目录状态')
      expect(html).not.toContain('Capabilities Version')
      expect(html).not.toContain('总体可用工具集合（后端能力面真源）')
      expect(html).not.toContain('当前默认启用来源')
      expect(html).not.toContain('当前 threadId')
    })
  })

  /* eslint-disable-next-line max-lines-per-function -- integration tests for persisted history state rendering including loading skeletons and post-load states */
  describe('persisted history states', () => {
    it('shows a lightweight skeleton while persisted history detail is still loading', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell({
            capabilities: {
              capabilitiesVersion: LABEL_HISTORY_SHELL,
            },
          })}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          sessionHistory={createPersistedHistoryState({
            detailStatus: 'loading',
          })}
        />,
      )

      expect(html).toContain(SELECTOR_DATA_TESTID_CHAT_2)
      expect(html).not.toContain(SELECTOR_DATA_TESTID_CHAT_3)
      expect(html).not.toContain(SELECTOR_DATA_TESTID_CHAT)
    })

    it('does not treat a new live session history shell as persisted loading', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell()}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          sessionHistory={createPersistedHistoryState({
            isPersistedThread: false,
            detailStatus: 'loading',
          })}
        />,
      )

      expect(html).toContain(SELECTOR_DATA_TESTID_CHAT)
      expect(html).not.toContain(SELECTOR_DATA_TESTID_CHAT_2)
      expect(html).not.toContain(SELECTOR_DATA_TESTID_CHAT_3)
    })

    it('shows persisted history messages directly once detail is ready', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell({
            capabilities: {
              capabilitiesVersion: LABEL_HISTORY_SHELL,
            },
          })}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          sessionHistory={createPersistedHistoryState({
            detailStatus: 'ready',
            timelineItems: [
              {
                kind: 'assistant_message',
                runId: 'run-1',
                sequenceStart: 1,
                text: '历史消息已恢复',
              },
            ],
          })}
        />,
      )

      expect(html).toContain(SELECTOR_DATA_TESTID_CHAT)
      expect(html).toContain('历史消息已恢复')
      expect(html).not.toContain(SELECTOR_DATA_TESTID_CHAT_2)
      expect(html).not.toContain(SELECTOR_DATA_TESTID_CHAT_3)
    })

    it('shows the normal empty state for a ready persisted thread with no history messages', async () => {
      const rendered = renderWithRoot(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell({
            capabilities: {
              capabilitiesVersion: LABEL_HISTORY_SHELL,
            },
          })}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          loadWorkspaceState={vi.fn(async () => ({
            ok: true as const,
            source: 'stored' as const,
            state: createPersistedWorkspaceState(),
          }))}
          sessionHistory={createPersistedHistoryState({
            summary: {
              threadId: 'thread-empty',
              boundAgentId: 'general',
              title: '空会话',
              titleSource: 'manual',
              summary: null,
              summarySource: null,
              createdAt: '2026-04-13T16:00:00Z',
              updatedAt: '2026-04-13T16:00:00Z',
              lastActivityAt: '2026-04-13T16:00:00Z',
              lastRunId: null,
              lastRunStatus: null,
              lastUserMessagePreview: null,
              lastAssistantMessagePreview: null,
              driftSummary: null,
            },
            hasLoadedDetail: true,
            detailStatus: 'ready',
            selectedRunId: null,
            timelineItems: [],
            runSummaries: [],
          })}
        />,
      )

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.getByTestId('chat-empty-state').textContent).toContain('当前尚未发送消息')
      expect(rendered.getByTestId('chat-message-scroll-region')).toBeTruthy()
      expect(rendered.queryByTestId('chat-history-retry-button')).toBeNull()

      rendered.unmount()
    })
  })

  /* eslint-disable-next-line max-lines-per-function -- integration tests for persisted history detail parsing, retry flows, and canonical tool summary rendering */
  describe('persisted history detail and retry', () => {
    it('keeps canonical JSON tool summaries as persisted tool primary content for structured rendering', () => {
      const canonicalToolSummary = '{\n  "items": [\n    1,\n    2,\n    3\n  ],\n  "ok": true\n}'
      const truncatedResultSummary = '{"items": [1, 2…'
      const conversation = buildPersistedConversationFromHistory(createPersistedHistoryState({
        hasLoadedDetail: true,
        detailStatus: 'ready',
        selectedRunId: 'run-json-history',
        timelineItems: [
          {
            kind: 'tool_call_block',
            runId: 'run-json-history',
            threadId: 'thread-1',
            toolCallId: 'tool.remote-search:call-json',
            toolId: 'tool.remote-search',
            sequenceStart: 1,
            sequenceEnd: 2,
            createdAt: LABEL_2026_13T15,
            title: '天气工具已返回结果',
            summary: canonicalToolSummary,
            inputSummary: '{"location":"Shenzhen"}',
            resultSummary: truncatedResultSummary,
            errorSummary: null,
            phases: [
              {
                phase: 'started',
                sequence: 1,
                createdAt: LABEL_2026_13T15,
                title: '调用天气工具',
                summary: '正在获取 Shenzhen 的天气。',
                inputSummary: '{"location":"Shenzhen"}',
                resultSummary: null,
                errorSummary: null,
              },
              {
                phase: 'completed',
                sequence: 2,
                createdAt: LABEL_2026_13T15_5,
                title: '天气工具已返回结果',
                summary: canonicalToolSummary,
                inputSummary: '{"location":"Shenzhen"}',
                resultSummary: truncatedResultSummary,
                errorSummary: null,
              },
            ],
          },
        ],
        replayStatus: 'idle',
        replay: null,
      }))
      const toolItem = conversation.conversation.find((item) => item.kind === 'tool')

      expect(conversation.selectedRunConversationSource).toBe('timeline')
      expect(toolItem?.kind).toBe('tool')
      if (toolItem?.kind !== 'tool') {
        throw new Error('Expected persisted tool item in restored conversation.')
      }
      expect(toolItem.content).toBe(canonicalToolSummary)
      expect(toolItem.resultSummary).toBe(truncatedResultSummary)
    })

    it('keeps the last restored history visible when a later detail refresh fails', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell({
            capabilities: {
              capabilitiesVersion: LABEL_HISTORY_SHELL,
            },
          })}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          sessionHistory={createPersistedHistoryState({
            hasLoadedDetail: true,
            detailStatus: 'error',
            detailError: 'detail unavailable',
            timelineItems: [
              {
                kind: 'assistant_message',
                runId: 'run-1',
                sequenceStart: 1,
                text: '保留上一版成功内容',
              },
            ],
          })}
        />,
      )

      expect(html).toContain(SELECTOR_DATA_TESTID_CHAT)
      expect(html).toContain('保留上一版成功内容')
      expect(html).not.toContain(SELECTOR_DATA_TESTID_CHAT_2)
      expect(html).not.toContain(SELECTOR_DATA_TESTID_CHAT_3)
    })

    it('shows a concise retry prompt when persisted history detail failed and retries on click', async () => {
      const retrySessionHistory = vi.fn()
      const rendered = renderWithRoot(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell({
            capabilities: {
              capabilitiesVersion: LABEL_HISTORY_SHELL,
            },
          })}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          sessionHistory={createPersistedHistoryState({
            detailStatus: 'error',
            detailError: 'detail unavailable',
          })}
          retrySessionHistory={retrySessionHistory}
        />,
      )

      expect(rendered.getByTestId('chat-history-retry-button').textContent).toContain('历史消息加载失败，点击重试')
      expect(rendered.container.textContent).not.toContain('detail unavailable')

      await clickElement(rendered.getByTestId('chat-history-retry-button'))

      expect(retrySessionHistory).toHaveBeenCalledOnce()

      rendered.unmount()
    })

    it('shows selected-run replay failure feedback while keeping timeline fallback visible and retryable', async () => {
      const retrySessionHistory = vi.fn()
      const rendered = renderWithRoot(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell({
            capabilities: {
              capabilitiesVersion: LABEL_HISTORY_SHELL,
            },
          })}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          sessionHistory={createPersistedHistoryState({
            hasLoadedDetail: true,
            detailStatus: 'ready',
            timelineItems: [
              {
                kind: 'assistant_message',
                runId: 'run-1',
                sequenceStart: 1,
                text: '回放失败时仍保留时间线快照',
              },
            ],
            selectedRunId: 'run-1',
            replayStatus: 'error',
            replayError: 'replay unavailable',
            replay: null,
          })}
          retrySessionHistory={retrySessionHistory}
          persistedSelectedRunConversationPending={false}
        />,
      )

      expect(rendered.getByTestId('chat-history-replay-error').textContent).toContain('当前运行回放失败')
      expect(rendered.container.textContent).toContain('回放失败时仍保留时间线快照')

      await clickElement(rendered.getByTestId('chat-history-replay-retry-button'))

      expect(retrySessionHistory).toHaveBeenCalledOnce()

      rendered.unmount()
    })

    it('renders summary fallback content when the selected persisted run has no timeline or replay yet', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell({
            capabilities: {
              capabilitiesVersion: LABEL_HISTORY_SHELL,
            },
          })}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          sessionHistory={createPersistedHistoryState({
            hasLoadedDetail: true,
            detailStatus: 'ready',
            runSummaries: [
              {
                runId: 'run-1',
                threadId: 'thread-1',
                status: 'completed',
                createdAt: LABEL_2026_13T15_2,
                updatedAt: LABEL_2026_13T15_3,
                startedAt: LABEL_2026_13T15,
                terminalAt: LABEL_2026_13T15_3,
                resolvedModelId: LABEL_OPENAI_GPT,
                requestedMessageText: '你好',
                assistantText: '历史摘要',
              },
            ],
            timelineItems: [],
            replayStatus: 'idle',
            replay: null,
          })}
        />,
      )

      expect(html).toContain(SELECTOR_DATA_TESTID_CHAT)
      expect(html).toContain('你好')
      expect(html).toContain('历史摘要')
      expect(html).not.toContain(SELECTOR_DATA_TESTID_CHAT_2)
    })
  })

  /* eslint-disable-next-line max-lines-per-function -- integration tests for run browse selection and timeline conversation fallback behavior */
  describe('run browse and timeline default', () => {
    it('keeps a restored history thread on the default chat path until run browse is explicitly selected', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell({
            capabilities: {
              capabilitiesVersion: LABEL_HISTORY_SHELL,
            },
          })}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          sessionHistory={createPersistedHistoryState({
            hasLoadedDetail: true,
            detailStatus: 'ready',
            selectedRunId: null,
            timelineItems: [
              {
                kind: 'assistant_message',
                runId: 'run-2b',
                sequenceStart: 1,
                text: '恢复后默认直接停留在普通聊天主视图。',
              },
            ],
            runSummaries: [
              {
                runId: 'run-2a',
                threadId: 'thread-1',
                status: 'completed',
                createdAt: LABEL_2026_13T15_2,
                updatedAt: '2026-04-13T15:03:00Z',
                startedAt: LABEL_2026_13T15,
                terminalAt: '2026-04-13T15:03:00Z',
                resolvedModelId: LABEL_OPENAI_GPT,
                requestedMessageText: '第一轮',
                assistantText: '第一轮回复',
              },
              {
                runId: 'run-2b',
                threadId: 'thread-1',
                status: 'completed',
                createdAt: '2026-04-13T15:04:00Z',
                updatedAt: LABEL_2026_13T15_3,
                startedAt: '2026-04-13T15:04:01Z',
                terminalAt: LABEL_2026_13T15_3,
                resolvedModelId: LABEL_OPENAI_GPT,
                requestedMessageText: '第二轮',
                assistantText: '第二轮回复',
              },
            ],
            availabilityDrift: {
              status: 'historical_provider_removed',
              historicalModelId: 'legacy-model',
              historicalToolIds: ['tool.remote-search'],
              historicalThinkingSummary: 'unified-4-level-v1 / 中 / medium / preset',
              warnings: [{
                code: 'historical_provider_removed',
                message: '历史线程绑定的模型服务商当前已不可用。',
              }],
              requiresExplicitRebind: true,
            },
            replayStatus: 'ready',
          })}
        />,
      )

      expect(html).toContain(SELECTOR_DATA_TESTID_CHAT)
      expect(html).toContain('恢复后默认直接停留在普通聊天主视图。')
      expect(html).not.toContain('data-testid="chat-history-run-selector-label"')
      expect(html).not.toContain('data-testid="chat-history-drift-notice"')
    })

    it('does not replay user request text as assistant content when run_completed payload omits assistant fields', () => {
      const conversation = buildPersistedConversationFromHistory(createPersistedHistoryState({
        hasLoadedDetail: true,
        detailStatus: 'ready',
        timelineItems: [],
        runSummaries: [{
          runId: 'run-1',
          threadId: 'thread-1',
          status: 'completed',
          createdAt: LABEL_2026_13T15_2,
          updatedAt: LABEL_2026_13T15_3,
          startedAt: LABEL_2026_13T15,
          terminalAt: LABEL_2026_13T15_3,
          resolvedModelId: LABEL_OPENAI_GPT,
          requestedMessageText: '用户原问题',
          assistantText: '摘要中已有旧回复',
        }],
        replayStatus: 'ready',
        replay: createRunReplayResult({
          run: {
            assistantText: null,
            requestedMessageText: '用户原问题',
          },
          historicalSnapshot: {
            requestMessage: {
              role: 'user',
              content: '用户原问题',
            },
          },
          orderedEvents: [{
            eventType: 'run_completed',
            sequence: 1,
            createdAt: LABEL_2026_13T15_3,
            payload: {
              resolvedModelId: LABEL_OPENAI_GPT,
            },
            toolCallId: null,
            toolId: null,
            phase: null,
            isRedacted: false,
            redactionVersion: 0,
          }],
        }),
      }))

      expect(conversation.selectedRunConversationSource).toBe('summary')
      expect(conversation.conversation).toMatchObject([
        { kind: 'user', content: '用户原问题' },
        { kind: 'assistant', content: '摘要中已有旧回复' },
      ])
    })
  })

  /* eslint-disable-next-line max-lines-per-function -- integration tests for replay fallback to persisted assistantText and reasoning timeline extraction */
  describe('replay fallback and reasoning timeline', () => {
    it('falls back to persisted run assistantText when run_completed payload omits assistant fields', () => {
      const conversation = buildPersistedConversationFromHistory(createPersistedHistoryState({
        hasLoadedDetail: true,
        detailStatus: 'ready',
        timelineItems: [],
        runSummaries: [{
          runId: 'run-1',
          threadId: 'thread-1',
          status: 'completed',
          createdAt: LABEL_2026_13T15_2,
          updatedAt: LABEL_2026_13T15_3,
          startedAt: LABEL_2026_13T15,
          terminalAt: LABEL_2026_13T15_3,
          resolvedModelId: LABEL_OPENAI_GPT,
          requestedMessageText: '用户原问题',
          assistantText: '持久化助手回复',
        }],
        replayStatus: 'ready',
        replay: createRunReplayResult({
          run: {
            assistantText: '持久化助手回复',
            requestedMessageText: '用户原问题',
          },
          historicalSnapshot: {
            requestMessage: {
              role: 'user',
              content: '用户原问题',
            },
          },
          orderedEvents: [{
            eventType: 'run_completed',
            sequence: 1,
            createdAt: LABEL_2026_13T15_3,
            payload: {
              resolvedModelId: LABEL_OPENAI_GPT,
            },
            toolCallId: null,
            toolId: null,
            phase: null,
            isRedacted: false,
            redactionVersion: 0,
          }],
        }),
      }))

      expect(conversation.selectedRunConversationSource).toBe('summary')
      expect(conversation.conversation).toMatchObject([
        { kind: 'user', content: '用户原问题' },
        { kind: 'assistant', content: '持久化助手回复' },
      ])
    })

    /* eslint-disable-next-line max-lines-per-function -- complex integration test covering timeline/replay precedence for inline-form and reasoning pipeline state */
    it('prefers timeline history when replay drops persisted inline-form and reasoning state', () => {
      const conversation = buildPersistedConversationFromHistory(createPersistedHistoryState({
        hasLoadedDetail: true,
        detailStatus: 'ready',
        selectedRunId: LABEL_RUN_FORM_HISTORY,
        timelineItems: [
          {
            kind: 'user_message',
            runId: LABEL_RUN_FORM_HISTORY,
            threadId: 'thread-1',
            sequenceStart: 0,
            sequenceEnd: 0,
            createdAt: LABEL_2026_13T15_2,
            text: '需要课程筛选条件',
            structuredPayload: null,
          },
          {
            kind: 'reasoning_block',
            runId: LABEL_RUN_FORM_HISTORY,
            threadId: 'thread-1',
            sequenceStart: 1,
            sequenceEnd: 3,
            createdAt: LABEL_2026_13T15,
            endedAt: LABEL_2026_13T15_4,
            text: '先分析需求，再请求表单。',
          },
          {
            kind: 'tool_call_block',
            runId: LABEL_RUN_FORM_HISTORY,
            threadId: 'thread-1',
            toolCallId: LABEL_TOOL_REQUEST_USER,
            toolId: LABEL_TOOL_REQUEST_USER_2,
            sequenceStart: 4,
            sequenceEnd: 4,
            createdAt: '2026-04-13T15:00:04Z',
            title: '请求课程表单',
            summary: '请填写课程编码。',
            resultSummary: DESC_CN_012,
            formRequest: {
              formId: LABEL_COURSE_FORM,
              title: '请求课程表单',
              submitLabel: '提交',
              fields: [{
                name: 'courseCode',
                label: '课程编码',
                type: 'text',
                required: true,
              }],
            },
            phases: [{
              phase: 'completed',
              sequence: 4,
              createdAt: '2026-04-13T15:00:04Z',
              title: '请求课程表单',
              summary: '请填写课程编码。',
              resultSummary: DESC_CN_012,
              formRequest: {
                formId: LABEL_COURSE_FORM,
                title: '请求课程表单',
                submitLabel: '提交',
                fields: [{
                  name: 'courseCode',
                  label: '课程编码',
                  type: 'text',
                  required: true,
                }],
              },
            }],
          },
          {
            kind: 'user_message',
            runId: LABEL_RUN_FORM_HISTORY,
            threadId: 'thread-1',
            sequenceStart: 5,
            sequenceEnd: 5,
            createdAt: '2026-04-13T15:00:05Z',
            text: '已提交表单：请求课程表单\n课程编码: CS304',
            structuredPayload: {
              type: 'inline_form_submission',
              toolId: LABEL_TOOL_REQUEST_USER_2,
              toolCallId: LABEL_TOOL_REQUEST_USER,
              formId: LABEL_COURSE_FORM,
              values: {
                courseCode: 'CS304',
              },
            },
          },
        ],
        runSummaries: [{
          runId: LABEL_RUN_FORM_HISTORY,
          threadId: 'thread-1',
          status: 'completed',
          createdAt: LABEL_2026_13T15_2,
          updatedAt: '2026-04-13T15:00:08Z',
          startedAt: LABEL_2026_13T15,
          terminalAt: '2026-04-13T15:00:08Z',
          resolvedModelId: LABEL_OPENAI_GPT,
          requestedMessageText: '需要课程筛选条件',
          assistantText: '已收到课程编码。',
        }],
        replayStatus: 'ready',
        replay: createRunReplayResult({
          run: {
            runId: LABEL_RUN_FORM_HISTORY,
            requestedMessageText: '需要课程筛选条件',
            assistantText: '已收到课程编码。',
          },
          historicalSnapshot: {
            requestMessage: {
              role: 'user',
              content: '需要课程筛选条件',
            },
          },
          orderedEvents: [{
            eventType: 'run_completed',
            sequence: 8,
            createdAt: '2026-04-13T15:00:08Z',
            payload: {
              assistantMessageId: 'run-form-history:assistant',
              assistantText: '已收到课程编码。',
              resolvedModelId: LABEL_OPENAI_GPT,
              resolvedModelRoute: {},
              resolvedToolIds: [],
              requestOptions: {},
            },
            toolCallId: null,
            toolId: null,
            phase: null,
            isRedacted: false,
            redactionVersion: 0,
          }],
        }),
      }))

      expect(conversation.selectedRunConversationSource).toBe('timeline')
      expect(conversation.conversation.some((item) => item.kind === 'reasoning' && item.observedFinishedAt !== item.observedStartedAt)).toBe(true)
      expect(conversation.conversation.some((item) => item.kind === LABEL_INLINE_FORM && item.formState === 'submitted')).toBe(true)
      expect(conversation.conversation.some((item) => item.kind === 'user' && item.structuredPayload !== undefined)).toBe(true)
    })

    it('keeps replay history when replay already contains timeline reasoning capability', () => {
      const conversation = buildPersistedConversationFromHistory(createPersistedHistoryState({
        hasLoadedDetail: true,
        detailStatus: 'ready',
        selectedRunId: LABEL_RUN_REASONING_HISTORY,
        timelineItems: [
          {
            kind: 'user_message',
            runId: LABEL_RUN_REASONING_HISTORY,
            threadId: 'thread-1',
            sequenceStart: 0,
            sequenceEnd: 0,
            createdAt: LABEL_2026_13T15_2,
            text: '需要分析历史来源',
          },
          {
            kind: 'reasoning_block',
            runId: LABEL_RUN_REASONING_HISTORY,
            threadId: 'thread-1',
            sequenceStart: 1,
            sequenceEnd: 1,
            createdAt: LABEL_2026_13T15,
            endedAt: LABEL_2026_13T15_5,
            text: '时间线推理内容。',
          },
        ],
        runSummaries: [{
          runId: LABEL_RUN_REASONING_HISTORY,
          threadId: 'thread-1',
          status: 'completed',
          createdAt: LABEL_2026_13T15_2,
          updatedAt: LABEL_2026_13T15_4,
          startedAt: LABEL_2026_13T15,
          terminalAt: LABEL_2026_13T15_4,
          resolvedModelId: LABEL_OPENAI_GPT,
          requestedMessageText: '需要分析历史来源',
          assistantText: '回放回复。',
        }],
        replayStatus: 'ready',
        replay: createRunReplayResult({
          run: {
            runId: LABEL_RUN_REASONING_HISTORY,
            requestedMessageText: '需要分析历史来源',
            assistantText: '回放回复。',
          },
          orderedEvents: [
            {
              eventType: 'reasoning_delta',
              sequence: 1,
              createdAt: LABEL_2026_13T15,
              payload: {
                delta: '回放推理内容。',
              },
              toolCallId: null,
              toolId: null,
              phase: null,
              isRedacted: false,
              redactionVersion: 0,
            },
            {
              eventType: 'text_delta',
              sequence: 2,
              createdAt: LABEL_2026_13T15_5,
              payload: {
                assistantMessageId: 'run-reasoning-history:assistant',
                delta: '回放回复。',
              },
              toolCallId: null,
              toolId: null,
              phase: null,
              isRedacted: false,
              redactionVersion: 0,
            },
            {
              eventType: 'run_completed',
              sequence: 3,
              createdAt: LABEL_2026_13T15_4,
              payload: {
                assistantMessageId: 'run-reasoning-history:assistant',
                assistantText: '回放回复。',
                resolvedModelId: LABEL_OPENAI_GPT,
                resolvedToolIds: [],
                requestOptions: {},
              },
              toolCallId: null,
              toolId: null,
              phase: null,
              isRedacted: false,
              redactionVersion: 0,
            },
          ],
        }),
      }))

      expect(conversation.selectedRunConversationSource).toBe('replay')
      expect(conversation.conversation.some((item) => item.kind === 'reasoning' && item.content === '回放推理内容。')).toBe(true)
      expect(conversation.conversation.some((item) => item.kind === 'reasoning' && item.content === '时间线推理内容。')).toBe(false)
    })
  })

  /* eslint-disable-next-line max-lines-per-function -- integration tests for structured payload, inline form rendering, and form rebuildability from persisted history */
  describe('structured payload and inline forms', () => {
    it('preserves missing null and object structuredPayload states in timeline user messages', () => {
      const conversation = buildPersistedConversationFromHistory(createPersistedHistoryState({
        hasLoadedDetail: true,
        detailStatus: 'ready',
        selectedRunId: null,
        timelineItems: [
          {
            kind: 'user_message',
            runId: 'run-structured-history',
            threadId: 'thread-1',
            sequenceStart: 0,
            sequenceEnd: 0,
            createdAt: LABEL_2026_13T15_2,
            text: '普通历史消息',
          },
          {
            kind: 'user_message',
            runId: 'run-structured-history',
            threadId: 'thread-1',
            sequenceStart: 1,
            sequenceEnd: 1,
            createdAt: LABEL_2026_13T15,
            text: '显式空结构化载荷消息',
            structuredPayload: null,
          },
          {
            kind: 'user_message',
            runId: 'run-structured-history',
            threadId: 'thread-1',
            sequenceStart: 2,
            sequenceEnd: 2,
            createdAt: LABEL_2026_13T15_5,
            text: '表单提交消息',
            structuredPayload: {
              type: 'inline_form_submission',
              formId: LABEL_COURSE_FORM,
            },
          },
        ],
        replayStatus: 'idle',
        replay: null,
      }))
      const userItems = conversation.conversation.filter((item) => item.kind === 'user')

      expect(Object.prototype.hasOwnProperty.call(userItems[0], 'structuredPayload')).toBe(false)
      expect(userItems[1]).toMatchObject({ structuredPayload: null })
      expect(userItems[2]).toMatchObject({
        structuredPayload: {
          type: 'inline_form_submission',
          formId: LABEL_COURSE_FORM,
        },
      })
    })

    it('rebuilds an unsubmitted pending inline form from persisted timeline history', () => {
      const history = createPersistedHistoryState({
        hasLoadedDetail: true,
        detailStatus: 'ready',
        selectedRunId: LABEL_RUN_FORM_PENDING,
        timelineItems: [
          {
            kind: 'user_message',
            runId: LABEL_RUN_FORM_PENDING,
            threadId: 'thread-1',
            sequenceStart: 0,
            sequenceEnd: 0,
            createdAt: LABEL_2026_13T15_2,
            text: '需要课程筛选条件',
            structuredPayload: null,
          },
          {
            kind: 'tool_call_block',
            runId: LABEL_RUN_FORM_PENDING,
            threadId: 'thread-1',
            toolCallId: LABEL_TOOL_REQUEST_USER,
            toolId: LABEL_TOOL_REQUEST_USER_2,
            sequenceStart: 1,
            sequenceEnd: 1,
            createdAt: LABEL_2026_13T15,
            title: '请求课程表单',
            summary: '请填写课程编码。',
            resultSummary: DESC_CN_012,
            formRequest: {
              formId: LABEL_COURSE_FORM,
              title: '请求课程表单',
              submitLabel: '提交',
              fields: [{
                name: 'courseCode',
                label: '课程编码',
                type: 'text',
                required: true,
              }],
            },
            phases: [{
              phase: 'completed',
              sequence: 1,
              createdAt: LABEL_2026_13T15,
              title: '请求课程表单',
              summary: '请填写课程编码。',
              resultSummary: DESC_CN_012,
              formRequest: {
                formId: LABEL_COURSE_FORM,
                title: '请求课程表单',
                submitLabel: '提交',
                fields: [{
                  name: 'courseCode',
                  label: '课程编码',
                  type: 'text',
                  required: true,
                }],
              },
            }],
          },
        ],
        runSummaries: [{
          runId: LABEL_RUN_FORM_PENDING,
          threadId: 'thread-1',
          status: 'failed',
          createdAt: LABEL_2026_13T15_2,
          updatedAt: LABEL_2026_13T15_4,
          startedAt: LABEL_2026_13T15,
          terminalAt: LABEL_2026_13T15_4,
          resolvedModelId: LABEL_OPENAI_GPT,
          requestedMessageText: '需要课程筛选条件',
          assistantText: '请填写课程编码。',
        }],
        replayStatus: 'idle',
        replay: null,
      })

      const conversation = buildPersistedConversationFromHistory(history)
      const rebuildability = getPersistedInlineFormRebuildability(history)

      expect(conversation.selectedRunConversationSource).toBe('timeline')
      expect(conversation.conversation.some((item) => item.kind === LABEL_INLINE_FORM && item.formState === 'pending')).toBe(true)
      expect(conversation.conversation.some((item) => item.kind === 'user' && item.content === '需要课程筛选条件')).toBe(true)
      expect(rebuildability).toMatchObject({
        hasInlineForm: true,
        hasPendingInlineForm: true,
      })
    })

    it('does not treat summary-only persisted history as sufficient for awaiting-input runs with pending inline forms', () => {
      const sessionHistory = createPersistedHistoryState({
        hasLoadedDetail: true,
        detailStatus: 'ready',
        selectedRunId: LABEL_RUN_FORM_PENDING,
        timelineItems: [{
          kind: 'user_message',
          runId: LABEL_RUN_FORM_PENDING,
          threadId: 'thread-1',
          sequenceStart: 0,
          sequenceEnd: 0,
          createdAt: LABEL_2026_13T15_2,
          text: '需要课程筛选条件',
          structuredPayload: null,
        }],
        runSummaries: [{
          runId: LABEL_RUN_FORM_PENDING,
          threadId: 'thread-1',
          status: 'failed',
          createdAt: LABEL_2026_13T15_2,
          updatedAt: LABEL_2026_13T15_4,
          startedAt: LABEL_2026_13T15,
          terminalAt: LABEL_2026_13T15_4,
          resolvedModelId: LABEL_OPENAI_GPT,
          requestedMessageText: '需要课程筛选条件',
          assistantText: '请填写课程编码。',
        }],
        replayStatus: 'idle',
        replay: null,
      })
      const runState = {
        ...createIdleCopilotRunState(),
        phase: 'awaiting_input' as const,
        runId: LABEL_RUN_FORM_PENDING,
        threadId: 'thread-1',
        segments: [{
          id: 'inline-form:run-form-pending-history:tool.request-user-form:call-1',
          kind: LABEL_INLINE_FORM as 'inline-form',
          runId: LABEL_RUN_FORM_PENDING,
          startedSequence: 1,
          lastSequence: 1,
          status: 'completed' as const,
          toolCallId: LABEL_TOOL_REQUEST_USER,
          toolId: LABEL_TOOL_REQUEST_USER_2,
          formId: LABEL_COURSE_FORM,
          title: '请求课程表单',
          summary: '请填写课程编码。',
          description: null,
          submitLabel: '提交',
          fields: [{
            name: 'courseCode',
            label: '课程编码',
            type: 'text' as const,
            required: true,
          }],
          formState: 'pending' as const,
          formValues: {
            courseCode: '',
          },
          submittedPayload: null,
        }],
      }
      const persistedConversation = buildPersistedConversationFromHistory(sessionHistory)

      expect(hasSufficientPersistedConversationForRun({
        conversation: persistedConversation.conversation,
        runId: LABEL_RUN_FORM_PENDING,
        runPhase: 'awaiting_input',
        sessionHistory,
        runState,
      })).toBe(false)

      expect(resolvePersistedConversationHandoffWaitReason({
        conversation: persistedConversation.conversation,
        pendingRunId: LABEL_RUN_FORM_PENDING,
        runState,
        sessionHistory,
      })).toBe('awaiting-input-inline-form-missing-from-handoff')
    })

    /* eslint-disable-next-line max-lines-per-function -- complex integration test for inline-form handoff resolution from persisted history state */
    it('allows handoff when persisted history can rebuild the pending inline form for awaiting-input runs', () => {
      const sessionHistory = createPersistedHistoryState({
        hasLoadedDetail: true,
        detailStatus: 'ready',
        selectedRunId: LABEL_RUN_FORM_PENDING,
        timelineItems: [
          {
            kind: 'user_message',
            runId: LABEL_RUN_FORM_PENDING,
            threadId: 'thread-1',
            sequenceStart: 0,
            sequenceEnd: 0,
            createdAt: LABEL_2026_13T15_2,
            text: '需要课程筛选条件',
            structuredPayload: null,
          },
          {
            kind: 'tool_call_block',
            runId: LABEL_RUN_FORM_PENDING,
            threadId: 'thread-1',
            toolCallId: LABEL_TOOL_REQUEST_USER,
            toolId: LABEL_TOOL_REQUEST_USER_2,
            sequenceStart: 1,
            sequenceEnd: 1,
            createdAt: LABEL_2026_13T15,
            title: '请求课程表单',
            summary: '请填写课程编码。',
            resultSummary: DESC_CN_012,
            formRequest: {
              formId: LABEL_COURSE_FORM,
              title: '请求课程表单',
              submitLabel: '提交',
              fields: [{
                name: 'courseCode',
                label: '课程编码',
                type: 'text',
                required: true,
              }],
            },
            phases: [{
              phase: 'completed',
              sequence: 1,
              createdAt: LABEL_2026_13T15,
              title: '请求课程表单',
              summary: '请填写课程编码。',
              resultSummary: DESC_CN_012,
              formRequest: {
                formId: LABEL_COURSE_FORM,
                title: '请求课程表单',
                submitLabel: '提交',
                fields: [{
                  name: 'courseCode',
                  label: '课程编码',
                  type: 'text',
                  required: true,
                }],
              },
            }],
          },
        ],
        runSummaries: [{
          runId: LABEL_RUN_FORM_PENDING,
          threadId: 'thread-1',
          status: 'failed',
          createdAt: LABEL_2026_13T15_2,
          updatedAt: LABEL_2026_13T15_4,
          startedAt: LABEL_2026_13T15,
          terminalAt: LABEL_2026_13T15_4,
          resolvedModelId: LABEL_OPENAI_GPT,
          requestedMessageText: '需要课程筛选条件',
          assistantText: '请填写课程编码。',
        }],
        replayStatus: 'idle',
        replay: null,
      })
      const runState = {
        ...createIdleCopilotRunState(),
        phase: 'awaiting_input' as const,
        runId: LABEL_RUN_FORM_PENDING,
        threadId: 'thread-1',
        segments: [{
          id: 'inline-form:run-form-pending-history:tool.request-user-form:call-1',
          kind: LABEL_INLINE_FORM as 'inline-form',
          runId: LABEL_RUN_FORM_PENDING,
          startedSequence: 1,
          lastSequence: 1,
          status: 'completed' as const,
          toolCallId: LABEL_TOOL_REQUEST_USER,
          toolId: LABEL_TOOL_REQUEST_USER_2,
          formId: LABEL_COURSE_FORM,
          title: '请求课程表单',
          summary: '请填写课程编码。',
          description: null,
          submitLabel: '提交',
          fields: [{
            name: 'courseCode',
            label: '课程编码',
            type: 'text' as const,
            required: true,
          }],
          formState: 'pending' as const,
          formValues: {
            courseCode: '',
          },
          submittedPayload: null,
        }],
      }
      const persistedConversation = buildPersistedConversationFromHistory(sessionHistory)

      expect(hasSufficientPersistedConversationForRun({
        conversation: persistedConversation.conversation,
        runId: LABEL_RUN_FORM_PENDING,
        runPhase: 'awaiting_input',
        sessionHistory,
        runState,
      })).toBe(true)

      expect(resolvePersistedConversationHandoffWaitReason({
        conversation: persistedConversation.conversation,
        pendingRunId: LABEL_RUN_FORM_PENDING,
        runState,
        sessionHistory,
      })).toBeNull()
    })
  })

  describe('loading and error states', () => {
    it('keeps restored history visible while the directory is still loading if a session is already active', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell({
            capabilities: {
              capabilitiesVersion: LABEL_HISTORY_SHELL,
            },
          })}
          directoryState={{
            ...createDirectoryState(),
            status: 'loading',
          }}
          sessionStatus="idle"
          sessionError={null}
          sessionHistory={createPersistedHistoryState({
            hasLoadedDetail: true,
            detailStatus: 'ready',
            selectedRunId: null,
            timelineItems: [
              {
                kind: 'assistant_message',
                runId: 'run-startup',
                sequenceStart: 1,
                text: '启动恢复的历史消息应立即可见。',
              },
            ],
            replayStatus: 'idle',
          })}
        />,
      )

      expect(html).toContain(SELECTOR_DATA_TESTID_CHAT)
      expect(html).toContain('启动恢复的历史消息应立即可见。')
      expect(html).not.toContain('正在加载助手列表')
    })

    it('shows persisted capability hydration failures as a visible retryable notice and disables send', async () => {
      const retrySessionHistory = vi.fn()
      const rendered = renderWithRoot(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell({
            capabilities: {
              capabilitiesVersion: LABEL_HISTORY_SHELL,
            },
          })}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
          sessionHistory={createPersistedHistoryState({
            hasLoadedDetail: true,
            detailStatus: 'ready',
            capabilitiesStatus: 'error',
            capabilitiesError: 'capabilities unavailable',
          })}
          retrySessionHistory={retrySessionHistory}
        />,
      )

      expect(rendered.getByTestId('chat-history-capabilities-error').textContent).toContain('历史线程能力恢复失败，请重试后再继续发送。')
      expect((rendered.getByTestId('chat-composer-send-button') as HTMLButtonElement).disabled).toBe(true)

      await clickElement(rendered.getByTestId('chat-history-capabilities-retry-button'))

      expect(retrySessionHistory).toHaveBeenCalledOnce()

      rendered.unmount()
    })

    it('keeps the non-connected branch intact for empty state', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createEmptyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={null}
          sessionShell={null}
          directoryState={createIdleDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
        />,
      )

      expect(html).toContain('尚未连接服务')
      expect(html).toContain('服务地址')
      expect(html).not.toContain('session-1')
    })

    it('keeps the failed branch intact and does not swallow startup failures', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createFailedState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={null}
          sessionShell={null}
          directoryState={createIdleDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
        />,
      )

      expect(html).toContain('连接服务失败')
      expect(html).toContain('重试连接')
      expect(html).toContain('当前无法连接服务，请重试。')
      expect(html).not.toContain('当前 threadId')
    })
  })
})

function createRunReplayResult(overrides: {
  run?: Partial<CopilotHistoryRunReplaySuccess['run']>
  historicalSnapshot?: Record<string, unknown> | null
  orderedEvents?: CopilotHistoryRunReplaySuccess['orderedEvents']
} = {}): CopilotHistoryRunReplaySuccess {
  return {
    ok: true,
    version: 'chat-history-v1',
    run: {
      runId: 'run-1',
      threadId: 'thread-1',
      status: 'completed',
      createdAt: LABEL_2026_13T15_2,
      updatedAt: LABEL_2026_13T15_3,
      startedAt: LABEL_2026_13T15,
      terminalAt: LABEL_2026_13T15_3,
      resolvedModelId: LABEL_OPENAI_GPT,
      requestedMessageText: '你好',
      assistantText: '历史摘要',
      ...overrides.run,
    },
    historicalSnapshot: overrides.historicalSnapshot ?? null,
    orderedEvents: overrides.orderedEvents ?? [],
    toolCallBlocks: [],
    diagnosticBlocks: [],
    terminalState: null,
    availabilityInterpretation: null,
  }
}

function createPersistedHistoryState(
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
      createdAt: LABEL_2026_13T15_2,
      updatedAt: LABEL_2026_13T15_3,
      lastActivityAt: LABEL_2026_13T15_3,
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
