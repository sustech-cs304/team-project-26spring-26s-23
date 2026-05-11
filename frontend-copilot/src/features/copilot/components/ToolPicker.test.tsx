/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { SettingsWorkspaceToolPermissionPolicyState } from '../../../../electron/settings-workspace/schema'
import type { RuntimeToolDirectoryEntry } from '../chat-contract'
import { ToolPicker } from './ToolPicker'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const LABEL_STDIO_STUB_SERVER = 'stdio stub server'
const LABEL_SUSTECH_BLACKBOARD = 'SUSTech Blackboard'
const LABEL_TOOL_READ = 'tool.fs.read'
const SELECTOR_ARIA_EXPANDED = 'aria-expanded'
const SELECTOR_ARIA_PRESSED = 'aria-pressed'
const SELECTOR_CHAT_TOOL_OPTION = 'chat-tool-option-blackboard.course_catalog.search'
const SELECTOR_CHAT_TOOL_OPTION_2 = 'chat-tool-option-tool.fs.read'
const SELECTOR_CHAT_TOOL_OPTION_3 = 'chat-tool-option-tis.personal_grades.fetch'
const SELECTOR_CHAT_TOOL_OPTION_4 = 'chat-tool-option-blackboard.calendar.refresh'
const SELECTOR_CHAT_TOOL_PICKER = 'chat-tool-picker-state'
const SELECTOR_CHAT_TOOL_PICKER_2 = 'chat-tool-picker-trigger'
const SELECTOR_CHAT_TOOL_PICKER_3 = 'chat-tool-picker-panel'


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
    const trigger = rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER_2) as HTMLButtonElement

    await clickElement(trigger)

    const panel = rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER_3)
    const groups = panel.querySelector('.copilot-model-picker__groups')
    expect(groups).not.toBeNull()
    expect(readGroupSummaries(panel)).toEqual([
      { title: 'Candue 内建', count: '1', expanded: 'true' },
      { title: LABEL_SUSTECH_BLACKBOARD, count: '2', expanded: 'true' },
      { title: 'SUSTech TIS', count: '1', expanded: 'true' },
    ])

    const fileOption = rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_2) as HTMLButtonElement
    const catalogOption = rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION) as HTMLButtonElement
    const gradesOption = rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_3) as HTMLButtonElement

    expect(fileOption.textContent).toContain('读取文件')
    expect(fileOption.textContent).toContain('读取本地文本与文档内容')
    expect(catalogOption.textContent).toContain('课程目录搜索')
    expect(catalogOption.textContent).toContain('搜索 Blackboard 课程目录')
    expect(gradesOption.textContent).toContain('成绩获取')
    expect(gradesOption.textContent).toContain('获取个人成绩记录')

    expect(panel.textContent).not.toContain(LABEL_TOOL_READ)
    expect(panel.textContent).not.toContain('blackboard.course_catalog.search')
    expect(panel.textContent).not.toContain('tis.personal_grades.fetch')
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

    expect(fileName?.textContent).toBe('读取文件')
    expect(fileDescription?.textContent).toBe('读取本地文本与文档内容')
    expect(catalogDescription?.textContent).toBe('搜索 Blackboard 课程目录')
    expect(selectedCheck?.textContent).toBe('✓')
    expect(unselectedCheck?.textContent).toBe('+')

    rendered.unmount()
  })

  it('defaults all platform groups to expanded and lets group titles collapse and expand them', async () => {
    const rendered = renderWithRoot(<ToolPickerHarness />)
    const trigger = rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER_2) as HTMLButtonElement

    await clickElement(trigger)

    const panel = rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER_3)

    expect(getGroupToggleByTitle(panel, LABEL_SUSTECH_BLACKBOARD).getAttribute(SELECTOR_ARIA_EXPANDED)).toBe('true')
    expect(getGroupSectionByTitle(panel, LABEL_SUSTECH_BLACKBOARD).querySelector('.copilot-tool-picker__group-list')).not.toBeNull()

    await clickElement(getGroupToggleByTitle(panel, LABEL_SUSTECH_BLACKBOARD))

    expect(getGroupToggleByTitle(panel, LABEL_SUSTECH_BLACKBOARD).getAttribute(SELECTOR_ARIA_EXPANDED)).toBe('false')
    expect(getGroupSectionByTitle(panel, LABEL_SUSTECH_BLACKBOARD).querySelector('.copilot-tool-picker__group-list')).toBeNull()
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION)).toBeNull()
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION_4)).toBeNull()

    await clickElement(getGroupToggleByTitle(panel, LABEL_SUSTECH_BLACKBOARD))

    expect(getGroupToggleByTitle(panel, LABEL_SUSTECH_BLACKBOARD).getAttribute(SELECTOR_ARIA_EXPANDED)).toBe('true')
    expect(getGroupSectionByTitle(panel, LABEL_SUSTECH_BLACKBOARD).querySelector('.copilot-tool-picker__group-list')).not.toBeNull()
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION)).not.toBeNull()
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION_4)).not.toBeNull()

    rendered.unmount()
  })

  it('shows only matching groups and matching tools during search while keeping hidden ids searchable', async () => {
    const rendered = renderWithRoot(<ToolPickerHarness />)
    const trigger = rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER_2) as HTMLButtonElement

    await clickElement(trigger)

    const panel = rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER_3)
    const searchInput = rendered.getByTestId('chat-tool-picker-search') as HTMLInputElement

    await setFormControlValue(searchInput, '目录')

    expect(readGroupSummaries(panel)).toEqual([{ title: LABEL_SUSTECH_BLACKBOARD, count: '1', expanded: 'true' }])
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION)).not.toBeNull()
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION_4)).toBeNull()
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION_2)).toBeNull()
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION_3)).toBeNull()

    await setFormControlValue(searchInput, LABEL_TOOL_READ)

    expect(readGroupSummaries(panel)).toEqual([{ title: 'Candue 内建', count: '1', expanded: 'true' }])
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION_2)).not.toBeNull()
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION)).toBeNull()
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION_3)).toBeNull()

    rendered.unmount()
  })

  it('supports multi-select, select-all, invert and recommended shortcuts with grouped options', async () => {
    const rendered = renderWithRoot(<ToolPickerHarness />)

    const trigger = rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER_2) as HTMLButtonElement
    expect(trigger.textContent).toContain('启用 1 项工具')
    expect(trigger.getAttribute('aria-label')).toBe('工具：启用 1 项工具')
    expect(trigger.title).toBe('工具：启用 1 项工具')
    expect(trigger.getAttribute(SELECTOR_ARIA_EXPANDED)).toBe('false')

    await clickElement(trigger)

    expect(trigger.getAttribute(SELECTOR_ARIA_EXPANDED)).toBe('true')
    expect((rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_2) as HTMLButtonElement).getAttribute(SELECTOR_ARIA_PRESSED)).toBe('true')
    expect((rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION) as HTMLButtonElement).getAttribute(SELECTOR_ARIA_PRESSED)).toBe('false')

    const searchInput = rendered.getByTestId('chat-tool-picker-search') as HTMLInputElement
    await setFormControlValue(searchInput, '目录')

    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION)).not.toBeNull()
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION_4)).toBeNull()
    expect(rendered.queryByTestId(SELECTOR_CHAT_TOOL_OPTION_2)).toBeNull()

    await setFormControlValue(searchInput, '')
    await clickElement(rendered.getByTestId('chat-tool-picker-select-all'))
    expect(rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER).textContent).toBe(
      'tool.fs.read|blackboard.course_catalog.search|blackboard.calendar.refresh|tis.personal_grades.fetch',
    )
    expect((rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_2) as HTMLButtonElement).getAttribute(SELECTOR_ARIA_PRESSED)).toBe('true')
    expect((rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION) as HTMLButtonElement).getAttribute(SELECTOR_ARIA_PRESSED)).toBe('true')
    expect((rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_4) as HTMLButtonElement).getAttribute(SELECTOR_ARIA_PRESSED)).toBe('true')
    expect((rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_3) as HTMLButtonElement).getAttribute(SELECTOR_ARIA_PRESSED)).toBe('true')

    await clickElement(rendered.getByTestId('chat-tool-picker-invert'))
    expect(rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER).textContent).toBe('')
    expect(trigger.textContent).toContain('未启用工具')
    expect(trigger.getAttribute('aria-label')).toBe('工具：未启用工具')
    expect(trigger.title).toBe('工具：未启用工具')
    expect((rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_2) as HTMLButtonElement).getAttribute(SELECTOR_ARIA_PRESSED)).toBe('false')
    expect((rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION) as HTMLButtonElement).getAttribute(SELECTOR_ARIA_PRESSED)).toBe('false')

    await clickElement(rendered.getByTestId('chat-tool-picker-select-recommended'))
    expect(rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER).textContent).toBe('tool.fs.read|blackboard.course_catalog.search')
    expect((rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_2) as HTMLButtonElement).getAttribute(SELECTOR_ARIA_PRESSED)).toBe('true')
    expect((rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION) as HTMLButtonElement).getAttribute(SELECTOR_ARIA_PRESSED)).toBe('true')
    expect((rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_3) as HTMLButtonElement).getAttribute(SELECTOR_ARIA_PRESSED)).toBe('false')

    await clickElement(rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_3))
    expect(rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER).textContent).toBe(
      'tool.fs.read|blackboard.course_catalog.search|tis.personal_grades.fetch',
    )
    expect((rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_3) as HTMLButtonElement).getAttribute(SELECTOR_ARIA_PRESSED)).toBe('true')
    expect(trigger.textContent).toContain('启用 3 项工具')
    expect(trigger.getAttribute('aria-label')).toBe('工具：启用 3 项工具')
    expect(trigger.title).toBe('工具：启用 3 项工具')

    rendered.unmount()
  })

  it('keeps denied tools focusable, blocks fresh selection, and still allows deselection', async () => {
    const rendered = renderWithRoot(
      <ToolPickerHarness
        initialSelectedToolIds={[LABEL_TOOL_READ, 'blackboard.calendar.refresh']}
        toolPermissionPolicy={{
          version: 1,
          defaultMode: 'ask',
          toolPermissions: {
            'blackboard.calendar.refresh': { mode: 'deny' },
          },
        }}
      />,
    )

    await clickElement(rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER_2))

    const deniedOption = rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_4) as HTMLButtonElement
    const normalOption = rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION) as HTMLButtonElement
    const blockedOption = rendered.getByTestId(SELECTOR_CHAT_TOOL_OPTION_4) as HTMLButtonElement

    expect(deniedOption.disabled).toBe(false)
    expect(deniedOption.className).toContain('copilot-tool-picker__option--disabled')
    expect(deniedOption.getAttribute(SELECTOR_ARIA_PRESSED)).toBe('true')
    expect(deniedOption.textContent).toContain('已禁用')
    expect(deniedOption.textContent).toContain('当前策略：总是关闭')
    expect(normalOption.disabled).toBe(false)

    await clickElement(deniedOption)
    expect(rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER).textContent).toBe(LABEL_TOOL_READ)

    await clickElement(normalOption)
    expect(rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER).textContent).toBe(
      'tool.fs.read|blackboard.course_catalog.search',
    )

    expect(blockedOption.getAttribute('aria-disabled')).toBe('true')

    await clickElement(blockedOption)
    expect(rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER).textContent).toBe(
      'tool.fs.read|blackboard.course_catalog.search',
    )

    rendered.unmount()
  })

  it('renders mcp readable names and group titles consistently with permissions view semantics', async () => {
    const rendered = renderWithRoot(
      <ToolPickerHarness
        tools={[
          {
            toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
            kind: 'mcp',
            availability: 'available',
            displayName: null,
            description: null,
            serverId: 'mcp-stdio-stub',
            remoteToolName: 'search-campus',
            mcpServerName: LABEL_STDIO_STUB_SERVER,
            group: {
              id: 'mcp.server.mcp-stdio-stub',
              label: LABEL_STDIO_STUB_SERVER,
              labelZh: LABEL_STDIO_STUB_SERVER,
              labelEn: LABEL_STDIO_STUB_SERVER,
              order: 100,
              sourceKind: 'mcp-server',
            },
          } as RuntimeToolDirectoryEntry,
        ]}
        initialSelectedToolIds={[]}
        recommendedToolIds={[]}
      />,
    )

    await clickElement(rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER_2))

    expect(readGroupSummaries(rendered.getByTestId(SELECTOR_CHAT_TOOL_PICKER_3))).toEqual([
      { title: LABEL_STDIO_STUB_SERVER, count: '1', expanded: 'true' },
    ])
    expect(rendered.getByTestId('chat-tool-option-mcp.mcp-stdio-stub.search-campus.00004d8d').textContent).toContain('stdio stub server / Search Campus')

    rendered.unmount()
  })
})

interface ToolPickerHarnessProps {
  initialSelectedToolIds?: string[]
  recommendedToolIds?: string[]
  toolPermissionPolicy?: SettingsWorkspaceToolPermissionPolicyState | null
  tools?: RuntimeToolDirectoryEntry[]
}

function ToolPickerHarness({
  initialSelectedToolIds = [LABEL_TOOL_READ],
  recommendedToolIds = [LABEL_TOOL_READ, 'blackboard.course_catalog.search'],
  toolPermissionPolicy = null,
  tools = createTools(),
}: ToolPickerHarnessProps) {
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>(initialSelectedToolIds)

  return (
    <>
      <ToolPicker
        tools={tools}
        selectedToolIds={selectedToolIds}
        recommendedToolIds={recommendedToolIds}
        toolPermissionPolicy={toolPermissionPolicy}
        onChangeToolIds={setSelectedToolIds}
      />
      <output data-testid={SELECTOR_CHAT_TOOL_PICKER}>{selectedToolIds.join('|')}</output>
    </>
  )
}

function createTools(): RuntimeToolDirectoryEntry[] {
  return [
    {
      toolId: LABEL_TOOL_READ,
      kind: 'builtin',
      availability: 'available',
      displayName: '读取文件',
      description: '读取本地文本与文档内容',
    },
    {
      toolId: 'blackboard.course_catalog.search',
      kind: 'external',
      availability: 'available',
      displayName: '课程目录搜索',
      description: '搜索 Blackboard 课程目录',
    },
    {
      toolId: 'blackboard.calendar.refresh',
      kind: 'external',
      availability: 'disabled-by-global-setting',
      displayName: '日历刷新',
      description: '刷新 Blackboard 课程日历',
    },
    {
      toolId: 'tis.personal_grades.fetch',
      kind: 'external',
      availability: 'unavailable',
      displayName: '成绩获取',
      description: '获取个人成绩记录',
    },
  ]
}

function readGroupSummaries(container: ParentNode) {
  return [...container.querySelectorAll('.copilot-tool-picker__group')].map((group) => ({
    title: group.querySelector('.copilot-tool-picker__group-title')?.textContent,
    count: group.querySelector('.copilot-tool-picker__group-count')?.textContent,
    expanded: group.querySelector('.copilot-tool-picker__group-toggle')?.getAttribute(SELECTOR_ARIA_EXPANDED),
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
