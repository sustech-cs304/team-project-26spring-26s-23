/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import {
  clickElement,
  renderWithRoot,
  setFormControlValue,
  waitForNextFrame,
} from '../settings/SettingsWorkspace.test-support'
import { CapabilitiesWorkspace } from './CapabilitiesWorkspace'

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

describe('CapabilitiesWorkspace', () => {
  it('renders the dedicated capabilities shell, placeholder tool data, and secondary navigation switch', async () => {
    const rendered = renderWithRoot(<CapabilitiesWorkspace />)

    expect(rendered.container.querySelector('.capabilities-workspace')).toBeTruthy()
    expect(rendered.container.querySelector('.capabilities-panel')).toBeTruthy()
    expect(rendered.container.querySelector('.capabilities-main')).toBeTruthy()
    expect(rendered.container.querySelector('.capabilities-main__content')).toBeTruthy()
    expect(rendered.container.querySelector('[aria-label="工具权限列表"]')).toBeTruthy()
    expect(rendered.container.querySelectorAll('.tool-permission-group').length).toBe(2)
    expect(rendered.container.textContent).toContain('能力中心')
    expect(rendered.container.textContent).toContain('工具权限')
    expect(rendered.container.textContent).toContain('读取文件')
    expect(rendered.container.textContent).toContain('execute_command')
    expect(rendered.container.textContent).toContain('浏览器自动化')

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

  it('switches segmented approval modes and expands then collapses the delay settings shell', async () => {
    const rendered = renderWithRoot(<CapabilitiesWorkspace />)

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
    const rendered = renderWithRoot(<CapabilitiesWorkspace />)

    await clickElement(getNavButton(rendered.container, 'mcp-servers'))
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
    const rendered = renderWithRoot(<CapabilitiesWorkspace />)

    await clickElement(getNavButton(rendered.container, 'mcp-servers'))

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
