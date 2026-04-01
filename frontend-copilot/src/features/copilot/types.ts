import type {
  CopilotHostedRuntimeFailureSummary,
  CopilotHostedRuntimeSnapshot,
  CopilotRuntimeLoadResult,
  CopilotRuntimeRetryResult,
} from '../../../electron/copilot-runtime'
import type { RuntimeModelRoute } from './chat-contract'

export interface CopilotBootstrapFields {
  runtimeUrl: string | null
  agentName: string | null
}

export interface CopilotBootstrapFieldsLoadSuccess {
  ok: true
  fields: CopilotBootstrapFields
  storageState: 'empty' | 'stored'
}

export interface CopilotBootstrapFieldsLoadFailure {
  ok: false
  error: string
}

export type CopilotBootstrapFieldsLoadResult =
  | CopilotBootstrapFieldsLoadSuccess
  | CopilotBootstrapFieldsLoadFailure

export type CopilotBootstrapFieldsStorageState = CopilotBootstrapFieldsLoadSuccess['storageState']

export type CopilotRendererRuntimeSnapshot = CopilotHostedRuntimeSnapshot
export type CopilotRendererRuntimeFailureSummary = CopilotHostedRuntimeFailureSummary
export type CopilotRendererRuntimeLoadResult = CopilotRuntimeLoadResult
export type CopilotRendererRuntimeRetryResult = CopilotRuntimeRetryResult

export type CopilotConfigStatus = 'empty' | 'incomplete' | 'starting' | 'ready' | 'failed' | 'degraded' | 'error'
export type CopilotConfigMissingField = 'runtimeUrl'
export type CopilotRuntimeSource = 'hosted' | 'dev-override' | 'none'
export type CopilotAgentNameSource = 'config-center' | 'missing'
export type CopilotModeSource = 'resolved' | 'expected'
export type CopilotRunPhase = 'idle' | 'starting' | 'streaming' | 'completed' | 'failed' | 'cancelled'

export interface CopilotDiagnosticsSummary {
  hostedStatus: CopilotRendererRuntimeSnapshot['status']
  failure: CopilotRendererRuntimeFailureSummary | null
  mode: CopilotRendererRuntimeSnapshot['resolvedMode'] | CopilotRendererRuntimeSnapshot['expectedMode']
  modeSource: CopilotModeSource
  runtimeSource: CopilotRuntimeSource
}

export interface CopilotRunDiagnosticSummary {
  code: string
  message: string
  stage: string
  details: Record<string, unknown>
}

export interface CopilotRunFailureSummary {
  code: string
  message: string
  details: Record<string, unknown>
}

export interface CopilotRunState {
  phase: CopilotRunPhase
  runId: string | null
  sessionId: string | null
  assistantMessageId: string | null
  activeModelRoute: RuntimeModelRoute | null
  resolvedModelId: string | null
  resolvedModelRoute: RuntimeModelRoute | null
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
  diagnostic: CopilotRunDiagnosticSummary | null
  failure: CopilotRunFailureSummary | null
  cancelReason: string | null
}

interface CopilotConfigResolvedStateBase {
  bootstrapFields: CopilotBootstrapFields
  storageState: CopilotBootstrapFieldsStorageState
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
}

export interface CopilotConfigFailedState extends CopilotConfigResolvedStateBase {
  status: 'failed'
}

export interface CopilotConfigDegradedState extends CopilotConfigResolvedStateBase {
  status: 'degraded'
  runtimeUrl: string
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
