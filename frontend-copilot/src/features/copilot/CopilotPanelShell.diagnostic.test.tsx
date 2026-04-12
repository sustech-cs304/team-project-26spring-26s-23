/** @vitest-environment jsdom */

import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

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

describe('CopilotPanelShell diagnostic visibility', () => {
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
