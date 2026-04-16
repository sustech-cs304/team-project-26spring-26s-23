import { describe, expect, it } from 'vitest'

import type { CopilotToolPresentationSource } from './tool-presentation'
import { resolveCopilotToolPresentation } from './tool-presentation'

describe('resolveCopilotToolPresentation', () => {
  it('returns localized override copy and search keywords for known tools', () => {
    const tool: CopilotToolPresentationSource = {
      toolId: 'tool.remote-search',
      kind: 'external',
      displayName: 'Remote Search',
      description: 'Search public information through external providers with a long English description',
    }

    const presentation = resolveCopilotToolPresentation(tool)

    expect(presentation.name).toBe('联网搜索')
    expect(presentation.description).toBe('搜索外部公开信息')
    expect(presentation.searchKeywords).toContain('tool.remote-search')
    expect(presentation.searchKeywords).toContain('Remote Search')
    expect(presentation.searchKeywords).toContain('Search public information through external providers with a long English description')
    expect(presentation.searchKeywords).toContain('联网搜索')
    expect(presentation.searchKeywords).toContain('搜索外部公开信息')
    expect(presentation.searchKeywords).toContain('远程搜索')
  })

  it('truncates long cjk fallback copy for compact tool picker presentation', () => {
    const tool: CopilotToolPresentationSource = {
      toolId: 'custom.tool-preview',
      kind: 'builtin',
      displayName: '这是一个用于测试工具选择器名称收口的超长中文名称示例',
      description: '这是一个用于测试工具选择器描述收口的超长中文描述示例需要被截断',
    }

    const presentation = resolveCopilotToolPresentation(tool)

    expect(presentation.name.length).toBeLessThanOrEqual(18)
    expect(presentation.name.endsWith('…')).toBe(true)
    expect(presentation.description.length).toBeLessThanOrEqual(26)
    expect(presentation.description.endsWith('…')).toBe(true)
  })
})
