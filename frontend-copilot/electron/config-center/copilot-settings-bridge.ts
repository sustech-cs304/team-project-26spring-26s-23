import { normalizeCopilotSettings } from '../copilot-settings'
import type { UnifiedConfigFieldPatch } from './schema'

/**
 * Converts the legacy Copilot settings disk format into unified config field patches.
 * This bridge exists only for main-process migration from old settings files.
 */
export function extractLegacyCopilotSettingsMigrationPatch(input: unknown): UnifiedConfigFieldPatch | null {
  const settings = normalizeCopilotSettings(input)
  const fieldPatch: UnifiedConfigFieldPatch = {}

  if (settings.runtimeUrl !== null) {
    fieldPatch.runtimeUrl = settings.runtimeUrl
  }

  if (settings.agentName !== null) {
    fieldPatch.agentName = settings.agentName
  }

  return Object.keys(fieldPatch).length > 0 ? fieldPatch : null
}
