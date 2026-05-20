import type { HostedBackendFailureCode, HostedBackendPhase } from './runtime/runtime-diagnostics'
import type { PythonRuntimeMode } from './runtime/python-runtime-resolver'
import type { HostedBackendStatus } from './runtime/runtime-state'

export const COPILOT_RUNTIME_LOAD_CHANNEL = 'copilot-runtime:load'
export const COPILOT_RUNTIME_RETRY_CHANNEL = 'copilot-runtime:retry'
export const COPILOT_RUNTIME_LOCAL_TOKEN_CHANNEL = 'copilot-runtime:local-token'

export interface CopilotHostedRuntimeFailureSummary {
  code: HostedBackendFailureCode
  phase: HostedBackendPhase
  message: string
  retryable: boolean
  exitCode: number | null
  signal: string | null
  timestamp: string
}

export interface CopilotHostedRuntimeSnapshot {
  status: HostedBackendStatus
  expectedMode: PythonRuntimeMode
  resolvedMode: PythonRuntimeMode | null
  runtimeUrl: string | null
  isPackaged: boolean
  failure: CopilotHostedRuntimeFailureSummary | null
}

export interface CopilotRuntimeSnapshot {
  hosted: CopilotHostedRuntimeSnapshot
}

export interface CopilotRuntimeLoadSuccess {
  ok: true
  snapshot: CopilotRuntimeSnapshot
}

export interface CopilotRuntimeLoadFailure {
  ok: false
  error: string
}

export type CopilotRuntimeLoadResult = CopilotRuntimeLoadSuccess | CopilotRuntimeLoadFailure
export type CopilotRuntimeRetryResult = CopilotRuntimeLoadResult

export interface CopilotRuntimeApi {
  load: () => Promise<CopilotRuntimeLoadResult>
  retry: () => Promise<CopilotRuntimeRetryResult>
  getLocalToken: () => Promise<string | null>
}
