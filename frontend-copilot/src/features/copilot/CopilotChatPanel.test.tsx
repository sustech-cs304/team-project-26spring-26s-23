/** @vitest-environment jsdom */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
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

describe('CopilotChatPanel', () => {
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

    expect(html).toContain('data-testid="chat-message-scroll-region"')
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
    expect(html.indexOf('data-testid="chat-message-scroll-region"')).toBeLessThan(
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

  it('shows a lightweight skeleton while persisted history detail is still loading', () => {
    const html = renderToStaticMarkup(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell({
          capabilities: {
            capabilitiesVersion: 'history-shell',
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

    expect(html).toContain('data-testid="chat-history-loading-skeleton"')
    expect(html).not.toContain('data-testid="chat-history-retry-button"')
    expect(html).not.toContain('data-testid="chat-message-scroll-region"')
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

    expect(html).toContain('data-testid="chat-message-scroll-region"')
    expect(html).not.toContain('data-testid="chat-history-loading-skeleton"')
    expect(html).not.toContain('data-testid="chat-history-retry-button"')
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
            capabilitiesVersion: 'history-shell',
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

    expect(html).toContain('data-testid="chat-message-scroll-region"')
    expect(html).toContain('历史消息已恢复')
    expect(html).not.toContain('data-testid="chat-history-loading-skeleton"')
    expect(html).not.toContain('data-testid="chat-history-retry-button"')
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
            capabilitiesVersion: 'history-shell',
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

    expect(html).toContain('data-testid="chat-message-scroll-region"')
    expect(html).toContain('保留上一版成功内容')
    expect(html).not.toContain('data-testid="chat-history-loading-skeleton"')
    expect(html).not.toContain('data-testid="chat-history-retry-button"')
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
            capabilitiesVersion: 'history-shell',
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
            capabilitiesVersion: 'history-shell',
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
      />,
    )

    expect(rendered.getByTestId('chat-history-replay-error').textContent).toContain('当前运行回放失败')
    expect(rendered.container.textContent).toContain('回放失败时仍保留时间线快照')

    await clickElement(rendered.getByTestId('chat-history-replay-retry-button'))

    expect(retrySessionHistory).toHaveBeenCalledOnce()

    rendered.unmount()
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
            capabilitiesVersion: 'history-shell',
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
