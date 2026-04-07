/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ProviderProfileList } from './ProviderProfileList'

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
  vi.restoreAllMocks()
})

describe('ProviderProfileList', () => {
  it('opens the context menu and wires copy delete actions to callbacks', async () => {
    const onCopyProvider = vi.fn()
    const onDeleteProvider = vi.fn()

    const rendered = renderList({
      onCopyProvider,
      onDeleteProvider,
    })

    await act(async () => {
      rendered.getByTestId('settings-provider-card-provider-a').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 24, clientY: 18 }),
      )
    })

    expect(rendered.getByTestId('provider-context-menu').textContent).toContain('Alpha Provider')

    await act(async () => {
      rendered.getByText('复制服务商').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(rendered.queryByTestId('provider-context-menu')).toBeNull()

    await act(async () => {
      rendered.getByTestId('settings-provider-card-provider-a').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 22 }),
      )
    })

    await act(async () => {
      rendered.getByText('删除服务商').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(rendered.queryByTestId('provider-context-menu')).toBeNull()

    expect(onCopyProvider).toHaveBeenCalledWith('provider-a')
    expect(onDeleteProvider).toHaveBeenCalledWith('provider-a')

    rendered.unmount()
  })

  it('computes drag reorder callbacks from pointer movement', async () => {
    const onReorderProviders = vi.fn()

    const rendered = renderList({
      onReorderProviders,
    })

    mockListItemRect(rendered.getByTestId('settings-provider-list-item-provider-a'), 0)
    mockListItemRect(rendered.getByTestId('settings-provider-list-item-provider-b'), 60)
    mockButtonRect(rendered.getByTestId('settings-provider-card-provider-a'))

    await act(async () => {
      rendered.getByTestId('settings-provider-card-provider-a').dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      )
    })

    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 12, clientY: 92 }))
      await Promise.resolve()
    })

    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 12, clientY: 92 }))
      await Promise.resolve()
    })

    expect(onReorderProviders).toHaveBeenCalledWith('provider-a', 2)

    rendered.unmount()
  })
})

function renderList(overrides?: {
  onCopyProvider?: (providerId: string) => void
  onDeleteProvider?: (providerId: string) => void
  onReorderProviders?: (providerId: string, nextIndex: number) => void
}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(
      <ProviderProfileList
        providerProfiles={[
          {
            id: 'provider-a',
            name: 'Alpha Provider',
            protocol: 'openai',
            endpoint: 'https://alpha.example.com/v1',
            hasApiKey: true,
            defaultModel: 'openai/gpt-4.1',
            fastModel: 'openai/gpt-4.1-mini',
            fallbackModel: 'anthropic/claude-3.7-sonnet',
            organization: '',
            region: 'Global',
            notes: '',
            availableModels: [],
          },
          {
            id: 'provider-b',
            name: 'Beta Provider',
            protocol: 'gemini',
            endpoint: 'https://beta.example.com',
            hasApiKey: false,
            defaultModel: 'google/gemini-2.5-pro',
            fastModel: 'google/gemini-2.5-flash',
            fallbackModel: 'google/gemini-2.0-flash',
            organization: '',
            region: 'Global',
            notes: '',
            availableModels: [],
          },
        ]}
        activeProviderId="provider-a"
        providerQuery=""
        addProviderTypeId="openai"
        onProviderQueryChange={vi.fn()}
        onAddProviderTypeChange={vi.fn()}
        onActiveProviderChange={vi.fn()}
        onAddProvider={vi.fn()}
        onCopyProvider={overrides?.onCopyProvider ?? vi.fn()}
        onDeleteProvider={overrides?.onDeleteProvider ?? vi.fn()}
        onReorderProviders={overrides?.onReorderProviders ?? vi.fn()}
      />, 
    )
  })

  return {
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
    getByText(text: string) {
      const target = Array.from(container.querySelectorAll<HTMLElement>('*')).find((element) => {
        return element.textContent?.trim() === text
      })

      if (target === undefined) {
        throw new Error(`Missing element for text=${text}`)
      }

      return target
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

function mockListItemRect(element: HTMLElement, top: number) {
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

function mockButtonRect(element: HTMLElement) {
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
