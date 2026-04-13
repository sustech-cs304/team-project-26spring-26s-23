/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { RuntimeToolDirectoryEntry } from '../chat-contract'
import { ToolPicker } from './ToolPicker'

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

describe('ToolPicker', () => {
  it('supports search, multi-select, select-all, invert and recommended shortcuts', async () => {
    const rendered = renderWithRoot(<ToolPickerHarness />)

    const trigger = rendered.getByTestId('chat-tool-picker-trigger') as HTMLButtonElement
    expect(trigger.textContent).toContain('启用 1 项工具')
    expect(trigger.getAttribute('aria-label')).toBe('工具：启用 1 项工具')
    expect(trigger.title).toBe('工具：启用 1 项工具')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await clickElement(trigger)

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect((rendered.getByTestId('chat-tool-option-tool.file-convert') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect((rendered.getByTestId('chat-tool-option-tool.remote-search') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')

    const searchInput = rendered.getByTestId('chat-tool-picker-search') as HTMLInputElement
    await setFormControlValue(searchInput, '远程')

    expect(rendered.queryByTestId('chat-tool-option-tool.remote-search')).not.toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-tool.file-convert')).toBeNull()

    await setFormControlValue(searchInput, '')
    await clickElement(rendered.getByTestId('chat-tool-picker-select-all'))
    expect(rendered.getByTestId('chat-tool-picker-state').textContent).toBe('tool.file-convert|tool.remote-search')
    expect((rendered.getByTestId('chat-tool-option-tool.file-convert') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect((rendered.getByTestId('chat-tool-option-tool.remote-search') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')

    await clickElement(rendered.getByTestId('chat-tool-picker-invert'))
    expect(rendered.getByTestId('chat-tool-picker-state').textContent).toBe('')
    expect(trigger.textContent).toContain('未启用工具')
    expect(trigger.getAttribute('aria-label')).toBe('工具：未启用工具')
    expect(trigger.title).toBe('工具：未启用工具')
    expect((rendered.getByTestId('chat-tool-option-tool.file-convert') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')
    expect((rendered.getByTestId('chat-tool-option-tool.remote-search') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')

    await clickElement(rendered.getByTestId('chat-tool-picker-select-recommended'))
    expect(rendered.getByTestId('chat-tool-picker-state').textContent).toBe('tool.file-convert')
    expect((rendered.getByTestId('chat-tool-option-tool.file-convert') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect((rendered.getByTestId('chat-tool-option-tool.remote-search') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')

    await clickElement(rendered.getByTestId('chat-tool-option-tool.remote-search'))
    expect(rendered.getByTestId('chat-tool-picker-state').textContent).toBe('tool.file-convert|tool.remote-search')
    expect((rendered.getByTestId('chat-tool-option-tool.remote-search') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect(trigger.textContent).toContain('启用 2 项工具')
    expect(trigger.getAttribute('aria-label')).toBe('工具：启用 2 项工具')
    expect(trigger.title).toBe('工具：启用 2 项工具')

    rendered.unmount()
  })
})

function ToolPickerHarness() {
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>(['tool.file-convert'])

  return (
    <>
      <ToolPicker
        tools={createTools()}
        selectedToolIds={selectedToolIds}
        recommendedToolIds={['tool.file-convert']}
        onChangeToolIds={setSelectedToolIds}
      />
      <output data-testid="chat-tool-picker-state">{selectedToolIds.join('|')}</output>
    </>
  )
}

function createTools(): RuntimeToolDirectoryEntry[] {
  return [
    {
      toolId: 'tool.file-convert',
      kind: 'builtin',
      availability: 'available',
      displayName: '文件转换',
      description: 'DOCX/PDF/PPTX 转换工具',
    },
    {
      toolId: 'tool.remote-search',
      kind: 'external',
      availability: 'disabled-by-global-setting',
      displayName: '远程搜索',
      description: '访问外部搜索服务',
    },
  ]
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
    getByTestId(testId: string) {
      const target = container.querySelector(`[data-testid="${testId}"]`)
      if (target === null) {
        throw new Error(`Missing element for data-testid=${testId}`)
      }

      return target
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

async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function setFormControlValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
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
