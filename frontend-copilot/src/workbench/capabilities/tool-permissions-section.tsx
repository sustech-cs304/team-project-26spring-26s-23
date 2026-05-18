/** Tool-permission policy helpers for CapabilitiesWorkspace. */

import type {
  LegacyToolPermissionMode,
  SettingsWorkspaceToolPermissionPolicyState,
  ToolPermissionPolicyMode,
  ToolPermissionPolicySource,
} from '../../../electron/settings-workspace/schema'
import type { RuntimeToolDirectoryEntry } from '../../features/copilot/chat-contract'
import {
  resolveCopilotToolPlatformGroup,
  resolveCopilotToolPresentation,
} from '../../features/copilot/tool-presentation'
import type {
  ToolPermissionDelayAction,
  ToolPermissionRecord,
} from './capabilities-demo'

export const FALLBACK_DELAY_ACTION: ToolPermissionDelayAction = 'approve'
export const FALLBACK_DELAY_SECONDS = 15
export const TOOL_PERMISSION_UPDATED_AT = '2026-04-17T00:00:00.000Z'

export function buildToolPermissionRecords(
  toolCatalog: RuntimeToolDirectoryEntry[],
  policy: SettingsWorkspaceToolPermissionPolicyState,
): ToolPermissionRecord[] {
  return toolCatalog.map((tool, index) => {
    const persisted = policy.toolPermissions[tool.toolId]
    const resolvedMode = persisted?.mode ?? policy.defaultMode
    const presentation = resolveCopilotToolPresentation(tool)
    const platformGroup = resolveCopilotToolPlatformGroup(tool)

    return {
      id: tool.toolId,
      groupId: platformGroup.key,
      groupLabel: platformGroup.title,
      groupOrder: platformGroup.order,
      name: presentation.name,
      description: presentation.description,
      toolId: tool.toolId,
      mode: resolvedMode,
      delayAction: persisted?.mode === 'delay' && (persisted.timeoutAction === 'approve' || persisted.timeoutAction === 'deny')
        ? persisted.timeoutAction
        : FALLBACK_DELAY_ACTION,
      delaySeconds: persisted?.mode === 'delay' && typeof persisted.timeoutSeconds === 'number'
        ? Math.max(3, Math.min(300, persisted.timeoutSeconds))
        : FALLBACK_DELAY_SECONDS + index,
    }
  })
}

export function buildPolicyStateFromTools(
  tools: ToolPermissionRecord[],
  previousPolicy: SettingsWorkspaceToolPermissionPolicyState,
): SettingsWorkspaceToolPermissionPolicyState {
  const defaultMode = resolveDefaultMode(tools, previousPolicy.defaultMode, previousPolicy)
  const toolPermissions = {
    ...collectPersistedOrphanPolicies(previousPolicy, tools),
    ...Object.fromEntries(tools.flatMap((tool) => {
      const normalizedMode = tool.mode === 'delay' ? 'ask' : tool.mode

      if (normalizedMode === defaultMode && tool.mode !== 'delay') {
        return []
      }

      const nextEntry = {
        mode: tool.mode,
        ...(tool.mode === 'delay'
          ? {
              timeoutAction: tool.delayAction,
              timeoutSeconds: tool.delaySeconds,
            }
          : {}),
        source: 'user' as ToolPermissionPolicySource,
        updatedAt: TOOL_PERMISSION_UPDATED_AT,
      }

      return [[tool.toolId, nextEntry]]
    })),
  }

  return {
    version: 1,
    defaultMode,
    toolPermissions,
  }
}

function resolveDefaultMode(
  tools: ToolPermissionRecord[],
  fallbackMode: ToolPermissionPolicyMode,
  previousPolicy?: SettingsWorkspaceToolPermissionPolicyState,
): ToolPermissionPolicyMode {
  if (previousPolicy !== undefined) {
    const knownToolIds = new Set(tools.map((tool) => tool.toolId))
    const hasOrphanPolicies = Object.keys(previousPolicy.toolPermissions).some((toolId) => !knownToolIds.has(toolId))
    if (hasOrphanPolicies) {
      return fallbackMode
    }
  }

  const counts = {
    allow: 0,
    ask: 0,
    deny: 0,
  }

  if (tools.length === 0) {
    return fallbackMode
  }

  for (const tool of tools) {
    const normalizedMode = tool.mode === 'delay' ? 'ask' : tool.mode
    counts[normalizedMode] += 1
  }

  if (counts.allow >= counts.ask && counts.allow >= counts.deny) {
    return 'allow'
  }
  if (counts.deny >= counts.ask) {
    return 'deny'
  }
  return 'ask'
}

function collectPersistedOrphanPolicies(
  previousPolicy: SettingsWorkspaceToolPermissionPolicyState,
  tools: ToolPermissionRecord[],
): Record<string, SettingsWorkspaceToolPermissionPolicyState['toolPermissions'][string]> {
  const knownToolIds = new Set(tools.map((tool) => tool.toolId))

  return Object.fromEntries(Object.entries(previousPolicy.toolPermissions).flatMap(([toolId, policyEntry]) => {
    return knownToolIds.has(toolId) ? [] : [[toolId, policyEntry]]
  }))
}

export function mapDefaultModeToLegacyMode(mode: ToolPermissionPolicyMode): LegacyToolPermissionMode {
  switch (mode) {
    case 'allow':
      return 'trusted'
    case 'deny':
      return 'strict'
    case 'ask':
    default:
      return 'manual'
  }
}
