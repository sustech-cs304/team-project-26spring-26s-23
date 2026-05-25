/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

describe('CopilotMessageList specialized tool cards', () => {
  it('renders file read tools with a semantic reading card instead of raw JSON chrome', async () => {
    const rendered = renderWithRoot(
      <CopilotMessageList
        conversation={[createToolMessageItem({
          id: 'tool:run-file:tool.fs.read:call-1',
          status: 'streaming',
          toolId: 'tool.fs.read',
          title: '读取文件工具调用中',
          content: JSON.stringify({
            status: 'success',
            output: {
              path: 'frontend-copilot/src/App.tsx',
              sizeBytes: 2048,
              lineCount: 80,
              offset: 1,
              endLine: 80,
            },
          }),
          inputSummary: JSON.stringify({
            path: 'frontend-copilot/src/App.tsx',
            offset: 1,
            limit: 80,
          }),
        })]}
      />,
    )

    expect(rendered.container.textContent).toContain('正在阅读 1 个文件')
    expect(rendered.container.querySelector('.copilot-chat__step-icon--file')).not.toBeNull()

    await clickElement(rendered.getByTestId('chat-message-tool-toggle-0'))

    const specializedPanel = rendered.getByTestId('chat-message-tool-specialized-0')
    expect(specializedPanel.textContent).toContain('文件阅读')
    expect(specializedPanel.textContent).toContain('App.tsx')
    expect(specializedPanel.textContent).toContain('frontend-copilot/src/App.tsx')
    expect(specializedPanel.textContent).toContain('2.0 KB')
    expect(rendered.queryByTestId('chat-message-tool-output-0-json')).toBeNull()
    expect(rendered.queryByTestId('chat-message-tool-input-toggle-0')).toBeNull()

    rendered.unmount()
  })

  it('keeps unknown tools on the default expandable JSON renderer', async () => {
    const rendered = renderWithRoot(
      <CopilotMessageList
        conversation={[createToolMessageItem({
          id: 'tool:run-unknown:mcp.example.search:call-1',
          status: 'completed',
          toolId: 'mcp.example.search',
          title: '外部工具已返回结果',
          content: JSON.stringify({ ok: true, result: 'done' }),
          inputSummary: JSON.stringify({ query: 'candue' }),
        })]}
      />,
    )

    expect(rendered.container.textContent).toContain('外部工具被调用')

    await clickElement(rendered.getByTestId('chat-message-tool-toggle-0'))

    expect(rendered.queryByTestId('chat-message-tool-specialized-0')).toBeNull()
    expect(rendered.getByTestId('chat-message-tool-output-0-json')).not.toBeNull()
    expect(rendered.getByTestId('chat-message-tool-input-toggle-0')).not.toBeNull()

    rendered.unmount()
  })

  it('renders browser and SQL tools with domain-specific titles and panels', async () => {
    const rendered = renderWithRoot(
      <CopilotMessageList
        conversation={[
          createToolMessageItem({
            id: 'tool:run-browser:browser.open:call-1',
            status: 'completed',
            toolId: 'browser.open',
            title: '浏览器打开工具已返回结果',
            content: JSON.stringify({
              output: {
                url: 'https://example.com/course',
                title: 'Course Portal',
              },
            }),
            inputSummary: JSON.stringify({ url: 'https://example.com/course' }),
          }),
          createToolMessageItem({
            id: 'tool:run-sql:calendar.sql.query:call-1',
            status: 'completed',
            toolId: 'calendar.sql.query',
            title: '日历 SQL 查询工具已返回结果',
            content: JSON.stringify({
              output: {
                rowCount: 2,
                columns: ['title', 'starts_at'],
                rows: [
                  { title: 'Lecture', starts_at: '2026-05-01' },
                  { title: 'Lab', starts_at: '2026-05-02' },
                ],
              },
            }),
            inputSummary: JSON.stringify({ sql: 'select title, starts_at from events limit 2' }),
          }),
        ]}
      />,
    )

    expect(rendered.container.textContent).toContain('已打开网页')
    expect(rendered.container.textContent).toContain('查询完成（2 行）')

    await clickElement(rendered.getByTestId('chat-message-tool-toggle-0'))
    await clickElement(rendered.getByTestId('chat-message-tool-toggle-1'))

    expect(rendered.getByTestId('chat-message-tool-specialized-0').textContent).toContain('Course Portal')
    expect(rendered.getByTestId('chat-message-tool-specialized-1').textContent).toContain('SQL')
    expect(rendered.getByTestId('chat-message-tool-specialized-1').textContent).toContain('select title')

    rendered.unmount()
  })
})

function createToolMessageItem(input: {
  id: string
  status: 'streaming' | 'completed' | 'failed' | 'cancelled'
  toolId: string
  title: string
  content: string
  inputSummary: string | null
}): CopilotMessageListItem {
  return {
    id: input.id,
    kind: 'tool',
    runId: 'run-tools',
    sequence: 1,
    status: input.status,
    toolCallId: `${input.toolId}:call-1`,
    toolId: input.toolId,
    toolPhase: input.status === 'streaming' ? 'started' : input.status,
    title: input.title,
    content: input.content,
    inputSummary: input.inputSummary,
    resultSummary: input.content,
    errorSummary: null,
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

async function clickElement(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}
