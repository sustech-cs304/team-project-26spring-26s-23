/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { CopilotMessageList } from './CopilotMessageList'
import type { CopilotMessageListItem } from './run-segment-view-model'

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

describe('CopilotMessageList reasoning card', () => {
  it('updates the reasoning timer while streaming and freezes it after completion', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_500)

    const rendered = renderWithRoot(
      <CopilotMessageList conversation={[createReasoningConversationItem({ status: 'streaming' })]} />,
    )

    expect(rendered.container.textContent).toContain('思考 0.5s')
    expect(rendered.container.textContent).toContain('生成中')

    await act(async () => {
      vi.advanceTimersByTime(800)
    })

    expect(rendered.container.textContent).toContain('思考 1.3s')

    vi.setSystemTime(4_900)
    await act(async () => {
      rendered.root.render(
        <CopilotMessageList
          conversation={[
            createReasoningConversationItem({
              status: 'completed',
              observedFinishedAt: 2_345,
            }),
          ]}
        />,
      )
    })

    expect(rendered.container.textContent).toContain('思考 1.3s')
    expect(rendered.container.textContent).not.toContain('生成中')

    await act(async () => {
      vi.advanceTimersByTime(2_000)
    })

    expect(rendered.container.textContent).toContain('思考 1.3s')

    rendered.unmount()
  })

  it('renders reasoning content with the assistant markdown stack while keeping collapse interaction', async () => {
    const rendered = renderWithRoot(
      <CopilotMessageList conversation={[
        createReasoningConversationItem({
          status: 'completed',
          observedFinishedAt: 2_345,
          content: '**重点**\n\n- 列表项\n\n`代码`',
        }),
      ]} />,
    )

    expect(rendered.queryByTestId('chat-message-reasoning-panel-0')).toBeNull()

    await clickElement(rendered.getByTestId('chat-message-reasoning-toggle-0'))

    const panel = rendered.getByTestId('chat-message-reasoning-panel-0')
    expect(panel.querySelector('.copilot-chat__message-text--markdown')).not.toBeNull()
    expect(panel.innerHTML).toContain('<strong>重点</strong>')
    expect(panel.innerHTML).toContain('<ul>')
    expect(panel.innerHTML).toContain('<code>代码</code>')

    await clickElement(rendered.getByTestId('chat-message-reasoning-toggle-0'))

    expect(rendered.queryByTestId('chat-message-reasoning-panel-0')).toBeNull()

    rendered.unmount()
  })
})

function createReasoningConversationItem(input: {
  status: 'streaming' | 'completed'
  observedFinishedAt?: number | null
  content?: string
}): CopilotMessageListItem {
  return {
    id: 'reasoning:test:1',
    kind: 'reasoning',
    runId: 'run-test',
    sequence: 1,
    title: '思考',
    content: input.content ?? '正在分析。',
    observedStartedAt: 1_000,
    observedFinishedAt: input.observedFinishedAt ?? null,
    status: input.status,
    isCollapsedByDefault: true,
  }
}

function renderWithRoot(element: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(element)
  })

  return {
    container,
    root,
    getByTestId(testId: string) {
      const target = container.querySelector(`[data-testid="${testId}"]`)
      if (target === null) {
        throw new Error(`Missing element for data-testid=${testId}`)
      }

      return target as HTMLElement
    },
    queryByTestId(testId: string) {
      return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}
