import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

export interface RenderedAssistantWorkspace {
  container: HTMLDivElement
  getByTestId: (testId: string) => HTMLElement
  queryByTestId: (testId: string) => Element | null
  unmount: () => void
}

export function renderWithRoot(element: ReactElement): RenderedAssistantWorkspace {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(element)
  })

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
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}
