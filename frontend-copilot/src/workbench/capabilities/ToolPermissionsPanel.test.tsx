/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

import { renderWithRoot } from '../settings/test-support/SettingsWorkspaceTestSupport'
import type { ToolPermissionRecord } from './capabilities-demo'
import { ToolPermissionsPanel } from './ToolPermissionsPanel'

describe('ToolPermissionsPanel', () => {
  it('renders runtime-provided groups even when the group id is not in the legacy static whitelist', () => {
    const rendered = renderWithRoot(
      <ToolPermissionsPanel
        tools={createTools()}
        onModeChange={vi.fn()}
        onDelayActionChange={vi.fn()}
        onDelaySecondsChange={vi.fn()}
      />,
    )

    const groupLabels = Array.from(rendered.container.querySelectorAll('.tool-permission-group__label'))
      .map((element) => element.textContent?.trim())

    expect(groupLabels).toEqual(['内置基础工具', 'Filesystem MCP'])
    expect(rendered.container.textContent).toContain('读取文本文件')
    expect(rendered.container.querySelectorAll('.tool-permission-row').length).toBe(2)
  })
})

function createTools(): ToolPermissionRecord[] {
  return [
    {
      id: 'tool.fs.read',
      groupId: 'builtin-core',
      groupLabel: '内置基础工具',
      groupOrder: 0,
      name: '读取文件',
      description: '读取项目内文件内容。',
      toolId: 'tool.fs.read',
      mode: 'allow',
      delayAction: 'approve',
      delaySeconds: 15,
    },
    {
      id: 'mcp__filesystem__read_text_file',
      groupId: 'mcp.server.filesystem',
      groupLabel: 'Filesystem MCP',
      groupOrder: 100,
      name: '读取文本文件',
      description: '通过 filesystem 服务器读取文本文件。',
      toolId: 'mcp__filesystem__read_text_file',
      mode: 'ask',
      delayAction: 'approve',
      delaySeconds: 15,
    },
  ]
}
