import type {
  CopilotSettings,
  CopilotSettingsLoadResult,
  CopilotSettingsPatch,
  CopilotSettingsSaveResult,
  CopilotSettingsStorageState,
} from '../../../electron/copilot-settings'

export type CopilotRendererSettings = CopilotSettings
export type CopilotRendererSettingsPatch = CopilotSettingsPatch
export type CopilotRendererSettingsLoadResult = CopilotSettingsLoadResult
export type CopilotRendererSettingsSaveResult = CopilotSettingsSaveResult
export type CopilotRendererSettingsStorageState = CopilotSettingsStorageState

export type CopilotConfigStatus = 'empty' | 'incomplete' | 'ready' | 'error'
export type CopilotConfigMissingField = 'runtimeUrl' | 'agentName'

export interface CopilotNormalizedSettings {
  runtimeUrl: string | null
  agentName: string | null
}

interface CopilotConfigResolvedStateBase {
  settings: CopilotNormalizedSettings
  storageState: CopilotRendererSettingsStorageState
}

export interface CopilotConfigEmptyState extends CopilotConfigResolvedStateBase {
  status: 'empty'
}

export interface CopilotConfigIncompleteState extends CopilotConfigResolvedStateBase {
  status: 'incomplete'
  missingFields: CopilotConfigMissingField[]
}

export interface CopilotConfigReadyState extends CopilotConfigResolvedStateBase {
  status: 'ready'
  runtimeUrl: string
  agentName: string
}

export interface CopilotConfigErrorState {
  status: 'error'
  error: string
}

export type CopilotConfigState =
  | CopilotConfigEmptyState
  | CopilotConfigIncompleteState
  | CopilotConfigReadyState
  | CopilotConfigErrorState
