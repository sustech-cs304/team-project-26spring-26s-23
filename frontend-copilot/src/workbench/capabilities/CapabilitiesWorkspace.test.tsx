/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToolCatalogLoadResult } from '../../../electron/tool-catalog/ipc'

import type { SettingsWorkspaceStateSaveInput } from '../../../electron/settings-workspace/schema'
import {
  clickElement,
  renderWithRoot,
  setFormControlValue,
  waitForNextFrame,
} from '../settings/test-support/SettingsWorkspaceTestSupport'
import {
  loadSettingsWorkspaceState,
  saveSettingsWorkspaceState,
} from '../settings/workspace-state'
import { createPersistedWorkspaceState } from '../settings/test-support/SettingsWorkspaceTestSupport'
import { CapabilitiesWorkspace } from './CapabilitiesWorkspace'
import { loadToolCatalog } from './tool-catalog'

vi.mock('../settings/workspace-state', () => ({
  loadSettingsWorkspaceState: vi.fn(),
  saveSettingsWorkspaceState: vi.fn(),
}))

vi.mock('./tool-catalog', () => ({
  loadToolCatalog: vi.fn(),
}))

const mockedLoadSettingsWorkspaceState = vi.mocked(loadSettingsWorkspaceState)
const mockedSaveSettingsWorkspaceState = vi.mocked(saveSettingsWorkspaceState)
const mockedLoadToolCatalog = vi.mocked(loadToolCatalog)

beforeEach(() => {
  vi.clearAllMocks()
})

function getNavButton(container: ParentNode, sectionId: 'tool-permissions' | 'mcp-servers'): HTMLButtonElement {
  const button = container.querySelector(`#capabilities-tab-${sectionId}`)

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing capabilities nav button for section=${sectionId}`)
  }

  return button
}

function getExactButton(container: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((element) => {
    return element.textContent?.trim() === text
  })

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button with text=${text}`)
  }

  return button
}

function getToolRow(container: ParentNode, toolName: string): HTMLElement {
  const heading = Array.from(container.querySelectorAll<HTMLElement>('.tool-permission-row__name')).find((element) => {
    return element.textContent?.trim() === toolName
  })
  const row = heading?.closest('.tool-permission-row')

  if (!(row instanceof HTMLElement)) {
    throw new Error(`Missing tool permission row for tool=${toolName}`)
  }

  return row
}

function queryServerRow(container: ParentNode, serverName: string): HTMLElement | null {
  const heading = Array.from(container.querySelectorAll<HTMLElement>('.mcp-server-row__title')).find((element) => {
    return element.textContent?.trim() === serverName
  })

  const row = heading?.closest('.mcp-server-row')
  return row instanceof HTMLElement ? row : null
}

function getServerRow(container: ParentNode, serverName: string): HTMLElement {
  const row = queryServerRow(container, serverName)

  if (row === null) {
    throw new Error(`Missing MCP server row for server=${serverName}`)
  }

  return row
}

function getDialog(container: ParentNode): HTMLElement {
  const dialog = container.querySelector('[role="dialog"]')

  if (!(dialog instanceof HTMLElement)) {
    throw new Error('Missing MCP editor dialog')
  }

  return dialog
}

function createLoadResult() {
  return {
    ok: true as const,
    source: 'stored' as const,
    state: createPersistedWorkspaceState({
      providerProfiles: [
        {
          ...createPersistedWorkspaceState().providerProfiles[0],
          id: 'openrouter',
          profileId: 'openrouter',
          name: 'Persisted Router',
          displayName: 'Persisted Router',
        },
      ],
      general: {
        language: 'en-US',
      },
      mcp: {
        toolPermissionMode: 'manual',
        toolPermissionPolicy: {
          version: 1,
          migrationSourceMode: 'manual',
          defaultMode: 'ask',
          toolPermissions: {
            'functions.read_file': {
              mode: 'allow',
              source: 'user',
              updatedAt: '2026-04-17T04:00:00.000Z',
            },
            'mcp--fetch--fetch': {
              mode: 'deny',
              source: 'user',
              updatedAt: '2026-04-17T04:05:00.000Z',
            },
          },
        },
      },
    }),
  }
}

function createToolCatalogLoadResult(
  overrides: Partial<Extract<ToolCatalogLoadResult, { ok: true }>> = {},
): ToolCatalogLoadResult {
  return {
    ok: true,
    tools: [
      {
        toolId: 'functions.read_file',
        kind: 'builtin',
        availability: 'available',
        displayName: '读取文件',
        description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
        group: {
          id: 'builtin-core',
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: 'Built-in Core Tools',
          order: 0,
          sourceKind: 'builtin',
        },
      },
      {
        toolId: 'functions.execute_command',
        kind: 'builtin',
        availability: 'available',
        displayName: '执行命令',
        description: '运行本地终端命令，适合构建、检查与资源处理。',
        group: {
          id: 'builtin-core',
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: 'Built-in Core Tools',
          order: 0,
          sourceKind: 'builtin',
        },
      },
      {
        toolId: 'functions.write_to_file',
        kind: 'builtin',
        availability: 'available',
        displayName: '写入文件',
        description: '创建或重写文件，适用于页面搭建、样式输出与配置修改。',
        group: {
          id: 'builtin-core',
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: 'Built-in Core Tools',
          order: 0,
          sourceKind: 'builtin',
        },
      },
      {
        toolId: 'mcp--fetch--fetch',
        kind: 'external',
        availability: 'available',
        displayName: '联网抓取',
        description: '抓取网页内容，用于补充外部说明与页面上下文。',
        group: {
          id: 'mcp',
          label: 'MCP 工具',
          labelZh: 'MCP 工具',
          labelEn: 'MCP Tools',
          order: 100,
          sourceKind: 'mcp-server',
        },
      },
      {
        toolId: 'mcp--puppeteer--puppeteer_navigate',
        kind: 'external',
        availability: 'available',
        displayName: '浏览器自动化',
        description: '驱动浏览器执行界面级操作，用于录制流程或验证可见交互。',
        group: {
          id: 'mcp',
          label: 'MCP 工具',
          labelZh: 'MCP 工具',
          labelEn: 'MCP Tools',
          order: 100,
          sourceKind: 'mcp-server',
        },
      },
    ],
    ...overrides,
  }
}

function createHostedCatalogOnlyLoadResult(): ToolCatalogLoadResult {
  return {
    ok: true,
    tools: [
      {
        toolId: 'tool.file-convert',
        kind: 'builtin',
        availability: 'available',
        displayName: '文件转换',
        description: '将常见文档转换为运行时可消费内容。',
        group: {
          id: 'builtin-core',
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: 'Built-in Core Tools',
          order: 0,
          sourceKind: 'builtin',
        },
      },
      {
        toolId: 'blackboard.course_catalog.search',
        kind: 'contract',
        availability: 'available',
        displayName: '课程目录搜索',
        description: '搜索 Blackboard 课程目录。',
        group: {
          id: 'blackboard',
          label: 'Blackboard 工具',
          labelZh: 'Blackboard 工具',
          labelEn: 'Blackboard Tools',
          order: 10,
          sourceKind: 'sustech-blackboard',
        },
      },
      {
        toolId: 'tis.personal_grades.fetch',
        kind: 'contract',
        availability: 'available',
        displayName: '成绩查询',
        description: '读取教学系统个人成绩。',
        group: {
          id: 'tis',
          label: 'TIS 工具',
          labelZh: 'TIS 工具',
          labelEn: 'TIS Tools',
          order: 20,
          sourceKind: 'sustech-tis',
        },
      },
      {
        toolId: 'campus.events.list',
        kind: 'external',
        availability: 'available',
        displayName: '校园活动',
        description: '读取校园活动。',
        group: {
          id: 'mcp',
          label: 'MCP 工具',
          labelZh: 'MCP 工具',
          labelEn: 'MCP Tools',
          order: 100,
          sourceKind: 'mcp-server',
        },
      },
    ],
  }
}

describe('CapabilitiesWorkspace', () => {
  it('renders persisted tool permissions and secondary navigation switch with real tool ids', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    expect(rendered.container.querySelector('.capabilities-workspace')).toBeTruthy()
    expect(rendered.container.querySelector('.capabilities-panel')).toBeTruthy()
    expect(rendered.container.querySelector('.capabilities-main')).toBeTruthy()
    expect(rendered.container.querySelector('.capabilities-main__content')).toBeTruthy()
    expect(rendered.container.querySelector('[aria-label="工具权限列表"]')).toBeTruthy()
    expect(rendered.container.querySelectorAll('.tool-permission-group').length).toBe(2)
    expect(rendered.container.textContent).toContain('内置基础工具')
    expect(rendered.container.textContent).toContain('MCP 工具')
    expect(rendered.container.textContent).toContain('能力中心')
    expect(rendered.container.textContent).toContain('工具权限')
    expect(rendered.container.textContent).toContain('读取文件')
    expect(rendered.container.textContent).toContain('执行命令')
    expect(rendered.container.textContent).toContain('浏览器自动化')
    expect(getToolRow(rendered.container, '读取文件').textContent).toContain('functions.read_file')
    expect(getExactButton(getToolRow(rendered.container, '读取文件'), '自动批准').className).toContain(
      'tool-permission-segmented__item--active',
    )
    expect(getExactButton(getToolRow(rendered.container, '联网抓取'), '总是关闭').className).toContain(
      'tool-permission-segmented__item--active',
    )

    await clickElement(getNavButton(rendered.container, 'mcp-servers'))

    expect(rendered.container.querySelector('[aria-label="工具权限列表"]')).toBeNull()
    expect(rendered.container.querySelector('.mcp-server-row')).toBeTruthy()
    expect(rendered.container.querySelector('.mcp-server-toggle')).toBeTruthy()
    expect(rendered.container.textContent).toContain('MCP 服务器')
    expect(rendered.container.textContent).toContain('filesystem-server')
    expect(rendered.container.textContent).toContain('puppeteer-server')
    expect(rendered.container.textContent).toContain('编辑')
    expect(rendered.container.textContent).toContain('添加')

    rendered.unmount()
  })

  it('renders hosted backend builtin and contract tools instead of collapsing to the empty state', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createHostedCatalogOnlyLoadResult())
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    expect(rendered.container.querySelectorAll('.tool-permission-row').length).toBe(4)
    expect(rendered.container.textContent).toContain('文件转换')
    expect(rendered.container.textContent).toContain('课程目录搜索')
    expect(rendered.container.textContent).toContain('成绩查询')
    expect(rendered.container.textContent).toContain('校园活动')
    expect(rendered.container.textContent).not.toContain('尚未从运行时获取到可展示的工具目录。')
    expect(rendered.container.querySelectorAll('.tool-permission-group').length).toBe(4)
    expect(rendered.container.textContent).toContain('内置基础工具')
    expect(rendered.container.textContent).toContain('Blackboard 工具')
    expect(rendered.container.textContent).toContain('TIS 工具')
    expect(rendered.container.textContent).toContain('MCP 工具')

    rendered.unmount()
  })

  it('falls back to a built-in catalog with an explicit status message when loading the runtime tool catalog fails', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue({
      ok: false,
      error: 'Hosted backend runtime URL is unavailable.',
    })
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    expect(rendered.container.querySelectorAll('.tool-permission-row').length).toBe(5)
    expect(rendered.container.querySelectorAll('.tool-permission-group').length).toBe(2)
    expect(rendered.container.textContent).toContain('Hosted backend runtime tool catalog is temporarily unavailable. Using built-in fallback catalog.')
    expect(rendered.container.textContent).toContain('内置基础工具')
    expect(rendered.container.textContent).toContain('MCP 工具')
    expect(rendered.container.textContent).toContain('读取文件')
    expect(rendered.container.textContent).toContain('联网抓取')

    rendered.unmount()
  })

  it('falls back when the runtime tool catalog returns an incomplete directory', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue({
      ok: true,
      tools: [
        {
          toolId: 'functions.read_file',
          kind: 'builtin',
          availability: 'available',
          displayName: '读取文件',
          description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
        },
        {
          toolId: '',
          kind: 'builtin',
          availability: 'available',
          displayName: null,
          description: '无效工具项。',
        },
      ],
    })
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    expect(rendered.container.querySelectorAll('.tool-permission-row').length).toBe(5)
    expect(rendered.container.querySelectorAll('.tool-permission-group').length).toBe(2)
    expect(rendered.container.textContent).toContain('Hosted backend returned an incomplete tool catalog. Using built-in fallback catalog.')
    expect(rendered.container.textContent).toContain('浏览器自动化')
    expect(rendered.container.textContent).toContain('MCP 工具')

    rendered.unmount()
  })

  it('merges and saves tool permission policy updates without dropping unrelated settings fields', async () => {
    const loadResult = createLoadResult()
    mockedLoadSettingsWorkspaceState.mockResolvedValue(loadResult)
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: loadResult.state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    await clickElement(getExactButton(getToolRow(rendered.container, '执行命令'), '总是关闭'))

    expect(mockedSaveSettingsWorkspaceState).toHaveBeenCalledTimes(1)
    const saveInput = mockedSaveSettingsWorkspaceState.mock.calls[0]?.[0] as SettingsWorkspaceStateSaveInput

    expect(saveInput.providerProfiles).toHaveLength(loadResult.state.providerProfiles.length)
    expect(saveInput.providerProfiles[0]?.profileId).toBe('openrouter')
    expect(saveInput.general.language).toBe('en-US')
    expect(saveInput.mcp.toolPermissionMode).toBe('strict')
    expect(saveInput.mcp.toolPermissionPolicy).toEqual({
      version: 1,
      defaultMode: 'deny',
      toolPermissions: {
        'functions.read_file': {
          mode: 'allow',
          source: 'user',
          updatedAt: '2026-04-17T00:00:00.000Z',
        },
        'functions.write_to_file': {
          mode: 'ask',
          source: 'user',
          updatedAt: '2026-04-17T00:00:00.000Z',
        },
        'mcp--puppeteer--puppeteer_navigate': {
          mode: 'ask',
          source: 'user',
          updatedAt: '2026-04-17T00:00:00.000Z',
        },
      },
    })

    rendered.unmount()
  })

  it('switches segmented approval modes and expands then collapses the delay settings shell', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    expect(getToolRow(rendered.container, '读取文件').className).not.toContain('tool-permission-row--expanded')

    await clickElement(getExactButton(getToolRow(rendered.container, '读取文件'), '延迟处理'))

    const expandedRow = getToolRow(rendered.container, '读取文件')
    const secondsInput = expandedRow.querySelector('input[aria-label="超时秒数"]')

    if (!(secondsInput instanceof HTMLInputElement)) {
      throw new Error('Missing delay seconds input')
    }

    expect(expandedRow.className).toContain('tool-permission-row--expanded')
    expect(expandedRow.querySelector('.tool-permission-segmented')?.className).toContain('tool-permission-segmented--delay')
    expect(expandedRow.querySelector('.tool-permission-delay-shell')?.className).toContain('tool-permission-delay-shell--open')
    expect(getExactButton(expandedRow, '超时自动批准').className).toContain('tool-permission-delay-action--active')

    await clickElement(getExactButton(expandedRow, '超时自动禁止'))

    expect(getExactButton(getToolRow(rendered.container, '读取文件'), '超时自动禁止').className).toContain(
      'tool-permission-delay-action--active',
    )

    await setFormControlValue(
      getToolRow(rendered.container, '读取文件').querySelector('input[aria-label="超时秒数"]') as HTMLInputElement,
      '27',
    )

    expect((getToolRow(rendered.container, '读取文件').querySelector('input[aria-label="超时秒数"]') as HTMLInputElement).value).toBe('27')

    expect(mockedSaveSettingsWorkspaceState).toHaveBeenCalled()
    const lastSaveCall = mockedSaveSettingsWorkspaceState.mock.calls[mockedSaveSettingsWorkspaceState.mock.calls.length - 1]
    const saveInput = lastSaveCall?.[0] as SettingsWorkspaceStateSaveInput
    expect(saveInput.mcp.toolPermissionPolicy.toolPermissions['functions.read_file']).toEqual({
      mode: 'delay',
      timeoutAction: 'deny',
      timeoutSeconds: 27,
      source: 'user',
      updatedAt: '2026-04-17T00:00:00.000Z',
    })

    await clickElement(getExactButton(getToolRow(rendered.container, '读取文件'), '总是关闭'))

    const collapsedRow = getToolRow(rendered.container, '读取文件')
    const collapsedInput = collapsedRow.querySelector('input[aria-label="超时秒数"]')

    if (!(collapsedInput instanceof HTMLInputElement)) {
      throw new Error('Missing collapsed delay seconds input')
    }

    expect(collapsedRow.className).not.toContain('tool-permission-row--expanded')
    expect(collapsedRow.querySelector('.tool-permission-delay-shell')?.className).not.toContain('tool-permission-delay-shell--open')
    expect(collapsedInput.disabled).toBe(true)
    expect(getExactButton(collapsedRow, '超时自动批准').disabled).toBe(true)
    expect(getExactButton(collapsedRow, '超时自动禁止').disabled).toBe(true)

    rendered.unmount()
  })

  it('opens edit and add MCP dialogs with seeded json and closes them through cancel, close, and backdrop actions', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    const mcpNavButton = getNavButton(document.body, 'mcp-servers')
    await clickElement(mcpNavButton)
    await clickElement(getExactButton(rendered.container, '编辑'))
    await waitForNextFrame()

    let dialog = getDialog(rendered.container)
    let textarea = dialog.querySelector('textarea')

    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('Missing edit MCP textarea')
    }

    expect(dialog.getAttribute('aria-label')).toBe('编辑 MCP 服务器 JSON')
    expect(textarea.value).toContain('"filesystem-server"')
    expect(document.activeElement).toBe(textarea)
    expect(getExactButton(dialog, '取消')).toBeTruthy()
    expect(getExactButton(dialog, '确定')).toBeTruthy()

    await clickElement(getExactButton(dialog, '取消'))

    expect(rendered.container.querySelector('[role="dialog"]')).toBeNull()

    await clickElement(getExactButton(rendered.container, '添加'))
    await waitForNextFrame()

    dialog = getDialog(rendered.container)
    textarea = dialog.querySelector('textarea')

    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('Missing add MCP textarea')
    }

    expect(dialog.getAttribute('aria-label')).toBe('添加 MCP 服务器 JSON')
    expect(textarea.value).toContain('"new-server"')

    const closeButton = dialog.querySelector('button[aria-label="关闭 MCP 配置编辑器"]')

    if (!(closeButton instanceof HTMLButtonElement)) {
      throw new Error('Missing MCP close button')
    }

    await clickElement(closeButton)

    expect(rendered.container.querySelector('[role="dialog"]')).toBeNull()

    await clickElement(getExactButton(rendered.container, '编辑'))
    await waitForNextFrame()
    await clickElement(rendered.container.querySelector('.capabilities-dialog-backdrop') as HTMLElement)

    expect(rendered.container.querySelector('[role="dialog"]')).toBeNull()

    rendered.unmount()
  })

  it('toggles and deletes placeholder MCP server rows from the panel', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    const mcpNavButton = getNavButton(document.body, 'mcp-servers')
    await clickElement(mcpNavButton)

    const fetchToggle = rendered.container.querySelector('button[aria-label="开启 fetch-server"]')

    if (!(fetchToggle instanceof HTMLButtonElement)) {
      throw new Error('Missing fetch-server toggle')
    }

    await clickElement(fetchToggle)

    expect(rendered.container.querySelector('button[aria-label="关闭 fetch-server"]')).toBeTruthy()
    expect(getServerRow(rendered.container, 'fetch-server').querySelector('.mcp-server-toggle')?.className).toContain(
      'mcp-server-toggle--on',
    )

    await clickElement(rendered.container.querySelector('button[aria-label="删除 puppeteer-server"]') as HTMLButtonElement)

    expect(queryServerRow(rendered.container, 'puppeteer-server')).toBeNull()
    expect(getServerRow(rendered.container, 'filesystem-server')).toBeTruthy()

    rendered.unmount()
  })

})
