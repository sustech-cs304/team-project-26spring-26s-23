/** @vitest-environment jsdom */

import type { ComponentProps, ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'

import { SettingsWorkspace } from '../SettingsWorkspace'
import { createBootstrapController } from './settings-workspace-test-fixtures'

export interface RenderedSettingsWorkspace {
  container: HTMLDivElement
  getByTestId: (testId: string) => HTMLElement
  queryByTestId: (testId: string) => Element | null
  getByText: (text: string) => HTMLElement
  getByTextContaining: (text: string) => HTMLElement
  queryByText: (text: string) => HTMLElement | null
  getByPlaceholder: (placeholder: string) => HTMLElement
  unmount: () => void
}

export function renderSettingsWorkspace(
  overrides: Partial<ComponentProps<typeof SettingsWorkspace>> = {},
): RenderedSettingsWorkspace {
  return renderWithRoot(
    <SettingsWorkspace
      bootstrap={createBootstrapController()}
      themeMode="light"
      onThemeModeChange={vi.fn()}
      {...overrides}
    />,
  )
}

export function renderWithRoot(element: ReactElement): RenderedSettingsWorkspace {
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
    getByText(text: string) {
      const target = Array.from(container.querySelectorAll<HTMLElement>('*')).find((element) => {
        return element.textContent?.trim() === text
      })

      if (target === undefined) {
        throw new Error(`Missing element for text=${text}`)
      }

      return target
    },
    getByTextContaining(text: string) {
      const target = Array.from(container.querySelectorAll<HTMLElement>('*')).find((element) => {
        if (!element.textContent?.includes(text)) {
          return false
        }

        return !Array.from(element.children).some((child) => {
          return child.textContent?.includes(text)
        })
      })

      if (target === undefined) {
        throw new Error(`Missing element containing text=${text}`)
      }

      return target
    },
    queryByText(text: string) {
      return Array.from(container.querySelectorAll<HTMLElement>('*')).find((element) => {
        return element.textContent?.trim() === text
      }) ?? null
    },
    getByPlaceholder(placeholder: string) {
      const target = container.querySelector(`[placeholder="${placeholder}"]`)
      if (target === null) {
        throw new Error(`Missing element for placeholder=${placeholder}`)
      }

      return target as HTMLElement
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

export async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

export async function contextMenuElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 64, clientY: 48 }))
  })
}

export async function focusElement(element: HTMLElement) {
  await act(async () => {
    element.focus()
  })
}

export async function blurElement(element: HTMLElement) {
  await act(async () => {
    element.focus()
    element.blur()
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

export async function setFormControlValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

  if (valueSetter === undefined) {
    throw new Error('Unable to resolve native value setter')
  }

  await act(async () => {
    const previousValue = element.value
    valueSetter.call(element, value)
    const tracker = (element as HTMLInputElement & { _valueTracker?: { setValue: (nextValue: string) => void } })._valueTracker
    tracker?.setValue(previousValue)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export async function waitForNextFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

export async function flushAsyncEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

export function mockClipboardWriteText() {
  const clipboardWriteText = vi.fn<(_value: string) => Promise<void>>(async () => undefined)

  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: clipboardWriteText,
    },
  })

  return clipboardWriteText
}

export function mockListItemRect(element: HTMLElement, top: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: top,
    top,
    left: 0,
    right: 240,
    bottom: top + 40,
    width: 240,
    height: 40,
    toJSON() {
      return {}
    },
  })
}

export function mockButtonRect(element: HTMLElement) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 240,
    bottom: 40,
    width: 240,
    height: 40,
    toJSON() {
      return {}
    },
  })
}
