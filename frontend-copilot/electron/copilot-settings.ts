export const COPILOT_SETTINGS_LOAD_CHANNEL = 'copilot-settings:load'
export const COPILOT_SETTINGS_SAVE_CHANNEL = 'copilot-settings:save'

export interface CopilotSettings {
  runtimeUrl: string | null
  agentName: string | null
}

export interface CopilotSettingsPatch {
  runtimeUrl?: string | null
  agentName?: string | null
}

export type CopilotSettingsStorageState = 'empty' | 'stored'

export interface CopilotSettingsLoadSuccess {
  ok: true
  settings: CopilotSettings
  storageState: CopilotSettingsStorageState
}

export interface CopilotSettingsLoadFailure {
  ok: false
  error: string
}

export type CopilotSettingsLoadResult = CopilotSettingsLoadSuccess | CopilotSettingsLoadFailure

export interface CopilotSettingsSaveSuccess {
  ok: true
  settings: CopilotSettings
  storageState: CopilotSettingsStorageState
}

export interface CopilotSettingsSaveFailure {
  ok: false
  error: string
}

export type CopilotSettingsSaveResult = CopilotSettingsSaveSuccess | CopilotSettingsSaveFailure

export interface CopilotSettingsApi {
  load: () => Promise<CopilotSettingsLoadResult>
  save: (patch: CopilotSettingsPatch) => Promise<CopilotSettingsSaveResult>
}

export function normalizeCopilotSettings(input: unknown): CopilotSettings {
  const record = typeof input === 'object' && input !== null
    ? input as Record<string, unknown>
    : {}

  return {
    runtimeUrl: normalizeOptionalString(record.runtimeUrl),
    agentName: normalizeOptionalString(record.agentName),
  }
}

export function mergeCopilotSettings(current: CopilotSettings, patch: CopilotSettingsPatch): CopilotSettings {
  return normalizeCopilotSettings({
    ...current,
    ...patch,
  })
}

export function getCopilotSettingsStorageState(settings: CopilotSettings): CopilotSettingsStorageState {
  return settings.runtimeUrl === null && settings.agentName === null ? 'empty' : 'stored'
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()

  return normalizedValue.length > 0 ? normalizedValue : null
}
