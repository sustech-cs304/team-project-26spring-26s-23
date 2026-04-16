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
  it('renders localized tool presentation, hides visible ids and keeps presentation hooks', async () => {
    const rendered = renderWithRoot(<ToolPickerHarness />)
    const trigger = rendered.getByTestId('chat-tool-picker-trigger') as HTMLButtonElement

    await clickElement(trigger)

    const panel = rendered.getByTestId('chat-tool-picker-panel')
    const groups = panel.querySelector('.copilot-model-picker__groups')
    expect(groups).not.toBeNull()

    const fileOption = rendered.getByTestId('chat-tool-option-tool.file-convert') as HTMLButtonElement
    const remoteOption = rendered.getByTestId('chat-tool-option-tool.remote-search') as HTMLButtonElement

    expect(fileOption.textContent).toContain('文件转换')
    expect(fileOption.textContent).toContain('转换常见办公文档')
    expect(fileOption.textContent).toContain('builtin')
    expect(fileOption.textContent).toContain('可用')
    expect(remoteOption.textContent).toContain('联网搜索')
    expect(remoteOption.textContent).toContain('搜索外部公开信息')
    expect(remoteOption.textContent).toContain('external')
    expect(remoteOption.textContent).toContain('全局关闭')

    expect(panel.textContent).not.toContain('tool.file-convert')
    expect(panel.textContent).not.toContain('tool.remote-search')
    expect(panel.textContent).not.toContain('File Convert')
    expect(panel.textContent).not.toContain('Remote Search')
    expect(panel.textContent).not.toContain('Convert office files into other formats with a long English description')
    expect(panel.textContent).not.toContain('Search public information through external providers with a long English description')

    const fileName = fileOption.querySelector('.copilot-model-picker__option-body .copilot-tool-picker__option-name')
    const fileDescription = fileOption.querySelector('.copilot-tool-picker__option-description')
    const remoteDescription = remoteOption.querySelector('.copilot-tool-picker__option-description')
    const selectedCheck = fileOption.querySelector('.copilot-tool-picker__option-check')
    const unselectedCheck = remoteOption.querySelector('.copilot-tool-picker__option-check')

    expect(fileName?.textContent).toBe('文件转换')
    expect(fileDescription?.textContent).toBe('转换常见办公文档')
    expect(remoteDescription?.textContent).toBe('搜索外部公开信息')
    expect(selectedCheck?.textContent).toBe('✓')
    expect(unselectedCheck?.textContent).toBe('+')

    rendered.unmount()
  })

  it('supports searching by localized keywords and hidden ids after presentation polish', async () => {
    const rendered = renderWithRoot(<ToolPickerHarness />)
    const trigger = rendered.getByTestId('chat-tool-picker-trigger') as HTMLButtonElement

    await clickElement(trigger)

    const searchInput = rendered.getByTestId('chat-tool-picker-search') as HTMLInputElement
    await setFormControlValue(searchInput, '联网')
    expect(rendered.queryByTestId('chat-tool-option-tool.remote-search')).not.toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-tool.file-convert')).toBeNull()

    await setFormControlValue(searchInput, '公开信息')
    expect(rendered.queryByTestId('chat-tool-option-tool.remote-search')).not.toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-tool.file-convert')).toBeNull()

    await setFormControlValue(searchInput, 'tool.file-convert')
    expect(rendered.queryByTestId('chat-tool-option-tool.file-convert')).not.toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-tool.remote-search')).toBeNull()

    rendered.unmount()
  })

  it('supports multi-select, select-all, invert and recommended shortcuts', async () => {
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
    await setFormControlValue(searchInput, '联网')

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
      displayName: 'File Convert',
      description: 'Convert office files into other formats with a long English description',
    },
    {
      toolId: 'tool.remote-search',
      kind: 'external',
      availability: 'disabled-by-global-setting',
      displayName: 'Remote Search',
      description: 'Search public information through external providers with a long English description',
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
