/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  })
})

describe('CopilotMessageList code block controls', () => {
  it('copies code text and toggles horizontal scrolling mode', async () => {
    const clipboardWriteText = mockClipboardWriteText()
    const rendered = renderWithRoot(
      <CopilotMessageList conversation={[createAssistantCodeBlockConversationItem('```ts\nconst answer = 42\nconsole.log(answer)\n```')]} />,
    )

    try {
      const codeBlock = rendered.container.querySelector('.copilot-chat__code-block') as HTMLElement
      const copyButton = codeBlock.querySelector('[data-code-block-action="copy"]') as HTMLButtonElement
      const wrapButton = codeBlock.querySelector('[data-code-block-action="wrap"]') as HTMLButtonElement

      expect(codeBlock.classList.contains('copilot-chat__code-block--nowrap')).toBe(false)
      expect(wrapButton.getAttribute('data-code-block-wrap-mode')).toBe('wrapped')

      await clickElement(copyButton)

      expect(clipboardWriteText).toHaveBeenCalledWith('const answer = 42\nconsole.log(answer)\n')
      expect(copyButton.getAttribute('aria-label')).toBe('代码已复制')

      await clickElement(wrapButton)

      expect(codeBlock.classList.contains('copilot-chat__code-block--nowrap')).toBe(true)
      expect(wrapButton.getAttribute('data-code-block-wrap-mode')).toBe('scroll')
      expect(wrapButton.getAttribute('aria-label')).toBe('启用自动换行')
    } finally {
      rendered.unmount()
    }
  })

  it('downloads code text with a language-aware file extension', async () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:copilot-code')
    const revokeObjectURL = vi.fn((_url: string) => undefined)
    const previousCreateObjectURL = URL.createObjectURL
    const previousRevokeObjectURL = URL.revokeObjectURL
    let clickedDownloadName = ''
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clickedDownloadName = this.download
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    const rendered = renderWithRoot(
      <CopilotMessageList conversation={[createAssistantCodeBlockConversationItem('```typst\n#set text(size: 12pt)\n```')]} />,
    )

    try {
      const downloadButton = rendered.container.querySelector('[data-code-block-action="download"]') as HTMLButtonElement

      await clickElement(downloadButton)

      expect(clickSpy).toHaveBeenCalledTimes(1)
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
      expect(clickedDownloadName).toMatch(/^copilot-code-.+\.typ$/)

      await act(async () => {
        vi.runOnlyPendingTimers()
      })

      expect(revokeObjectURL).toHaveBeenCalledWith('blob:copilot-code')
    } finally {
      rendered.unmount()
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: previousCreateObjectURL,
      })
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: previousRevokeObjectURL,
      })
    }
  })
})

function createAssistantCodeBlockConversationItem(content: string): CopilotMessageListItem {
  return {
    id: `assistant:code-block:${content}`,
    kind: 'assistant',
    runId: 'run-code-block',
    sequence: 1,
    title: '助手响应',
    content,
    status: 'completed',
    resolvedModelId: null,
    resolvedModelRoute: null,
    resolvedToolIds: [],
    requestOptions: {},
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
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

function mockClipboardWriteText() {
  const clipboardWriteText = vi.fn<(_value: string) => Promise<void>>(async () => undefined)

  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: clipboardWriteText,
    },
  })

  return clipboardWriteText
}
