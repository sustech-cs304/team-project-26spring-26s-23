import type {
  CopilotBootstrapState,
  CopilotConfigState,
  CopilotConnectableState,
  CopilotDiagnosticsSummary,
} from './types'

export interface CopilotPanelDetail {
  label: string
  value: string
}

export function isCopilotConnectableState(
  state: CopilotBootstrapState,
): state is CopilotConnectableState {
  return state.status === 'ready' || state.status === 'degraded'
}

export function buildCopilotRuntimeDetails(
  state: Exclude<CopilotConfigState, { status: 'error' }>,
): CopilotPanelDetail[] {
  void state
  return []
}

export function formatCopilotFailureSummary(
  diagnostics: CopilotDiagnosticsSummary,
): string {
  const failure = diagnostics.failure

  if (failure === null) {
    return '当前无法连接服务，请稍后重试。'
  }

  return failure.retryable
    ? '当前无法连接服务，请重试。'
    : '当前无法连接服务，请检查设置后重试。'
}

export function canRetryCopilotRuntime(state: CopilotConfigState): boolean {
  return state.status === 'failed'
    && state.diagnostics.failure !== null
    && state.diagnostics.failure.retryable
}
