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
  it('renders grouped localized tools in stable platform order and hides source/status labels', async () => {
    const rendered = renderWithRoot(<ToolPickerHarness />)
    const trigger = rendered.getByTestId('chat-tool-picker-trigger') as HTMLButtonElement

    await clickElement(trigger)

    const panel = rendered.getByTestId('chat-tool-picker-panel')
    const groups = panel.querySelector('.copilot-model-picker__groups')
    expect(groups).not.toBeNull()
    expect(readGroupSummaries(panel)).toEqual([
      { title: 'Candue 内建', count: '1', expanded: 'true' },
      { title: 'SUSTech Blackboard', count: '2', expanded: 'true' },
      { title: 'SUSTech TIS', count: '1', expanded: 'true' },
    ])

    const fileOption = rendered.getByTestId('chat-tool-option-tool.file-convert') as HTMLButtonElement
    const catalogOption = rendered.getByTestId('chat-tool-option-blackboard.course_catalog.search') as HTMLButtonElement
    const gradesOption = rendered.getByTestId('chat-tool-option-tis.personal_grades.fetch') as HTMLButtonElement

    expect(fileOption.textContent).toContain('文件转换')
    expect(fileOption.textContent).toContain('转换常见办公文档')
    expect(catalogOption.textContent).toContain('课程目录搜索')
    expect(catalogOption.textContent).toContain('搜索 Blackboard 课程目录')
    expect(gradesOption.textContent).toContain('成绩获取')
    expect(gradesOption.textContent).toContain('获取个人成绩记录')

    expect(panel.textContent).not.toContain('tool.file-convert')
    expect(panel.textContent).not.toContain('blackboard.course_catalog.search')
    expect(panel.textContent).not.toContain('tis.personal_grades.fetch')
    expect(panel.textContent).not.toContain('File Convert')
    expect(panel.textContent).not.toContain('Course Catalog Search')
    expect(panel.textContent).not.toContain('Personal Grades Fetch')
    expect(panel.textContent).not.toContain('Convert office files into other formats with a long English description')
    expect(panel.textContent).not.toContain('Search Blackboard course catalog with a long English description')
    expect(panel.textContent).not.toContain('Fetch personal grades from TIS with a long English description')
    expect(panel.textContent).not.toContain('builtin')
    expect(panel.textContent).not.toContain('external')
    expect(panel.textContent).not.toContain('available')
    expect(panel.textContent).not.toContain('disabled-by-global-setting')
    expect(panel.textContent).not.toContain('unavailable')
    expect(panel.textContent).not.toContain('可用')
    expect(panel.textContent).not.toContain('禁用')

    const fileName = fileOption.querySelector('.copilot-model-picker__option-body .copilot-tool-picker__option-name')
    const fileDescription = fileOption.querySelector('.copilot-tool-picker__option-description')
    const catalogDescription = catalogOption.querySelector('.copilot-tool-picker__option-description')
    const selectedCheck = fileOption.querySelector('.copilot-tool-picker__option-check')
    const unselectedCheck = catalogOption.querySelector('.copilot-tool-picker__option-check')

    expect(fileName?.textContent).toBe('文件转换')
    expect(fileDescription?.textContent).toBe('转换常见办公文档')
    expect(catalogDescription?.textContent).toBe('搜索 Blackboard 课程目录')
    expect(selectedCheck?.textContent).toBe('✓')
    expect(unselectedCheck?.textContent).toBe('+')

    rendered.unmount()
  })

  it('defaults all platform groups to expanded and lets group titles collapse and expand them', async () => {
    const rendered = renderWithRoot(<ToolPickerHarness />)
    const trigger = rendered.getByTestId('chat-tool-picker-trigger') as HTMLButtonElement

    await clickElement(trigger)

    const panel = rendered.getByTestId('chat-tool-picker-panel')

    expect(getGroupToggleByTitle(panel, 'SUSTech Blackboard').getAttribute('aria-expanded')).toBe('true')
    expect(getGroupSectionByTitle(panel, 'SUSTech Blackboard').querySelector('.copilot-tool-picker__group-list')).not.toBeNull()

    await clickElement(getGroupToggleByTitle(panel, 'SUSTech Blackboard'))

    expect(getGroupToggleByTitle(panel, 'SUSTech Blackboard').getAttribute('aria-expanded')).toBe('false')
    expect(getGroupSectionByTitle(panel, 'SUSTech Blackboard').querySelector('.copilot-tool-picker__group-list')).toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-blackboard.course_catalog.search')).toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-blackboard.calendar.refresh')).toBeNull()

    await clickElement(getGroupToggleByTitle(panel, 'SUSTech Blackboard'))

    expect(getGroupToggleByTitle(panel, 'SUSTech Blackboard').getAttribute('aria-expanded')).toBe('true')
    expect(getGroupSectionByTitle(panel, 'SUSTech Blackboard').querySelector('.copilot-tool-picker__group-list')).not.toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-blackboard.course_catalog.search')).not.toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-blackboard.calendar.refresh')).not.toBeNull()

    rendered.unmount()
  })

  it('shows only matching groups and matching tools during search while keeping hidden ids searchable', async () => {
    const rendered = renderWithRoot(<ToolPickerHarness />)
    const trigger = rendered.getByTestId('chat-tool-picker-trigger') as HTMLButtonElement

    await clickElement(trigger)

    const panel = rendered.getByTestId('chat-tool-picker-panel')
    const searchInput = rendered.getByTestId('chat-tool-picker-search') as HTMLInputElement

    await setFormControlValue(searchInput, '目录')

    expect(readGroupSummaries(panel)).toEqual([{ title: 'SUSTech Blackboard', count: '1', expanded: 'true' }])
    expect(rendered.queryByTestId('chat-tool-option-blackboard.course_catalog.search')).not.toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-blackboard.calendar.refresh')).toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-tool.file-convert')).toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-tis.personal_grades.fetch')).toBeNull()

    await setFormControlValue(searchInput, 'tool.file-convert')

    expect(readGroupSummaries(panel)).toEqual([{ title: 'Candue 内建', count: '1', expanded: 'true' }])
    expect(rendered.queryByTestId('chat-tool-option-tool.file-convert')).not.toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-blackboard.course_catalog.search')).toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-tis.personal_grades.fetch')).toBeNull()

    rendered.unmount()
  })

  it('supports multi-select, select-all, invert and recommended shortcuts with grouped options', async () => {
    const rendered = renderWithRoot(<ToolPickerHarness />)

    const trigger = rendered.getByTestId('chat-tool-picker-trigger') as HTMLButtonElement
    expect(trigger.textContent).toContain('启用 1 项工具')
    expect(trigger.getAttribute('aria-label')).toBe('工具：启用 1 项工具')
    expect(trigger.title).toBe('工具：启用 1 项工具')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await clickElement(trigger)

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect((rendered.getByTestId('chat-tool-option-tool.file-convert') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect((rendered.getByTestId('chat-tool-option-blackboard.course_catalog.search') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')

    const searchInput = rendered.getByTestId('chat-tool-picker-search') as HTMLInputElement
    await setFormControlValue(searchInput, '目录')

    expect(rendered.queryByTestId('chat-tool-option-blackboard.course_catalog.search')).not.toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-blackboard.calendar.refresh')).toBeNull()
    expect(rendered.queryByTestId('chat-tool-option-tool.file-convert')).toBeNull()

    await setFormControlValue(searchInput, '')
    await clickElement(rendered.getByTestId('chat-tool-picker-select-all'))
    expect(rendered.getByTestId('chat-tool-picker-state').textContent).toBe(
      'tool.file-convert|blackboard.course_catalog.search|blackboard.calendar.refresh|tis.personal_grades.fetch',
    )
    expect((rendered.getByTestId('chat-tool-option-tool.file-convert') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect((rendered.getByTestId('chat-tool-option-blackboard.course_catalog.search') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect((rendered.getByTestId('chat-tool-option-blackboard.calendar.refresh') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect((rendered.getByTestId('chat-tool-option-tis.personal_grades.fetch') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')

    await clickElement(rendered.getByTestId('chat-tool-picker-invert'))
    expect(rendered.getByTestId('chat-tool-picker-state').textContent).toBe('')
    expect(trigger.textContent).toContain('未启用工具')
    expect(trigger.getAttribute('aria-label')).toBe('工具：未启用工具')
    expect(trigger.title).toBe('工具：未启用工具')
    expect((rendered.getByTestId('chat-tool-option-tool.file-convert') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')
    expect((rendered.getByTestId('chat-tool-option-blackboard.course_catalog.search') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')

    await clickElement(rendered.getByTestId('chat-tool-picker-select-recommended'))
    expect(rendered.getByTestId('chat-tool-picker-state').textContent).toBe('tool.file-convert|blackboard.course_catalog.search')
    expect((rendered.getByTestId('chat-tool-option-tool.file-convert') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect((rendered.getByTestId('chat-tool-option-blackboard.course_catalog.search') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect((rendered.getByTestId('chat-tool-option-tis.personal_grades.fetch') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false')

    await clickElement(rendered.getByTestId('chat-tool-option-tis.personal_grades.fetch'))
    expect(rendered.getByTestId('chat-tool-picker-state').textContent).toBe(
      'tool.file-convert|blackboard.course_catalog.search|tis.personal_grades.fetch',
    )
    expect((rendered.getByTestId('chat-tool-option-tis.personal_grades.fetch') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect(trigger.textContent).toContain('启用 3 项工具')
    expect(trigger.getAttribute('aria-label')).toBe('工具：启用 3 项工具')
    expect(trigger.title).toBe('工具：启用 3 项工具')

    rendered.unmount()
  })
})

interface ToolPickerHarnessProps {
  initialSelectedToolIds?: string[]
  recommendedToolIds?: string[]
  tools?: RuntimeToolDirectoryEntry[]
}

function ToolPickerHarness({
  initialSelectedToolIds = ['tool.file-convert'],
  recommendedToolIds = ['tool.file-convert', 'blackboard.course_catalog.search'],
  tools = createTools(),
}: ToolPickerHarnessProps) {
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>(initialSelectedToolIds)

  return (
    <>
      <ToolPicker
        tools={tools}
        selectedToolIds={selectedToolIds}
        recommendedToolIds={recommendedToolIds}
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
      toolId: 'blackboard.course_catalog.search',
      kind: 'external',
      availability: 'available',
      displayName: 'Course Catalog Search',
      description: 'Search Blackboard course catalog with a long English description',
    },
    {
      toolId: 'blackboard.calendar.refresh',
      kind: 'external',
      availability: 'disabled-by-global-setting',
      displayName: 'Calendar Refresh',
      description: 'Refresh Blackboard course calendar with a long English description',
    },
    {
      toolId: 'tis.personal_grades.fetch',
      kind: 'external',
      availability: 'unavailable',
      displayName: 'Personal Grades Fetch',
      description: 'Fetch personal grades from TIS with a long English description',
    },
  ]
}

function readGroupSummaries(container: ParentNode) {
  return [...container.querySelectorAll('.copilot-tool-picker__group')].map((group) => ({
    title: group.querySelector('.copilot-tool-picker__group-title')?.textContent,
    count: group.querySelector('.copilot-tool-picker__group-count')?.textContent,
    expanded: group.querySelector('.copilot-tool-picker__group-toggle')?.getAttribute('aria-expanded'),
  }))
}

function getGroupSectionByTitle(container: ParentNode, title: string): Element {
  const group = [...container.querySelectorAll('.copilot-tool-picker__group')].find(
    (candidate) => candidate.querySelector('.copilot-tool-picker__group-title')?.textContent === title,
  )

  if (group === undefined) {
    throw new Error(`Missing tool group with title=${title}`)
  }

  return group
}

function getGroupToggleByTitle(container: ParentNode, title: string): HTMLButtonElement {
  const toggle = getGroupSectionByTitle(container, title).querySelector('.copilot-tool-picker__group-toggle')
  if (!(toggle instanceof HTMLButtonElement)) {
    throw new Error(`Missing toggle button for title=${title}`)
  }

  return toggle
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
