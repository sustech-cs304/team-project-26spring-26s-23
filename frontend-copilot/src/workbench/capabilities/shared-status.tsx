/** Shared status display helpers for CapabilitiesWorkspace. */

import type { RuntimeToolDirectoryEntry, RuntimeToolPresentationGroup } from '../../features/copilot/chat-contract'

export interface ToolCatalogLoadState {
  status: 'idle' | 'ready' | 'fallback' | 'error'
  error: string | null
  source: 'runtime' | 'fallback' | null
  directoryVersion: string | null
}

export const FALLBACK_TOOL_CATALOG_ERROR = 'Hosted backend runtime tool catalog is temporarily unavailable. Using built-in fallback catalog.'
export const EMPTY_TOOL_CATALOG_ERROR = 'Hosted backend returned an empty tool catalog. Using built-in fallback catalog.'
export const INCOMPLETE_TOOL_CATALOG_WARNING = 'Hosted backend returned an incomplete tool catalog. Invalid entries were dropped while keeping valid tools visible.'

export function resolveRenderableToolCatalog(
  result: { ok: true, tools: RuntimeToolDirectoryEntry[], warnings?: string[] } | { ok: false, error: string },
): {
  status: ToolCatalogLoadState['status']
  error: string | null
  source: ToolCatalogLoadState['source']
  tools: RuntimeToolDirectoryEntry[]
} {
  if (!result.ok) {
    return {
      status: 'fallback',
      error: FALLBACK_TOOL_CATALOG_ERROR,
      source: 'fallback',
      tools: createStaticFallbackToolCatalog(),
    }
  }

  const completeTools = result.tools.filter(isRenderableToolCatalogEntry)
  if (completeTools.length === 0) {
    return {
      status: 'fallback',
      error: EMPTY_TOOL_CATALOG_ERROR,
      source: 'fallback',
      tools: createStaticFallbackToolCatalog(),
    }
  }

  if (completeTools.length !== result.tools.length) {
    return {
      status: 'ready',
      error: INCOMPLETE_TOOL_CATALOG_WARNING,
      source: 'runtime',
      tools: completeTools,
    }
  }

  return {
    status: 'ready',
    error: result.warnings?.[0] ?? null,
    source: 'runtime',
    tools: completeTools,
  }
}

export function isRenderableToolCatalogEntry(tool: RuntimeToolDirectoryEntry): boolean {
  return typeof tool.toolId === 'string'
    && tool.toolId.trim() !== ''
    && typeof resolveToolLabel(tool) === 'string'
    && resolveToolLabel(tool).trim() !== ''
}

export function resolveToolLabel(tool: RuntimeToolDirectoryEntry): string {
  return tool.displayNameZh ?? tool.displayName ?? tool.displayNameEn ?? tool.toolId
}

export const FALLBACK_TOOL_GROUPS: Record<string, RuntimeToolPresentationGroup> = {
  'builtin-core': {
    id: 'builtin-core',
    label: '内置基础工具',
    labelZh: '内置基础工具',
    labelEn: 'Built-in Core Tools',
    order: 0,
    sourceKind: 'builtin',
  },
  blackboard: {
    id: 'blackboard',
    label: 'Blackboard 工具',
    labelZh: 'Blackboard 工具',
    labelEn: 'Blackboard Tools',
    order: 10,
    sourceKind: 'sustech-blackboard',
  },
  tis: {
    id: 'tis',
    label: 'TIS 工具',
    labelZh: 'TIS 工具',
    labelEn: 'TIS Tools',
    order: 20,
    sourceKind: 'sustech-tis',
  },
  mcp: {
    id: 'mcp',
    label: 'MCP 工具',
    labelZh: 'MCP 工具',
    labelEn: 'MCP Tools',
    order: 100,
    sourceKind: 'mcp-server',
  },
}

export function createStaticFallbackToolCatalog(): RuntimeToolDirectoryEntry[] {
  return [
    {
      toolId: 'tool.fs.read',
      kind: 'builtin',
      availability: 'available',
      displayName: '读取文件',
      description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
      group: FALLBACK_TOOL_GROUPS['builtin-core'],
    },
    {
      toolId: 'tool.fs.write',
      kind: 'builtin',
      availability: 'available',
      displayName: '写入文件',
      description: '创建或覆盖文件内容，用于输出生成结果与落盘修改。',
      group: FALLBACK_TOOL_GROUPS['builtin-core'],
    },
    {
      toolId: 'tool.fs.edit',
      kind: 'builtin',
      availability: 'available',
      displayName: '编辑文件',
      description: '对现有文件执行精确编辑，适用于补丁式修改与小范围更新。',
      group: FALLBACK_TOOL_GROUPS['builtin-core'],
    },
    {
      toolId: 'mcp--fetch--fetch',
      kind: 'external',
      availability: 'available',
      displayName: '联网抓取',
      description: '抓取网页内容，用于补充外部说明与页面上下文。',
      group: FALLBACK_TOOL_GROUPS.mcp,
    },
    {
      toolId: 'mcp--puppeteer--puppeteer_navigate',
      kind: 'external',
      availability: 'available',
      displayName: '浏览器自动化',
      description: '驱动浏览器执行界面级操作，用于录制流程或验证可见交互。',
      group: FALLBACK_TOOL_GROUPS.mcp,
    },
  ]
}

export function resolveToolPermissionStatusMessage(state: ToolCatalogLoadState): string | null {
  if (state.error !== null) {
    return state.error
  }

  if (state.status === 'fallback' || state.status === 'error') {
    return '工具目录暂时不可用，当前显示内建降级目录。'
  }

  return null
}
