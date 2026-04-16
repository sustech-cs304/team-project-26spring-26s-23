import { describe, expect, it } from 'vitest'

import type { CopilotToolPresentationSource } from './tool-presentation'
import {
  resolveCopilotToolPlatformGroup,
  resolveCopilotToolPresentation,
} from './tool-presentation'

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

describe('resolveCopilotToolPlatformGroup', () => {
  it('maps built-in and sustech tool namespaces to stable grouped platform buckets', () => {
    expect(resolveCopilotToolPlatformGroup({
      toolId: 'tool.file-convert',
      kind: 'builtin',
      displayName: 'File Convert',
      description: 'Convert office files',
    })).toMatchObject({
      key: 'builtin',
      title: 'Candue 内建',
      order: 0,
      sourceKind: 'builtin',
    })

    expect(resolveCopilotToolPlatformGroup({
      toolId: 'blackboard.course_catalog.search',
      kind: 'external',
      displayName: 'Course Catalog Search',
      description: 'Search Blackboard course catalog',
    })).toMatchObject({
      key: 'sustech-blackboard',
      title: 'SUSTech Blackboard',
      order: 10,
      sourceKind: 'sustech-blackboard',
    })

    expect(resolveCopilotToolPlatformGroup({
      toolId: 'tis.personal_grades.fetch',
      kind: 'external',
      displayName: 'Personal Grades Fetch',
      description: 'Fetch personal grades',
    })).toMatchObject({
      key: 'sustech-tis',
      title: 'SUSTech TIS',
      order: 20,
      sourceKind: 'sustech-tis',
    })
  })

  it('derives stable future mcp group names from explicit source or provider metadata', () => {
    const sourceTool = {
      toolId: 'campus.files.read',
      kind: 'external',
      displayName: null,
      description: null,
      sourceId: 'campus_fs',
    } as CopilotToolPresentationSource

    const providerTool = {
      toolId: 'campus.events.list',
      kind: 'external',
      displayName: null,
      description: null,
      provider: {
        id: 'sustech_api',
        name: 'SUSTech API',
      },
    } as CopilotToolPresentationSource

    expect(resolveCopilotToolPlatformGroup(sourceTool)).toMatchObject({
      key: 'mcp:campus-fs',
      title: 'Campus FS',
      order: 100,
      sourceKind: 'mcp-server',
    })
    expect(resolveCopilotToolPlatformGroup(providerTool)).toMatchObject({
      key: 'mcp:sustech-api',
      title: 'SUSTech API',
      order: 100,
      sourceKind: 'mcp-server',
    })
  })

  it('derives stable future mcp group names from mcp-style tool ids', () => {
    const tool: CopilotToolPresentationSource = {
      toolId: 'mcp.sustech_fs.read_file',
      kind: 'external',
      displayName: 'Read File',
      description: 'Read files through MCP',
    }

    const platformGroup = resolveCopilotToolPlatformGroup(tool)

    expect(platformGroup).toMatchObject({
      key: 'mcp:sustech-fs',
      title: 'SUSTech FS',
      order: 100,
      sourceKind: 'mcp-server',
    })
    expect(platformGroup.searchKeywords).toContain('mcp')
    expect(platformGroup.searchKeywords).toContain('SUSTech FS')
  })
})
