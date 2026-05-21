import type { SettingsWorkspaceToolPermissionPolicyState } from '../../../electron/settings-workspace/schema'
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

export interface CopilotToolViewModel {
  tool: RuntimeToolDirectoryEntry
  disabled: boolean
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

export function buildCopilotToolViewModels(input: {
  tools: RuntimeToolDirectoryEntry[]
  policy: SettingsWorkspaceToolPermissionPolicyState | null
}): CopilotToolViewModel[] {
  return input.tools.map((tool) => ({
    tool,
    disabled: isCopilotToolDenied(tool.toolId, input.policy),
  }))
}

export function sanitizeEnabledToolIds(input: {
  selectedToolIds: readonly string[]
  tools: readonly RuntimeToolDirectoryEntry[]
  policy: SettingsWorkspaceToolPermissionPolicyState | null
}): string[] {
  const knownToolIdSet = new Set(input.tools.map((tool) => tool.toolId))

  return dedupeToolIds(input.selectedToolIds).filter((toolId) => {
    return knownToolIdSet.has(toolId) && !isCopilotToolDenied(toolId, input.policy)
  })
}

export function selectAllToolIds(input: {
  tools: RuntimeToolDirectoryEntry[]
  policy: SettingsWorkspaceToolPermissionPolicyState | null
}): string[] {
  return sanitizeEnabledToolIds({
    selectedToolIds: input.tools.map((tool) => tool.toolId.trim()),
    tools: input.tools,
    policy: input.policy,
  })
}

export function invertToolSelection(input: {
  tools: RuntimeToolDirectoryEntry[]
  selectedToolIds: string[]
  policy: SettingsWorkspaceToolPermissionPolicyState | null
}): string[] {
  const selectedToolIdSet = new Set(sanitizeEnabledToolIds({
    selectedToolIds: input.selectedToolIds,
    tools: input.tools,
    policy: input.policy,
  }))

  return input.tools
    .map((tool) => tool.toolId)
    .filter((toolId) => !selectedToolIdSet.has(toolId) && !isCopilotToolDenied(toolId, input.policy))
}

export function pickRecommendedToolIds(input: {
  tools: RuntimeToolDirectoryEntry[]
  recommendedToolIds: string[]
  policy: SettingsWorkspaceToolPermissionPolicyState | null
}): string[] {
  const recommendedToolIdSet = new Set(input.recommendedToolIds)

  return sanitizeEnabledToolIds({
    selectedToolIds: input.tools
      .map((tool) => tool.toolId)
      .filter((toolId) => recommendedToolIdSet.has(toolId)),
    tools: input.tools,
    policy: input.policy,
  })
}

export function toggleToolIdInSelection(input: {
  selectedToolIds: string[]
  toolId: string
  policy: SettingsWorkspaceToolPermissionPolicyState | null
}): string[] {
  if (input.selectedToolIds.includes(input.toolId)) {
    return sanitizeSelectedToolIds(
      input.selectedToolIds.filter((currentToolId) => currentToolId !== input.toolId),
    )
  }

  if (isCopilotToolDenied(input.toolId, input.policy)) {
    return sanitizeSelectedToolIds(input.selectedToolIds)
  }

  return [...sanitizeSelectedToolIds(input.selectedToolIds), input.toolId]
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

function isCopilotToolDenied(toolId: string, policy: SettingsWorkspaceToolPermissionPolicyState | null): boolean {
  const mode = policy?.toolPermissions[toolId]?.mode ?? policy?.defaultMode ?? null
  return mode === 'deny'
}

function sanitizeSelectedToolIds(selectedToolIds: readonly string[]): string[] {
  return dedupeToolIds(selectedToolIds)
}

function dedupeToolIds(toolIds: readonly string[]): string[] {
  return toolIds
    .map((toolId) => toolId.trim())
    .filter((toolId, index, values) => toolId !== '' && values.indexOf(toolId) === index)
}
