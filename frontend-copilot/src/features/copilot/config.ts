import { loadCopilotSettings } from './settings'
import type {
  CopilotConfigMissingField,
  CopilotConfigState,
  CopilotNormalizedSettings,
  CopilotRendererSettings,
  CopilotRendererSettingsLoadResult,
} from './types'

export function normalizeCopilotSettings(
  settings: Partial<CopilotRendererSettings> | null | undefined,
): CopilotNormalizedSettings {
  return {
    runtimeUrl: normalizeOptionalString(settings?.runtimeUrl),
    agentName: normalizeOptionalString(settings?.agentName),
  }
}

export function getMissingCopilotConfigFields(
  settings: CopilotNormalizedSettings,
): CopilotConfigMissingField[] {
  const missingFields: CopilotConfigMissingField[] = []

  if (settings.runtimeUrl === null) {
    missingFields.push('runtimeUrl')
  }

  if (settings.agentName === null) {
    missingFields.push('agentName')
  }

  return missingFields
}

export function resolveCopilotConfigState(
  loadResult: CopilotRendererSettingsLoadResult,
): CopilotConfigState {
  if (!loadResult.ok) {
    return {
      status: 'error',
      error: loadResult.error,
    }
  }

  const settings = normalizeCopilotSettings(loadResult.settings)
  const missingFields = getMissingCopilotConfigFields(settings)

  if (missingFields.length === 2) {
    return {
      status: 'empty',
      settings,
      storageState: loadResult.storageState,
    }
  }

  if (missingFields.length > 0) {
    return {
      status: 'incomplete',
      settings,
      storageState: loadResult.storageState,
      missingFields,
    }
  }

  return {
    status: 'ready',
    settings,
    storageState: loadResult.storageState,
    runtimeUrl: settings.runtimeUrl!,
    agentName: settings.agentName!,
  }
}

export async function loadCopilotConfigState(): Promise<CopilotConfigState> {
  const loadResult = await loadCopilotSettings()

  return resolveCopilotConfigState(loadResult)
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()

  return normalizedValue.length > 0 ? normalizedValue : null
}
