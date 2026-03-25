import type {
  CopilotHostedRuntimeFailureSummary,
  CopilotHostedRuntimeSnapshot,
  CopilotRuntimeLoadResult,
  CopilotRuntimeRetryResult,
} from '../../../electron/copilot-runtime'
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

export type CopilotRendererRuntimeSnapshot = CopilotHostedRuntimeSnapshot
export type CopilotRendererRuntimeFailureSummary = CopilotHostedRuntimeFailureSummary
export type CopilotRendererRuntimeLoadResult = CopilotRuntimeLoadResult
export type CopilotRendererRuntimeRetryResult = CopilotRuntimeRetryResult

export type CopilotConfigStatus = 'empty' | 'incomplete' | 'starting' | 'ready' | 'failed' | 'degraded' | 'error'
export type CopilotConfigMissingField = 'runtimeUrl' | 'agentName'
export type CopilotRuntimeSource = 'hosted' | 'dev-override' | 'none'
export type CopilotAgentNameSource = 'settings' | 'missing'
export type CopilotModeSource = 'resolved' | 'expected'

export interface CopilotNormalizedSettings {
  runtimeUrl: string | null
  agentName: string | null
}

export interface CopilotDiagnosticsSummary {
  hostedStatus: CopilotRendererRuntimeSnapshot['status']
  failure: CopilotRendererRuntimeFailureSummary | null
  mode: CopilotRendererRuntimeSnapshot['resolvedMode'] | CopilotRendererRuntimeSnapshot['expectedMode']
  modeSource: CopilotModeSource
  runtimeSource: CopilotRuntimeSource
}

interface CopilotConfigResolvedStateBase {
  settings: CopilotNormalizedSettings
  storageState: CopilotRendererSettingsStorageState
  runtime: CopilotRendererRuntimeSnapshot
  runtimeUrl: string | null
  runtimeSource: CopilotRuntimeSource
  agentName: string | null
  agentNameSource: CopilotAgentNameSource
  diagnostics: CopilotDiagnosticsSummary
  devOverrideAllowed: boolean
  devOverrideConfigured: boolean
}

export interface CopilotConfigEmptyState extends CopilotConfigResolvedStateBase {
  status: 'empty'
  missingFields: CopilotConfigMissingField[]
}

export interface CopilotConfigIncompleteState extends CopilotConfigResolvedStateBase {
  status: 'incomplete'
  missingFields: CopilotConfigMissingField[]
}

export interface CopilotConfigStartingState extends CopilotConfigResolvedStateBase {
  status: 'starting'
}

export interface CopilotConfigReadyState extends CopilotConfigResolvedStateBase {
  status: 'ready'
  runtimeUrl: string
  agentName: string
}

export interface CopilotConfigFailedState extends CopilotConfigResolvedStateBase {
  status: 'failed'
}

export interface CopilotConfigDegradedState extends CopilotConfigResolvedStateBase {
  status: 'degraded'
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
  | CopilotConfigStartingState
  | CopilotConfigReadyState
  | CopilotConfigFailedState
  | CopilotConfigDegradedState
  | CopilotConfigErrorState

export type CopilotConnectableState = CopilotConfigReadyState | CopilotConfigDegradedState
export type CopilotBootstrapState = CopilotConfigState | { status: 'loading' }

export interface CopilotBootstrapController {
  state: CopilotBootstrapState
  retrying: boolean
  retry: () => void
}
