import type { CopilotSettings, CopilotSettingsPatch } from '../copilot-settings'
import { normalizeCopilotSettings } from '../copilot-settings'
import {
  UNIFIED_CONFIG_DOMAIN_KEYS,
  type UnifiedConfigFieldPatch,
  type UnifiedConfigSnapshot,
} from './schema'

export function projectCopilotSettings(snapshot: UnifiedConfigSnapshot): CopilotSettings {
  return {
    runtimeUrl: snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl,
    agentName: snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName,
  }
}

export function projectCopilotSettingsPatch(patch: CopilotSettingsPatch): UnifiedConfigFieldPatch {
  const fieldPatch: UnifiedConfigFieldPatch = {}

  if ('runtimeUrl' in patch) {
    fieldPatch.runtimeUrl = patch.runtimeUrl
  }

  if ('agentName' in patch) {
    fieldPatch.agentName = patch.agentName
  }

  return fieldPatch
}

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
