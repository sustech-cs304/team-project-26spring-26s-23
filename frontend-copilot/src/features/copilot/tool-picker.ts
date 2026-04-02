import type { RuntimeToolDirectoryEntry } from './thread-run-contract'

export interface CopilotToolGroup {
  key: string
  title: string
  tools: RuntimeToolDirectoryEntry[]
}

export function filterCopilotTools(input: {
  tools: RuntimeToolDirectoryEntry[]
  query: string
}): RuntimeToolDirectoryEntry[] {
  const normalizedQuery = input.query.trim().toLowerCase()

  return input.tools.filter((tool) => {
    if (normalizedQuery === '') {
      return true
    }

    const searchableText = [
      tool.toolId,
      tool.displayName ?? '',
      tool.description ?? '',
      tool.kind,
      tool.availability,
    ].join(' ').toLowerCase()

    return searchableText.includes(normalizedQuery)
  })
}

export function groupCopilotTools(tools: RuntimeToolDirectoryEntry[]): CopilotToolGroup[] {
  const groups = new Map<string, RuntimeToolDirectoryEntry[]>()

  for (const tool of tools) {
    const groupKey = tool.availability === 'available' ? 'available' : 'attention'
    const currentTools = groups.get(groupKey) ?? []
    currentTools.push(tool)
    groups.set(groupKey, currentTools)
  }

  return [...groups.entries()].map(([key, groupedTools]) => ({
    key,
    title: key === 'available' ? '可用工具' : '其他状态',
    tools: groupedTools,
  }))
}

export function selectAllToolIds(tools: RuntimeToolDirectoryEntry[]): string[] {
  return tools
    .map((tool) => tool.toolId.trim())
    .filter((toolId, index, toolIds) => toolId !== '' && toolIds.indexOf(toolId) === index)
}

export function invertToolSelection(
  tools: RuntimeToolDirectoryEntry[],
  selectedToolIds: string[],
): string[] {
  const selectedToolIdSet = new Set(selectedToolIds)

  return tools
    .map((tool) => tool.toolId)
    .filter((toolId) => !selectedToolIdSet.has(toolId))
}

export function pickRecommendedToolIds(input: {
  tools: RuntimeToolDirectoryEntry[]
  recommendedToolIds: string[]
}): string[] {
  const recommendedToolIdSet = new Set(input.recommendedToolIds)

  return input.tools
    .map((tool) => tool.toolId)
    .filter((toolId) => recommendedToolIdSet.has(toolId))
}

export function toggleToolIdInSelection(selectedToolIds: string[], toolId: string): string[] {
  return selectedToolIds.includes(toolId)
    ? selectedToolIds.filter((currentToolId) => currentToolId !== toolId)
    : [...selectedToolIds, toolId]
}
