import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

export interface RenderedCopilotChatPanel {
  container: HTMLDivElement
  getByTestId: (testId: string) => HTMLElement
  queryByTestId: (testId: string) => Element | null
  rerender: (element: ReactElement) => void
  unmount: () => void
}

export function renderWithRoot(element: ReactElement): RenderedCopilotChatPanel {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  const render = (nextElement: ReactElement) => {
    act(() => {
      root.render(nextElement)
    })
  }

  render(element)

  return {
    container,
    getByTestId(testId: string) {
      const target = container.querySelector(`[data-testid="${testId}"]`)
      if (target === null) {
        throw new Error(`Missing element for data-testid=${testId}`)
      }

      return target as HTMLElement
    },
    queryByTestId(testId: string) {
      return container.querySelector(`[data-testid="${testId}"]`)
    },
    rerender(nextElement: ReactElement) {
      render(nextElement)
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

export function getTriggerIconText(trigger: HTMLButtonElement): string {
  const icon = trigger.querySelector('.copilot-model-picker__icon')
  return icon?.textContent ?? ''
}
