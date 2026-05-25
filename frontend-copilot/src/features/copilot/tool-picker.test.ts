import { describe, expect, it } from 'vitest'

import type { SettingsWorkspaceToolPermissionPolicyState } from '../../../electron/settings-workspace/schema'
import type { RuntimeToolDirectoryEntry } from './thread-run-contract'
import {
  buildCopilotToolViewModels,
  filterCopilotTools,
  groupCopilotTools,
  invertToolSelection,
  pickRecommendedToolIds,
  sanitizeEnabledToolIds,
  selectAllToolIds,
  toggleToolIdInSelection,
} from './tool-picker'

function createTool(overrides: Partial<RuntimeToolDirectoryEntry> = {}): RuntimeToolDirectoryEntry {
  return {
    toolId: 'tool.fs.read',
    kind: 'builtin',
    availability: 'available',
    displayName: '读取文件',
    description: '读取项目内文件内容。',
    ...overrides,
  }
}

function createPolicy(
  overrides: Partial<SettingsWorkspaceToolPermissionPolicyState> = {},
): SettingsWorkspaceToolPermissionPolicyState {
  return {
    version: 1,
    defaultMode: 'ask',
    toolPermissions: {},
    ...overrides,
  }
}

const TOOL_READ = 'tool.fs.read'
const TOOL_SEARCH = 'tool.remote-search'
const TOOL_WRITE = 'tool.fs.write'
const TOOL_MCP = 'mcp.server.read'
const LABEL_BUILTIN = 'builtin'

describe('filterCopilotTools', () => {
  const tools: RuntimeToolDirectoryEntry[] = [
    createTool({ toolId: TOOL_READ, displayName: '读取文件' }),
    createTool({ toolId: TOOL_SEARCH, kind: 'external', displayName: '联网搜索', description: '搜索外部信息' }),
    createTool({ toolId: TOOL_WRITE, kind: LABEL_BUILTIN, displayName: '写入文件', description: '写入文件内容' }),
  ]

  it('returns all tools when query is empty', () => {
    expect(filterCopilotTools({ tools, query: '' })).toEqual(tools)
    expect(filterCopilotTools({ tools, query: '   ' })).toEqual(tools)
  })

  it('filters tools by toolId', () => {
    const result = filterCopilotTools({ tools, query: 'remote' })
    expect(result).toHaveLength(1)
    expect(result[0]?.toolId).toBe(TOOL_SEARCH)
  })

  it('filters tools by displayName', () => {
    const result = filterCopilotTools({ tools, query: '读取' })
    expect(result).toHaveLength(1)
    expect(result[0]?.toolId).toBe(TOOL_READ)
  })

  it('filters tools by description', () => {
    const result = filterCopilotTools({ tools, query: '外部' })
    expect(result).toHaveLength(1)
    expect(result[0]?.toolId).toBe(TOOL_SEARCH)
  })

  it('is case-insensitive', () => {
    const result = filterCopilotTools({ tools, query: 'FS' })
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.toolId).sort()).toEqual([TOOL_READ, TOOL_WRITE].sort())
  })

  it('returns empty array when no tools match', () => {
    const result = filterCopilotTools({ tools, query: 'nonexistent' })
    expect(result).toHaveLength(0)
  })

  it('filters by kind field', () => {
    const result = filterCopilotTools({ tools, query: 'external' })
    expect(result).toHaveLength(1)
    expect(result[0]?.toolId).toBe(TOOL_SEARCH)
  })

  it('filters by availability field', () => {
    const result = filterCopilotTools({ tools, query: 'available' })
    expect(result).toHaveLength(3)
  })

  it('returns all tools for empty tools array', () => {
    expect(filterCopilotTools({ tools: [], query: 'anything' })).toEqual([])
  })

  it('filters using platform group search keywords', () => {
    const toolWithGroup = createTool({
      toolId: TOOL_MCP,
      kind: 'external',
      displayName: 'MCP Tool',
      description: 'An MCP tool',
      group: {
        id: 'mcp-server',
        label: 'MCP Server',
        labelZh: 'MCP 服务器',
        labelEn: 'MCP Server',
        order: 100,
        sourceKind: 'mcp-server',
      },
    })
    const result = filterCopilotTools({ tools: [toolWithGroup], query: 'mcp' })
    expect(result).toHaveLength(1)
  })
})

describe('groupCopilotTools', () => {
  it('groups tools by platform group', () => {
    const tools: RuntimeToolDirectoryEntry[] = [
      createTool({
        toolId: TOOL_READ,
        group: { id: 'builtin-core', label: '内置', labelZh: '内置', labelEn: 'Built-in', order: 0, sourceKind: 'builtin' },
      }),
      createTool({
        toolId: TOOL_SEARCH,
        kind: 'external',
        group: { id: 'builtin-core', label: '内置', labelZh: '内置', labelEn: 'Built-in', order: 0, sourceKind: 'builtin' },
      }),
      createTool({
        toolId: TOOL_MCP,
        kind: 'external',
        group: { id: 'mcp-server', label: 'MCP', labelZh: 'MCP', labelEn: 'MCP', order: 100, sourceKind: 'mcp-server' },
      }),
    ]

    const groups = groupCopilotTools({ tools })
    expect(groups).toHaveLength(2)
    const builtinGroup = groups.find((g) => g.key === 'builtin-core')
    const mcpGroup = groups.find((g) => g.key === 'mcp-server')
    expect(builtinGroup).toBeDefined()
    expect(builtinGroup?.tools).toHaveLength(2)
    expect(mcpGroup).toBeDefined()
    expect(mcpGroup?.tools).toHaveLength(1)
  })

  it('sorts groups by order then title then creation index', () => {
    const tools: RuntimeToolDirectoryEntry[] = [
      createTool({ toolId: 'c', group: { id: 'group-c', label: 'C', labelZh: 'C', labelEn: 'C', order: 20, sourceKind: 'custom' } }),
      createTool({ toolId: 'a', group: { id: 'group-a', label: 'A', labelZh: 'A', labelEn: 'A', order: 0, sourceKind: 'builtin' } }),
      createTool({ toolId: 'b1', group: { id: 'group-b', label: 'B', labelZh: 'B', labelEn: 'B', order: 0, sourceKind: 'builtin' } }),
      createTool({ toolId: 'b2', group: { id: 'group-b', label: 'B', labelZh: 'B', labelEn: 'B', order: 0, sourceKind: 'builtin' } }),
    ]

    const groups = groupCopilotTools({ tools })
    expect(groups[0]?.key).toBe('group-a')
    expect(groups[1]?.key).toBe('group-b')
    expect(groups[2]?.key).toBe('group-c')
  })

  it('sorts tools within groups: available first, then recommended, then by index', () => {
    const tools: RuntimeToolDirectoryEntry[] = [
      createTool({ toolId: 'tool-2', availability: 'unavailable', group: { id: 'g', label: 'G', labelZh: 'G', labelEn: 'G', order: 0, sourceKind: 'builtin' } }),
      createTool({ toolId: 'tool-1', availability: 'available', group: { id: 'g', label: 'G', labelZh: 'G', labelEn: 'G', order: 0, sourceKind: 'builtin' } }),
    ]

    const groups = groupCopilotTools({ tools })
    expect(groups[0]?.tools[0]?.toolId).toBe('tool-1')
    expect(groups[0]?.tools[1]?.toolId).toBe('tool-2')
  })

  it('sorts recommended tools before non-recommended when availability is equal', () => {
    const tools: RuntimeToolDirectoryEntry[] = [
      createTool({ toolId: 'tool-b', availability: 'available', group: { id: 'g', label: 'G', labelZh: 'G', labelEn: 'G', order: 0, sourceKind: 'builtin' } }),
      createTool({ toolId: 'tool-a', availability: 'available', group: { id: 'g', label: 'G', labelZh: 'G', labelEn: 'G', order: 0, sourceKind: 'builtin' } }),
    ]

    const groups = groupCopilotTools({ tools, recommendedToolIds: ['tool-a'] })
    expect(groups[0]?.tools[0]?.toolId).toBe('tool-a')
    expect(groups[0]?.tools[1]?.toolId).toBe('tool-b')
  })

  it('preserves insertion order for equal-priority tools', () => {
    const tools: RuntimeToolDirectoryEntry[] = [
      createTool({ toolId: 'first', availability: 'available', group: { id: 'g', label: 'G', labelZh: 'G', labelEn: 'G', order: 0, sourceKind: 'builtin' } }),
      createTool({ toolId: 'second', availability: 'available', group: { id: 'g', label: 'G', labelZh: 'G', labelEn: 'G', order: 0, sourceKind: 'builtin' } }),
    ]

    const groups = groupCopilotTools({ tools })
    expect(groups[0]?.tools[0]?.toolId).toBe('first')
    expect(groups[0]?.tools[1]?.toolId).toBe('second')
  })

  it('returns empty array for empty input', () => {
    expect(groupCopilotTools({ tools: [] })).toEqual([])
  })
})

describe('buildCopilotToolViewModels', () => {
  it('marks tools with deny policy as disabled', () => {
    const tools = [createTool({ toolId: TOOL_READ }), createTool({ toolId: TOOL_SEARCH })]
    const policy = createPolicy({
      toolPermissions: {
        [TOOL_SEARCH]: { mode: 'deny' },
      },
    })

    const viewModels = buildCopilotToolViewModels({ tools, policy })
    expect(viewModels).toHaveLength(2)
    expect(viewModels[0]).toEqual({ tool: tools[0], disabled: false, disabledReason: null })
    expect(viewModels[1]).toEqual({ tool: tools[1], disabled: true, disabledReason: 'policy' })
  })

  it('uses defaultMode deny to disable all tools', () => {
    const tools = [createTool({ toolId: TOOL_READ })]
    const policy = createPolicy({ defaultMode: 'deny' })

    const viewModels = buildCopilotToolViewModels({ tools, policy })
    expect(viewModels[0]).toEqual({ tool: tools[0], disabled: true, disabledReason: 'policy' })
  })

  it('marks all available tools enabled with null policy', () => {
    const tools = [createTool({ toolId: TOOL_READ })]
    const viewModels = buildCopilotToolViewModels({ tools, policy: null })
    expect(viewModels[0]).toEqual({ tool: tools[0], disabled: false, disabledReason: null })
  })

  it('marks unavailable tools disabled by availability even with null policy', () => {
    const tools = [createTool({ toolId: TOOL_SEARCH, availability: 'disabled-by-global-setting' })]
    const viewModels = buildCopilotToolViewModels({ tools, policy: null })
    expect(viewModels[0]).toEqual({ tool: tools[0], disabled: true, disabledReason: 'availability' })
  })

  it('returns empty array for empty tools', () => {
    expect(buildCopilotToolViewModels({ tools: [], policy: null })).toEqual([])
  })

  it('tool-specific deny overrides default allow', () => {
    const tools = [createTool({ toolId: TOOL_READ })]
    const policy = createPolicy({
      defaultMode: 'ask',
      toolPermissions: { [TOOL_READ]: { mode: 'deny' } },
    })

    const viewModels = buildCopilotToolViewModels({ tools, policy })
    expect(viewModels[0]).toEqual({ tool: tools[0], disabled: true, disabledReason: 'policy' })
  })
})

describe('sanitizeEnabledToolIds', () => {
  const tools: RuntimeToolDirectoryEntry[] = [
    createTool({ toolId: TOOL_READ }),
    createTool({ toolId: TOOL_SEARCH }),
    createTool({ toolId: TOOL_WRITE }),
  ]

  it('removes tool ids not present in the tool catalog', () => {
    const result = sanitizeEnabledToolIds({
      selectedToolIds: [TOOL_READ, 'tool.unknown'],
      tools,
      policy: null,
    })
    expect(result).toEqual([TOOL_READ])
  })

  it('removes denied tool ids', () => {
    const policy = createPolicy({
      toolPermissions: { [TOOL_SEARCH]: { mode: 'deny' } },
    })
    const result = sanitizeEnabledToolIds({
      selectedToolIds: [TOOL_READ, TOOL_SEARCH],
      tools,
      policy,
    })
    expect(result).toEqual([TOOL_READ])
  })

  it('removes denied tool ids via defaultMode deny', () => {
    const policy = createPolicy({ defaultMode: 'deny' })
    const result = sanitizeEnabledToolIds({
      selectedToolIds: [TOOL_READ],
      tools,
      policy,
    })
    expect(result).toEqual([])
  })

  it('deduplicates tool ids', () => {
    const result = sanitizeEnabledToolIds({
      selectedToolIds: [TOOL_READ, TOOL_READ, TOOL_SEARCH, TOOL_READ],
      tools,
      policy: null,
    })
    expect(result).toEqual([TOOL_READ, TOOL_SEARCH])
  })

  it('trims whitespace from tool ids', () => {
    const result = sanitizeEnabledToolIds({
      selectedToolIds: [`  ${TOOL_READ}  `, TOOL_SEARCH],
      tools,
      policy: null,
    })
    expect(result).toEqual([TOOL_READ, TOOL_SEARCH])
  })

  it('removes empty string tool ids', () => {
    const result = sanitizeEnabledToolIds({
      selectedToolIds: ['', TOOL_READ, '   '],
      tools,
      policy: null,
    })
    expect(result).toEqual([TOOL_READ])
  })

  it('returns empty array when no valid tools remain', () => {
    const result = sanitizeEnabledToolIds({
      selectedToolIds: ['tool.unknown'],
      tools,
      policy: null,
    })
    expect(result).toEqual([])
  })

  it('filters denied tools using defaultMode when no per-tool mode is set', () => {
    const policy = createPolicy({ defaultMode: 'deny' })
    const result = sanitizeEnabledToolIds({
      selectedToolIds: [TOOL_READ, TOOL_SEARCH],
      tools,
      policy,
    })
    expect(result).toEqual([])
  })

  it('removes unavailable tool ids even without a permission policy', () => {
    const unavailableTools = [
      createTool({ toolId: TOOL_READ }),
      createTool({ toolId: TOOL_SEARCH, availability: 'disabled-by-global-setting' }),
      createTool({ toolId: TOOL_WRITE, availability: 'unavailable' }),
    ]
    const result = sanitizeEnabledToolIds({
      selectedToolIds: [TOOL_READ, TOOL_SEARCH, TOOL_WRITE],
      tools: unavailableTools,
      policy: null,
    })
    expect(result).toEqual([TOOL_READ])
  })
})

describe('selectAllToolIds', () => {
  it('returns all tool ids sanitized', () => {
    const tools: RuntimeToolDirectoryEntry[] = [
      createTool({ toolId: TOOL_READ }),
      createTool({ toolId: TOOL_SEARCH }),
    ]
    const result = selectAllToolIds({ tools, policy: null })
    expect(result.sort()).toEqual([TOOL_READ, TOOL_SEARCH].sort())
  })

  it('excludes denied tools', () => {
    const tools = [createTool({ toolId: TOOL_READ }), createTool({ toolId: TOOL_SEARCH })]
    const policy = createPolicy({
      toolPermissions: { [TOOL_SEARCH]: { mode: 'deny' } },
    })
    const result = selectAllToolIds({ tools, policy })
    expect(result).toEqual([TOOL_READ])
  })

  it('excludes unavailable tools', () => {
    const tools = [
      createTool({ toolId: TOOL_READ }),
      createTool({ toolId: TOOL_SEARCH, availability: 'disabled-by-global-setting' }),
      createTool({ toolId: TOOL_WRITE, availability: 'unavailable' }),
    ]
    const result = selectAllToolIds({ tools, policy: null })
    expect(result).toEqual([TOOL_READ])
  })

  it('returns empty array for empty tools', () => {
    expect(selectAllToolIds({ tools: [], policy: null })).toEqual([])
  })
})

describe('invertToolSelection', () => {
  const tools: RuntimeToolDirectoryEntry[] = [
    createTool({ toolId: TOOL_READ }),
    createTool({ toolId: TOOL_SEARCH }),
    createTool({ toolId: TOOL_WRITE }),
  ]

  it('returns unselected tool ids', () => {
    const result = invertToolSelection({
      tools,
      selectedToolIds: [TOOL_READ],
      policy: null,
    })
    expect(result.sort()).toEqual([TOOL_SEARCH, TOOL_WRITE].sort())
  })

  it('excludes denied tools from inversion', () => {
    const policy = createPolicy({
      toolPermissions: { [TOOL_WRITE]: { mode: 'deny' } },
    })
    const result = invertToolSelection({
      tools,
      selectedToolIds: [TOOL_READ],
      policy,
    })
    expect(result).toEqual([TOOL_SEARCH])
  })

  it('returns all non-denied tools when nothing selected', () => {
    const result = invertToolSelection({
      tools,
      selectedToolIds: [],
      policy: null,
    })
    expect(result.sort()).toEqual([TOOL_READ, TOOL_SEARCH, TOOL_WRITE].sort())
  })

  it('returns empty array when all non-denied tools are selected', () => {
    const result = invertToolSelection({
      tools,
      selectedToolIds: [TOOL_READ, TOOL_SEARCH, TOOL_WRITE],
      policy: null,
    })
    expect(result).toEqual([])
  })

  it('excludes unavailable tools from inversion', () => {
    const unavailableTools = [
      createTool({ toolId: TOOL_READ }),
      createTool({ toolId: TOOL_SEARCH, availability: 'disabled-by-global-setting' }),
      createTool({ toolId: TOOL_WRITE }),
    ]
    const result = invertToolSelection({
      tools: unavailableTools,
      selectedToolIds: [TOOL_READ],
      policy: null,
    })
    expect(result).toEqual([TOOL_WRITE])
  })
})

describe('pickRecommendedToolIds', () => {
  const tools: RuntimeToolDirectoryEntry[] = [
    createTool({ toolId: TOOL_READ }),
    createTool({ toolId: TOOL_SEARCH }),
    createTool({ toolId: TOOL_WRITE }),
  ]

  it('picks only tools that are in the recommended set', () => {
    const result = pickRecommendedToolIds({
      tools,
      recommendedToolIds: [TOOL_READ, TOOL_SEARCH],
      policy: null,
    })
    expect(result.sort()).toEqual([TOOL_READ, TOOL_SEARCH].sort())
  })

  it('excludes denied recommended tools', () => {
    const policy = createPolicy({
      toolPermissions: { [TOOL_SEARCH]: { mode: 'deny' } },
    })
    const result = pickRecommendedToolIds({
      tools,
      recommendedToolIds: [TOOL_READ, TOOL_SEARCH],
      policy,
    })
    expect(result).toEqual([TOOL_READ])
  })

  it('excludes unavailable recommended tools', () => {
    const unavailableTools = [
      createTool({ toolId: TOOL_READ }),
      createTool({ toolId: TOOL_SEARCH, availability: 'disabled-by-global-setting' }),
      createTool({ toolId: TOOL_WRITE }),
    ]
    const result = pickRecommendedToolIds({
      tools: unavailableTools,
      recommendedToolIds: [TOOL_READ, TOOL_SEARCH, TOOL_WRITE],
      policy: null,
    })
    expect(result).toEqual([TOOL_READ, TOOL_WRITE])
  })

  it('returns empty array when no recommended tools match', () => {
    const result = pickRecommendedToolIds({
      tools,
      recommendedToolIds: ['tool.nonexistent'],
      policy: null,
    })
    expect(result).toEqual([])
  })

  it('returns empty array when recommendedToolIds is empty', () => {
    const result = pickRecommendedToolIds({
      tools,
      recommendedToolIds: [],
      policy: null,
    })
    expect(result).toEqual([])
  })
})

describe('toggleToolIdInSelection', () => {
  const policy = createPolicy({
    toolPermissions: { [TOOL_SEARCH]: { mode: 'deny' } },
  })

  it('adds a tool id when not in selection', () => {
    const result = toggleToolIdInSelection({
      selectedToolIds: [TOOL_READ],
      tool: createTool({ toolId: TOOL_WRITE }),
      policy: null,
    })
    expect(result.sort()).toEqual([TOOL_READ, TOOL_WRITE].sort())
  })

  it('removes a tool id when already in selection', () => {
    const result = toggleToolIdInSelection({
      selectedToolIds: [TOOL_READ, TOOL_SEARCH],
      tool: createTool({ toolId: TOOL_SEARCH }),
      policy: null,
    })
    expect(result).toEqual([TOOL_READ])
  })

  it('does not add a denied tool id', () => {
    const result = toggleToolIdInSelection({
      selectedToolIds: [TOOL_READ],
      tool: createTool({ toolId: TOOL_SEARCH }),
      policy,
    })
    expect(result).toEqual([TOOL_READ])
  })

  it('sanitizes selected tool ids when toggling a denied tool', () => {
    const result = toggleToolIdInSelection({
      selectedToolIds: [TOOL_READ, TOOL_READ, TOOL_SEARCH],
      tool: createTool({ toolId: TOOL_SEARCH }),
      policy,
    })
    expect(result).toEqual([TOOL_READ])
  })

  it('removes a denied tool from selection on toggle-off', () => {
    const result = toggleToolIdInSelection({
      selectedToolIds: [TOOL_READ, TOOL_SEARCH],
      tool: createTool({ toolId: TOOL_SEARCH }),
      policy,
    })
    expect(result).toEqual([TOOL_READ])
  })

  it('does not add an unavailable tool id', () => {
    const result = toggleToolIdInSelection({
      selectedToolIds: [TOOL_READ],
      tool: createTool({ toolId: TOOL_SEARCH, availability: 'disabled-by-global-setting' }),
      policy: null,
    })
    expect(result).toEqual([TOOL_READ])
  })

  it('removes an unavailable selected tool from selection on toggle-off', () => {
    const result = toggleToolIdInSelection({
      selectedToolIds: [TOOL_READ, TOOL_SEARCH],
      tool: createTool({ toolId: TOOL_SEARCH, availability: 'disabled-by-global-setting' }),
      policy: null,
    })
    expect(result).toEqual([TOOL_READ])
  })

  it('sanitizes tool ids on add', () => {
    const result = toggleToolIdInSelection({
      selectedToolIds: [TOOL_READ, TOOL_READ],
      tool: createTool({ toolId: TOOL_WRITE }),
      policy: null,
    })
    expect(result).toEqual([TOOL_READ, TOOL_WRITE])
  })

  it('handles empty initial selection', () => {
    const result = toggleToolIdInSelection({
      selectedToolIds: [],
      tool: createTool({ toolId: TOOL_READ }),
      policy: null,
    })
    expect(result).toEqual([TOOL_READ])
  })
})
