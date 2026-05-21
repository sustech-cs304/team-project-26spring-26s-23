/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'

import { McpServerEditorDialog } from './McpServerEditorDialog'
import {
  clickElement,
  renderWithRoot,
  setFormControlValue,
} from '../settings/test-support/SettingsWorkspaceTestSupport'

const STDIO_DRAFT_JSON = JSON.stringify({
  serverId: 'new-server',
  displayName: 'new-server',
  enabled: true,
  description: '新增 MCP 服务器。',
  transportKind: 'stdio',
  transportConfig: {
    kind: 'stdio',
    command: 'uvx',
    args: ['example-mcp-server'],
    cwd: null,
    env: {},
  },
}, null, 2)

const HTTP_DRAFT_JSON = JSON.stringify({
  serverId: 'http-server',
  displayName: 'HTTP Server',
  enabled: true,
  description: 'An HTTP MCP server.',
  transportKind: 'http-sse',
  transportConfig: {
    kind: 'http-sse',
    baseUrl: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer token' },
    env: {},
    ssePathOverride: null,
  },
}, null, 2)

interface DefaultPropsOverrides {
  mode?: 'add' | 'edit'
  value?: string
  validationErrors?: readonly import('../../../electron/mcp-registry/types').McpServerValidationError[]
  errorMessage?: string | null
  submitting?: boolean
}

function buildDefaultProps(overrides: DefaultPropsOverrides = {}) {
  const {
    mode = 'add',
    value = STDIO_DRAFT_JSON,
    validationErrors = [],
    errorMessage = null,
    submitting = false,
  } = overrides

  return {
    mode: mode as 'add' | 'edit',
    value,
    validationErrors: validationErrors as readonly import('../../../electron/mcp-registry/types').McpServerValidationError[],
    errorMessage,
    submitting,
    onValueChange: vi.fn(),
    onClose: vi.fn(),
    onConfirm: vi.fn(),
  }
}

function queryByAriaLabel(container: ParentNode, label: string): Element | null {
  return container.querySelector(`[aria-label="${label}"]`)
}

function getByAriaLabel(container: ParentNode, label: string): HTMLElement {
  const el = queryByAriaLabel(container, label)
  if (!el) {
    throw new Error(`Missing element with aria-label="${label}"`)
  }
  return el as HTMLElement
}

function queryButtonByText(container: ParentNode, text: string): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  return buttons.find((btn) => btn.textContent?.trim() === text) ?? null
}

function getButtonByText(container: ParentNode, text: string): HTMLButtonElement {
  const btn = queryButtonByText(container, text)
  if (!btn) {
    throw new Error(`Missing button with text="${text}"`)
  }
  return btn
}

describe('McpServerEditorDialog', () => {
  describe('rendering', () => {
    it('renders in form mode by default with dialog role and add-mode title', () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const dialog = rendered.container.querySelector('[role="dialog"]')
      expect(dialog).toBeTruthy()
      expect(dialog!.getAttribute('aria-modal')).toBe('true')
      expect(rendered.container.textContent).toContain('新增服务器')

      rendered.unmount()
    })

    it('renders edit mode title when mode is edit', () => {
      const props = buildDefaultProps({ mode: 'edit' })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      expect(rendered.container.textContent).toContain('编辑服务器')

      rendered.unmount()
    })

    it('renders server name input field', () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const nameInput = queryByAriaLabel(rendered.container, '服务器名称')
      expect(nameInput).toBeTruthy()
      expect(nameInput?.tagName).toBe('INPUT')

      rendered.unmount()
    })

    it('renders server ID input field', () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const idInput = queryByAriaLabel(rendered.container, '服务器标识')
      expect(idInput).toBeTruthy()

      rendered.unmount()
    })

    it('renders description input field', () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const descInput = queryByAriaLabel(rendered.container, '服务器说明')
      expect(descInput).toBeTruthy()

      rendered.unmount()
    })

    it('renders enabled checkbox', () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const checkbox = queryByAriaLabel(rendered.container, '保存后立即启用')
      expect(checkbox).toBeTruthy()
      expect(checkbox?.getAttribute('type')).toBe('checkbox')

      rendered.unmount()
    })

    it('renders save and cancel buttons', () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      expect(queryButtonByText(rendered.container, '保存服务器')).toBeTruthy()
      expect(queryButtonByText(rendered.container, '取消')).toBeTruthy()

      rendered.unmount()
    })

    it('renders form/import tab buttons', () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      expect(queryButtonByText(rendered.container, '可视化表单')).toBeTruthy()
      expect(queryButtonByText(rendered.container, '从标准 MCP 配置导入')).toBeTruthy()

      rendered.unmount()
    })
  })

  describe('transport kind toggle', () => {
    it('shows stdio fields by default (command, args, cwd)', () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      expect(queryByAriaLabel(rendered.container, '启动命令')).toBeTruthy()
      expect(queryByAriaLabel(rendered.container, '命令参数')).toBeTruthy()
      expect(queryByAriaLabel(rendered.container, '工作目录')).toBeTruthy()

      // HTTP fields should NOT be visible
      expect(queryByAriaLabel(rendered.container, '服务地址')).toBeNull()
      expect(queryByAriaLabel(rendered.container, '请求头')).toBeNull()
      expect(queryByAriaLabel(rendered.container, 'SSE 路径覆盖')).toBeNull()

      rendered.unmount()
    })

    it('switches to http-sse fields when HTTP / SSE button is clicked', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const httpButton = getButtonByText(rendered.container, 'HTTP / SSE')
      await clickElement(httpButton)

      // HTTP fields should now be visible
      expect(queryByAriaLabel(rendered.container, '服务地址')).toBeTruthy()
      expect(queryByAriaLabel(rendered.container, '请求头')).toBeTruthy()
      expect(queryByAriaLabel(rendered.container, 'SSE 路径覆盖')).toBeTruthy()

      // stdio fields should NOT be visible
      expect(queryByAriaLabel(rendered.container, '启动命令')).toBeNull()
      expect(queryByAriaLabel(rendered.container, '命令参数')).toBeNull()
      expect(queryByAriaLabel(rendered.container, '工作目录')).toBeNull()

      rendered.unmount()
    })

    it('switches back to stdio fields', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      // Switch to http-sse first
      const httpButton = getButtonByText(rendered.container, 'HTTP / SSE')
      await clickElement(httpButton)
      expect(queryByAriaLabel(rendered.container, '服务地址')).toBeTruthy()

      // Switch back to stdio
      const stdioButton = getButtonByText(rendered.container, '命令行启动')
      await clickElement(stdioButton)
      expect(queryByAriaLabel(rendered.container, '启动命令')).toBeTruthy()
      expect(queryByAriaLabel(rendered.container, '服务地址')).toBeNull()

      rendered.unmount()
    })

    it('updates onValueChange when transport kind changes', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const httpButton = getButtonByText(rendered.container, 'HTTP / SSE')
      await clickElement(httpButton)

      expect(props.onValueChange).toHaveBeenCalled()
      const lastCall = props.onValueChange.mock.calls.at(-1)![0] as string
      const parsed = JSON.parse(lastCall)
      expect(parsed.transportKind).toBe('http-sse')
      expect(parsed.transportConfig.kind).toBe('http-sse')

      rendered.unmount()
    })
  })

  describe('import mode', () => {
    it('switches to import mode and shows JSON textarea', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const importTab = getButtonByText(rendered.container, '从标准 MCP 配置导入')
      await clickElement(importTab)

      const textarea = queryByAriaLabel(rendered.container, '标准 MCP JSON')
      expect(textarea).toBeTruthy()
      expect(textarea?.tagName).toBe('TEXTAREA')

      expect(queryButtonByText(rendered.container, '解析配置')).toBeTruthy()

      rendered.unmount()
    })

    it('switches back to form mode and preserves form data', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      // Modify the server name in form mode
      const nameInput = getByAriaLabel(rendered.container, '服务器名称') as HTMLInputElement
      await setFormControlValue(nameInput, 'My Custom Server')

      // Switch to import mode
      const importTab = getButtonByText(rendered.container, '从标准 MCP 配置导入')
      await clickElement(importTab)
      expect(queryByAriaLabel(rendered.container, '标准 MCP JSON')).toBeTruthy()

      // Switch back to form mode
      const formTab = getButtonByText(rendered.container, '可视化表单')
      await clickElement(formTab)

      // Form data should be preserved
      const nameInputAfter = getByAriaLabel(rendered.container, '服务器名称') as HTMLInputElement
      expect(nameInputAfter.value).toBe('My Custom Server')

      rendered.unmount()
    })

    it('parses valid single-server JSON and auto-applies to form', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      // Switch to import mode
      const importTab = getButtonByText(rendered.container, '从标准 MCP 配置导入')
      await clickElement(importTab)

      const validSingleJson = JSON.stringify({
        serverId: 'parsed-server',
        displayName: 'Parsed Server',
        transportKind: 'stdio',
        transportConfig: {
          kind: 'stdio',
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem'],
          cwd: null,
          env: {},
        },
      })

      const textarea = getByAriaLabel(rendered.container, '标准 MCP JSON') as HTMLTextAreaElement
      await setFormControlValue(textarea, validSingleJson)

      const parseButton = getButtonByText(rendered.container, '解析配置')
      await clickElement(parseButton)

      // Should auto-switch back to form mode with parsed data
      // onValueChange should have been called with the parsed draft
      expect(props.onValueChange).toHaveBeenCalled()
      const lastCall = props.onValueChange.mock.calls.at(-1)![0] as string
      const parsed = JSON.parse(lastCall)
      expect(parsed.serverId).toBe('parsed-server')
      expect(parsed.displayName).toBe('Parsed Server')

      rendered.unmount()
    })

    it('parses valid mcpServers map JSON with multiple candidates and shows import list', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const importTab = getButtonByText(rendered.container, '从标准 MCP 配置导入')
      await clickElement(importTab)

      const multiJson = JSON.stringify({
        mcpServers: {
          'server-a': {
            serverId: 'server-a',
            displayName: 'Server A',
            transportKind: 'stdio',
            transportConfig: {
              kind: 'stdio',
              command: 'uvx',
              args: ['mcp-a'],
              cwd: null,
              env: {},
            },
          },
          'server-b': {
            serverId: 'server-b',
            displayName: 'Server B',
            transportKind: 'stdio',
            transportConfig: {
              kind: 'stdio',
              command: 'uvx',
              args: ['mcp-b'],
              cwd: null,
              env: {},
            },
          },
        },
      })

      const textarea = getByAriaLabel(rendered.container, '标准 MCP JSON') as HTMLTextAreaElement
      await setFormControlValue(textarea, multiJson)

      const parseButton = getButtonByText(rendered.container, '解析配置')
      await clickElement(parseButton)

      // Should show candidate list with both servers
      expect(rendered.container.textContent).toContain('Server A')
      expect(rendered.container.textContent).toContain('Server B')
      expect(rendered.container.textContent).toContain('导入此项')

      rendered.unmount()
    })

    it('shows error for invalid JSON in import mode', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const importTab = getButtonByText(rendered.container, '从标准 MCP 配置导入')
      await clickElement(importTab)

      const textarea = getByAriaLabel(rendered.container, '标准 MCP JSON') as HTMLTextAreaElement
      await setFormControlValue(textarea, 'not valid json {{{')

      const parseButton = getButtonByText(rendered.container, '解析配置')
      await clickElement(parseButton)

      expect(rendered.container.textContent).toContain('JSON 解析失败')

      rendered.unmount()
    })

    it('shows error for valid JSON that is not a recognised MCP config', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const importTab = getButtonByText(rendered.container, '从标准 MCP 配置导入')
      await clickElement(importTab)

      const textarea = getByAriaLabel(rendered.container, '标准 MCP JSON') as HTMLTextAreaElement
      await setFormControlValue(textarea, JSON.stringify({ foo: 'bar' }))

      const parseButton = getButtonByText(rendered.container, '解析配置')
      await clickElement(parseButton)

      expect(rendered.container.textContent).toContain('标准 MCP 配置')

      rendered.unmount()
    })

    it('clears import error when textarea content changes', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const importTab = getButtonByText(rendered.container, '从标准 MCP 配置导入')
      await clickElement(importTab)

      const textarea = getByAriaLabel(rendered.container, '标准 MCP JSON') as HTMLTextAreaElement
      await setFormControlValue(textarea, 'bad json {{{')

      const parseButton = getButtonByText(rendered.container, '解析配置')
      await clickElement(parseButton)
      expect(rendered.container.textContent).toContain('JSON 解析失败')

      // Now type something new - error should clear
      await setFormControlValue(textarea, '{}')
      const errorDiv = rendered.container.querySelector('[role="alert"]')
      expect(errorDiv).toBeNull()

      rendered.unmount()
    })
  })

  describe('validation errors', () => {
    it('renders validation errors from validationErrors prop', () => {
      const props = buildDefaultProps({
        validationErrors: [
          { fieldPath: 'displayName', message: 'displayName 不能为空。', code: 'required' },
          { fieldPath: 'transportConfig.command', message: 'stdio 服务器必须提供 command。', code: 'required' },
        ],
      })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      expect(rendered.container.textContent).toContain('displayName 不能为空')
      expect(rendered.container.textContent).toContain('stdio 服务器必须提供 command')

      rendered.unmount()
    })

    it('renders top-level errorMessage', () => {
      const props = buildDefaultProps({
        errorMessage: 'MCP 配置草稿校验失败。',
      })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const alert = rendered.container.querySelector('[role="alert"]')
      expect(alert).toBeTruthy()
      expect(alert?.textContent).toContain('MCP 配置草稿校验失败')

      rendered.unmount()
    })

    it('does not render error area when there are no errors', () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const alert = rendered.container.querySelector('[role="alert"]')
      expect(alert).toBeNull()

      rendered.unmount()
    })

    it('filters out $ prefixed validation errors (top-level) from form display', () => {
      const props = buildDefaultProps({
        validationErrors: [
          { fieldPath: '$', message: 'JSON 解析失败', code: 'invalid_json' },
          { fieldPath: 'displayName', message: 'displayName 不能为空。', code: 'required' },
        ],
      })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      // The $ prefixed error should NOT appear (it's filtered by the useMemo)
      expect(rendered.container.textContent).not.toContain('JSON 解析失败')
      // The displayName error should still appear
      expect(rendered.container.textContent).toContain('displayName 不能为空')

      rendered.unmount()
    })
  })

  describe('save / submit', () => {
    it('calls onConfirm when save button is clicked', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const saveButton = getButtonByText(rendered.container, '保存服务器')
      await clickElement(saveButton)

      expect(props.onConfirm).toHaveBeenCalledTimes(1)

      rendered.unmount()
    })

    it('updates onValueChange with correct stdio draft when form fields are changed', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const nameInput = getByAriaLabel(rendered.container, '服务器名称') as HTMLInputElement
      await setFormControlValue(nameInput, 'My Stdio Server')

      const cmdInput = getByAriaLabel(rendered.container, '启动命令') as HTMLInputElement
      await setFormControlValue(cmdInput, 'npx')

      const argsTextarea = getByAriaLabel(rendered.container, '命令参数') as HTMLTextAreaElement
      await setFormControlValue(argsTextarea, '-y\nmcp-server')

      const lastCall = props.onValueChange.mock.calls.at(-1)![0] as string
      const parsed = JSON.parse(lastCall)

      expect(parsed.displayName).toBe('My Stdio Server')
      expect(parsed.transportKind).toBe('stdio')
      expect(parsed.transportConfig.kind).toBe('stdio')
      expect(parsed.transportConfig.command).toBe('npx')
      expect(parsed.transportConfig.args).toEqual(['-y', 'mcp-server'])

      rendered.unmount()
    })

    it('updates onValueChange with correct http-sse draft when form fields are changed', async () => {
      const props = buildDefaultProps({ value: HTTP_DRAFT_JSON })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const baseUrlInput = getByAriaLabel(rendered.container, '服务地址') as HTMLInputElement
      await setFormControlValue(baseUrlInput, 'https://my-mcp.example.com/api')

      const nameInput = getByAriaLabel(rendered.container, '服务器名称') as HTMLInputElement
      await setFormControlValue(nameInput, 'My HTTP Server')

      const lastCall = props.onValueChange.mock.calls.at(-1)![0] as string
      const parsed = JSON.parse(lastCall)

      expect(parsed.displayName).toBe('My HTTP Server')
      expect(parsed.transportKind).toBe('http-sse')
      expect(parsed.transportConfig.kind).toBe('http-sse')
      expect(parsed.transportConfig.baseUrl).toBe('https://my-mcp.example.com/api')

      rendered.unmount()
    })

    it('disables save button and shows saving text when submitting', () => {
      const props = buildDefaultProps({ submitting: true })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const saveButton = getButtonByText(rendered.container, '保存中…')
      expect(saveButton).toBeTruthy()
      expect(saveButton.disabled).toBe(true)

      rendered.unmount()
    })

    it('disables cancel button when submitting', () => {
      const props = buildDefaultProps({ submitting: true })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const cancelButton = getButtonByText(rendered.container, '取消')
      expect(cancelButton.disabled).toBe(true)

      rendered.unmount()
    })
  })

  describe('close / dismiss', () => {
    it('calls onClose when backdrop is clicked', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const backdrop = rendered.container.querySelector('.capabilities-dialog-backdrop')
      expect(backdrop).toBeTruthy()

      await clickElement(backdrop!)
      expect(props.onClose).toHaveBeenCalledTimes(1)

      rendered.unmount()
    })

    it('does not call onClose when dialog panel itself is clicked', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const dialogPanel = rendered.container.querySelector('[role="dialog"]')
      expect(dialogPanel).toBeTruthy()

      await clickElement(dialogPanel!)
      expect(props.onClose).not.toHaveBeenCalled()

      rendered.unmount()
    })

    it('calls onClose when Escape key is pressed', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })

      expect(props.onClose).toHaveBeenCalledTimes(1)

      rendered.unmount()
    })

    it('calls onClose when close button is clicked', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const closeButton = getByAriaLabel(rendered.container, '关闭服务器编辑窗口')
      await clickElement(closeButton)

      expect(props.onClose).toHaveBeenCalledTimes(1)

      rendered.unmount()
    })

    it('calls onClose when cancel button is clicked', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const cancelButton = getButtonByText(rendered.container, '取消')
      await clickElement(cancelButton)

      expect(props.onClose).toHaveBeenCalledTimes(1)

      rendered.unmount()
    })
  })

  describe('environment variables editor', () => {
    it('renders environment variables textarea', () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const envTextarea = queryByAriaLabel(rendered.container, '环境变量')
      expect(envTextarea).toBeTruthy()
      expect(envTextarea?.tagName).toBe('TEXTAREA')

      rendered.unmount()
    })

    it('parses env vars from textarea into onValueChange payload', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const envTextarea = getByAriaLabel(rendered.container, '环境变量') as HTMLTextAreaElement
      await setFormControlValue(envTextarea, 'API_KEY=secret123\nDEBUG=true')

      const lastCall = props.onValueChange.mock.calls.at(-1)![0] as string
      const parsed = JSON.parse(lastCall)

      expect(parsed.transportConfig.env).toEqual({ API_KEY: 'secret123', DEBUG: 'true' })

      rendered.unmount()
    })

    it('handles env var lines without equals sign', async () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const envTextarea = getByAriaLabel(rendered.container, '环境变量') as HTMLTextAreaElement
      await setFormControlValue(envTextarea, 'API_KEY=value\nSIMPLE_VAR')

      const lastCall = props.onValueChange.mock.calls.at(-1)![0] as string
      const parsed = JSON.parse(lastCall)

      expect(parsed.transportConfig.env).toEqual({ API_KEY: 'value', SIMPLE_VAR: '' })

      rendered.unmount()
    })
  })

  describe('HTTP headers editor', () => {
    it('renders headers textarea in http-sse mode', async () => {
      const props = buildDefaultProps({ value: HTTP_DRAFT_JSON })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const headersTextarea = queryByAriaLabel(rendered.container, '请求头')
      expect(headersTextarea).toBeTruthy()
      expect(headersTextarea?.tagName).toBe('TEXTAREA')

      rendered.unmount()
    })

    it('parses headers into onValueChange payload', async () => {
      const props = buildDefaultProps({ value: HTTP_DRAFT_JSON })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const headersTextarea = getByAriaLabel(rendered.container, '请求头') as HTMLTextAreaElement
      await setFormControlValue(headersTextarea, 'Authorization=Bearer abc\nX-Custom=value')

      const lastCall = props.onValueChange.mock.calls.at(-1)![0] as string
      const parsed = JSON.parse(lastCall)

      expect(parsed.transportConfig.headers).toEqual({ Authorization: 'Bearer abc', 'X-Custom': 'value' })

      rendered.unmount()
    })

    it('does not render headers editor in stdio mode', () => {
      const props = buildDefaultProps()
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      expect(queryByAriaLabel(rendered.container, '请求头')).toBeNull()

      rendered.unmount()
    })
  })

  describe('initial draft population', () => {
    it('populates form fields from initial value prop', () => {
      const customJson = JSON.stringify({
        serverId: 'my-custom-id',
        displayName: 'My Custom MCP',
        enabled: false,
        description: 'A custom server description.',
        transportKind: 'stdio',
        transportConfig: {
          kind: 'stdio',
          command: 'python',
          args: ['-m', 'my_mcp_server'],
          cwd: '/home/user/project',
          env: { PYTHONPATH: '/custom/path' },
        },
      }, null, 2)

      const props = buildDefaultProps({ value: customJson })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const nameInput = getByAriaLabel(rendered.container, '服务器名称') as HTMLInputElement
      expect(nameInput.value).toBe('My Custom MCP')

      const idInput = getByAriaLabel(rendered.container, '服务器标识') as HTMLInputElement
      expect(idInput.value).toBe('my-custom-id')

      const descInput = getByAriaLabel(rendered.container, '服务器说明') as HTMLInputElement
      expect(descInput.value).toBe('A custom server description.')

      const cmdInput = getByAriaLabel(rendered.container, '启动命令') as HTMLInputElement
      expect(cmdInput.value).toBe('python')

      const argsTextarea = getByAriaLabel(rendered.container, '命令参数') as HTMLTextAreaElement
      expect(argsTextarea.value).toBe('-m\nmy_mcp_server')

      const cwdInput = getByAriaLabel(rendered.container, '工作目录') as HTMLInputElement
      expect(cwdInput.value).toBe('/home/user/project')

      const envTextarea = getByAriaLabel(rendered.container, '环境变量') as HTMLTextAreaElement
      expect(envTextarea.value).toBe('PYTHONPATH=/custom/path')

      const checkbox = getByAriaLabel(rendered.container, '保存后立即启用') as HTMLInputElement
      expect(checkbox.checked).toBe(false)

      rendered.unmount()
    })

    it('populates http-sse fields from initial value prop', () => {
      const props = buildDefaultProps({ value: HTTP_DRAFT_JSON })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const nameInput = getByAriaLabel(rendered.container, '服务器名称') as HTMLInputElement
      expect(nameInput.value).toBe('HTTP Server')

      const baseUrlInput = getByAriaLabel(rendered.container, '服务地址') as HTMLInputElement
      expect(baseUrlInput.value).toBe('https://example.com/mcp')

      const headersTextarea = getByAriaLabel(rendered.container, '请求头') as HTMLTextAreaElement
      expect(headersTextarea.value).toBe('Authorization=Bearer token')

      rendered.unmount()
    })

    it('falls back to empty form state when value is invalid JSON', () => {
      const props = buildDefaultProps({ value: 'not valid json' })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      // Should render with default empty form state
      const nameInput = getByAriaLabel(rendered.container, '服务器名称') as HTMLInputElement
      expect(nameInput.value).toBe('new-server')

      rendered.unmount()
    })
  })

  describe('SSE path override', () => {
    it('updates onValueChange with ssePathOverride', async () => {
      const props = buildDefaultProps({ value: HTTP_DRAFT_JSON })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const sseInput = getByAriaLabel(rendered.container, 'SSE 路径覆盖') as HTMLInputElement
      await setFormControlValue(sseInput, '/custom/sse')

      const lastCall = props.onValueChange.mock.calls.at(-1)![0] as string
      const parsed = JSON.parse(lastCall)

      expect(parsed.transportConfig.ssePathOverride).toBe('/custom/sse')

      rendered.unmount()
    })

    it('normalizes empty ssePathOverride to null', async () => {
      const props = buildDefaultProps({ value: HTTP_DRAFT_JSON })
      const rendered = renderWithRoot(<McpServerEditorDialog {...props} />)

      const sseInput = getByAriaLabel(rendered.container, 'SSE 路径覆盖') as HTMLInputElement
      await setFormControlValue(sseInput, '   ')

      const lastCall = props.onValueChange.mock.calls.at(-1)![0] as string
      const parsed = JSON.parse(lastCall)

      expect(parsed.transportConfig.ssePathOverride).toBeNull()

      rendered.unmount()
    })
  })
})
