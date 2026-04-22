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

  it('preserves canonical localized copy when available and still truncates fallback descriptions', () => {
    const tool: CopilotToolPresentationSource = {
      toolId: 'custom.tool-preview',
      kind: 'builtin',
      displayName: '这是一个用于测试工具选择器名称收口的超长中文名称示例',
      description: '这是一个用于测试工具选择器描述收口的超长中文描述示例需要被截断',
    }

    const presentation = resolveCopilotToolPresentation(tool)

    expect(presentation.name).toBe('这是一个用于测试工具选择器名称收口的超长中文名称示例')
    expect(presentation.description).toBe('这是一个用于测试工具选择器描述收口的超长中文描述示例需要被截断')
  })

  it('builds compact fallback copy from tool ids when canonical localized copy is unavailable', () => {
    const tool: CopilotToolPresentationSource = {
      toolId: 'custom.long_preview_identifier_for_picker',
      kind: 'builtin',
      displayName: null,
      description: null,
    }

    const presentation = resolveCopilotToolPresentation(tool)

    expect(presentation.name).toBe('可选工具')
    expect(presentation.description).toBe('内建辅助能力')
  })

  it('builds readable mcp fallback names from server and remote tool names', () => {
    const tool: CopilotToolPresentationSource = {
      toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
      kind: 'external',
      displayName: null,
      description: null,
      serverId: 'mcp-stdio-stub',
      remoteToolName: 'search-campus',
      mcpServerName: 'stdio stub server',
      group: {
        id: 'mcp.server.mcp-stdio-stub',
        label: 'stdio stub server',
        labelZh: 'stdio stub server',
        labelEn: 'stdio stub server',
        order: 100,
        sourceKind: 'mcp-server',
      },
    } as CopilotToolPresentationSource

    const presentation = resolveCopilotToolPresentation(tool)

    expect(presentation.name).toBe('stdio stub server / Search Campus')
    expect(resolveCopilotToolPlatformGroup(tool).title).toBe('stdio stub server')
  })
})

describe('resolveCopilotToolPlatformGroup', () => {
  it('prefers explicit catalog groups that already encode suite-level semantics', () => {
    expect(resolveCopilotToolPlatformGroup({
      toolId: 'tool.file-convert',
      kind: 'builtin',
      displayName: 'File Convert',
      description: 'Convert office files',
      group: {
        id: 'builtin-core',
        label: '内置基础工具',
        labelZh: '内置基础工具',
        labelEn: 'Built-in Core Tools',
        order: 0,
        sourceKind: 'builtin',
      },
    })).toMatchObject({
      key: 'builtin-core',
      title: '内置基础工具',
      order: 0,
      sourceKind: 'builtin',
    })

    expect(resolveCopilotToolPlatformGroup({
      toolId: 'blackboard.course_catalog.search',
      kind: 'external',
      displayName: 'Course Catalog Search',
      description: 'Search Blackboard course catalog',
      group: {
        id: 'blackboard',
        label: 'Blackboard 工具',
        labelZh: 'Blackboard 工具',
        labelEn: 'Blackboard Tools',
        order: 10,
        sourceKind: 'sustech-blackboard',
      },
    })).toMatchObject({
      key: 'blackboard',
      title: 'Blackboard 工具',
      order: 10,
      sourceKind: 'sustech-blackboard',
    })

    expect(resolveCopilotToolPlatformGroup({
      toolId: 'tis.personal_grades.fetch',
      kind: 'external',
      displayName: 'Personal Grades Fetch',
      description: 'Fetch personal grades',
      group: {
        id: 'tis',
        label: 'TIS 工具',
        labelZh: 'TIS 工具',
        labelEn: 'TIS Tools',
        order: 20,
        sourceKind: 'sustech-tis',
      },
    })).toMatchObject({
      key: 'tis',
      title: 'TIS 工具',
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
