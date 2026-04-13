/** @vitest-environment jsdom */

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithRoot } from './CopilotChatPanel.test-support'
import { clickElement } from './copilot-chat-test-interactions'
import { ErrorDetailOverlay } from './ErrorDetailOverlay'
import { buildErrorDetailOverlayViewModel, createCopilotErrorDetailSource } from './error-detail-overlay-view-model'

function createViewModel(details: Record<string, unknown> = {
  toolId: 'tool.weather-current',
}) {
  return buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
    source: 'streaming',
    title: '发送失败',
    summaryMessage: '工具执行失败，请重试。',
    rawMessage: 'Tool failed: boom',
    code: 'tool_execution_failed',
    stage: 'streaming',
    requestedMethod: 'run/stream',
    details,
    resolvedModelId: 'openai/gpt-4.1',
    resolvedToolIds: ['tool.weather-current'],
    requestOptions: {
      trace: true,
    },
  }))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ErrorDetailOverlay', () => {
  it('renders grouped content and the restrained empty state contract', () => {
    const rendered = renderWithRoot(
      <ErrorDetailOverlay
        viewModel={createViewModel()}
        onClose={vi.fn()}
      />,
    )

    expect(rendered.getByTestId('error-detail-overlay').textContent).toContain('错误详情')
    expect(rendered.getByTestId('error-detail-overlay-group-summary').textContent).toContain('摘要')
    expect(rendered.getByTestId('error-detail-overlay-group-request-context').textContent).toContain('请求 / 运行上下文')
    expect(rendered.getByTestId('error-detail-overlay-group-tool-model-context').textContent).toContain('工具 / 模型上下文')
    expect(rendered.getByTestId('error-detail-overlay-group-raw-details').textContent).toContain('原始详情')
    expect(rendered.queryByTestId('error-detail-overlay-empty-state')).toBeNull()

    rendered.unmount()
  })

  it('closes on backdrop click and close button', async () => {
    const onClose = vi.fn()
    const rendered = renderWithRoot(
      <ErrorDetailOverlay
        viewModel={createViewModel()}
        onClose={onClose}
      />,
    )

    await clickElement(rendered.getByTestId('error-detail-overlay-close'))
    expect(onClose).toHaveBeenCalledTimes(1)

    await clickElement(rendered.getByTestId('error-detail-overlay'))
    expect(onClose).toHaveBeenCalledTimes(2)

    rendered.unmount()
  })

  it('copies the full summary and individual groups through the clipboard helper', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async (_text) => undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText,
      },
    })

    const rendered = renderWithRoot(
      <ErrorDetailOverlay
        viewModel={createViewModel()}
        onClose={vi.fn()}
      />,
    )

    await clickElement(rendered.getByTestId('error-detail-overlay-copy-all'))
    await clickElement(rendered.getByTestId('error-detail-overlay-group-copy-summary'))

    expect(writeText).toHaveBeenCalledTimes(2)
    const summaryCopyText = writeText.mock.calls[0]?.[0] ?? ''
    const groupCopyText = writeText.mock.calls[1]?.[0] ?? ''
    expect(summaryCopyText).toContain('错误详情')
    expect(summaryCopyText).toContain('[摘要]')
    expect(groupCopyText).toContain('[摘要]')
    expect(groupCopyText).not.toContain('[原始详情]')

    rendered.unmount()
  })

  it('renders structured json for raw details while keeping non-json text blocks plain', async () => {
    const rendered = renderWithRoot(
      <ErrorDetailOverlay
        viewModel={createViewModel({
          toolId: 'tool.weather-current',
          retryable: false,
          nested: {
            attempt: 1,
            reason: 'network',
          },
        })}
        onClose={vi.fn()}
      />,
    )

    const rawDetailsJson = rendered.getByTestId('error-detail-overlay-raw-details-json')
    expect(rawDetailsJson.getAttribute('data-json-viewer')).toMatch(/react18-json-view|fallback/)
    expect(rawDetailsJson.textContent).toContain('toolId')
    expect(rawDetailsJson.textContent).toContain('tool.weather-current')
    expect(rendered.queryByTestId('error-detail-overlay-raw-details-text')).toBeNull()
    expect(rendered.getByTestId('error-detail-overlay-group-raw-details').textContent).toContain('Tool failed: boom')

    rendered.unmount()
  })

  it('traps focus within the dialog when tabbing forward and backward', async () => {
    const rendered = renderWithRoot(
      <ErrorDetailOverlay
        viewModel={createViewModel()}
        onClose={vi.fn()}
      />,
    )

    const copyAllButton = rendered.getByTestId('error-detail-overlay-copy-all') as HTMLButtonElement
    const lastGroupCopyButton = rendered.getByTestId('error-detail-overlay-group-copy-raw-details') as HTMLButtonElement

    await act(async () => {
      lastGroupCopyButton.focus()
      lastGroupCopyButton.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Tab',
      }))
    })

    expect(document.activeElement).toBe(copyAllButton)

    await act(async () => {
      copyAllButton.focus()
      copyAllButton.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Tab',
        shiftKey: true,
      }))
    })

    expect(document.activeElement).toBe(lastGroupCopyButton)

    rendered.unmount()
  })

  it('clears stale summary copy reset timers before scheduling a new one', async () => {
    vi.useFakeTimers()

    const writeText = vi.fn<(text: string) => Promise<void>>(async (_text) => undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText,
      },
    })

    const rendered = renderWithRoot(
      <ErrorDetailOverlay
        viewModel={createViewModel()}
        onClose={vi.fn()}
      />,
    )

    const copyAllButton = rendered.getByTestId('error-detail-overlay-copy-all') as HTMLButtonElement

    await clickElement(copyAllButton)
    expect(copyAllButton.textContent).toBe('已复制')

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    await clickElement(copyAllButton)
    expect(copyAllButton.textContent).toBe('已复制')

    await act(async () => {
      vi.advanceTimersByTime(1500)
    })

    expect(copyAllButton.textContent).toBe('已复制')

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(copyAllButton.textContent).toBe('复制全部')

    rendered.unmount()
  })

  it('renders the minimal empty-state copy when only the summary group exists', () => {
    const viewModel = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
      source: 'preflight',
      title: '发送失败',
      summaryMessage: '请输入消息内容后再发送。',
    }))

    const rendered = renderWithRoot(
      <ErrorDetailOverlay
        viewModel={viewModel}
        onClose={vi.fn()}
      />,
    )

    expect(rendered.getByTestId('error-detail-overlay-group-summary').textContent).toContain('请输入消息内容后再发送。')
    expect(rendered.getByTestId('error-detail-overlay-empty-state').textContent).toContain('暂无更多详情')

    rendered.unmount()
  })
})
