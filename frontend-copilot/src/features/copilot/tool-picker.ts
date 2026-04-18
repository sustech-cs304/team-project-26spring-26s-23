import type { RuntimeToolDirectoryEntry } from './thread-run-contract'
import {
  resolveCopilotToolPlatformGroup,
  resolveCopilotToolPresentation,
} from './tool-presentation'

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

    const presentation = resolveCopilotToolPresentation(tool)
    const platformGroup = resolveCopilotToolPlatformGroup(tool)
    const searchableText = [
      tool.toolId,
      tool.displayName ?? '',
      tool.description ?? '',
      tool.kind,
      tool.availability,
      platformGroup.title,
      ...platformGroup.searchKeywords,
      ...presentation.searchKeywords,
    ].join(' ').toLowerCase()

    return searchableText.includes(normalizedQuery)
  })
}

export function groupCopilotTools(input: {
  tools: RuntimeToolDirectoryEntry[]
  recommendedToolIds?: string[]
}): CopilotToolGroup[] {
  const groups = new Map<string, {
    key: string
    title: string
    order: number
    creationIndex: number
    tools: Array<{
      tool: RuntimeToolDirectoryEntry
      index: number
    }>
  }>()
  const recommendedToolIdSet = new Set(input.recommendedToolIds ?? [])

  input.tools.forEach((tool, index) => {
    const platformGroup = resolveCopilotToolPlatformGroup(tool)
    const currentGroup = groups.get(platformGroup.key)

    if (currentGroup === undefined) {
      groups.set(platformGroup.key, {
        key: platformGroup.key,
        title: platformGroup.title,
        order: platformGroup.order,
        creationIndex: index,
        tools: [{ tool, index }],
      })
      return
    }

    currentGroup.tools.push({ tool, index })
  })

  return [...groups.values()]
    .sort((left, right) => {
      const byOrder = left.order - right.order
      if (byOrder !== 0) {
        return byOrder
      }

      const byTitle = left.title.localeCompare(right.title, 'zh-CN')
      if (byTitle !== 0) {
        return byTitle
      }

      return left.creationIndex - right.creationIndex
    })
    .map((group) => ({
      key: group.key,
      title: group.title,
      tools: [...group.tools]
        .sort((left, right) => compareGroupedTools(left, right, recommendedToolIdSet))
        .map((entry) => entry.tool),
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

function compareGroupedTools(
  left: {
    tool: RuntimeToolDirectoryEntry
    index: number
  },
  right: {
    tool: RuntimeToolDirectoryEntry
    index: number
  },
  recommendedToolIdSet: Set<string>,
): number {
  const availabilityDelta = resolveAvailabilityOrder(left.tool.availability) - resolveAvailabilityOrder(right.tool.availability)
  if (availabilityDelta !== 0) {
    return availabilityDelta
  }

  const recommendationDelta = resolveRecommendationOrder(left.tool.toolId, recommendedToolIdSet)
    - resolveRecommendationOrder(right.tool.toolId, recommendedToolIdSet)
  if (recommendationDelta !== 0) {
    return recommendationDelta
  }

  return left.index - right.index
}

function resolveAvailabilityOrder(availability: string): number {
  switch (availability) {
    case 'available':
      return 0
    case 'disabled-by-global-setting':
    case 'unavailable':
      return 1
    default:
      return 2
  }
}

function resolveRecommendationOrder(toolId: string, recommendedToolIdSet: Set<string>): number {
  return recommendedToolIdSet.has(toolId) ? 0 : 1
}
