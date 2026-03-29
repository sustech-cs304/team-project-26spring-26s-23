import {
  formatModeSummary,
  formatRuntimeSource,
} from './copilot-chat-helpers'
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
  const details: CopilotPanelDetail[] = [
    {
      label: '宿主状态',
      value: state.diagnostics.hostedStatus,
    },
    {
      label: '运行模式',
      value: formatModeSummary(state.diagnostics),
    },
    {
      label: 'Runtime 来源',
      value: formatRuntimeSource(state.runtimeSource),
    },
  ]

  if (state.runtimeUrl !== null) {
    details.push({
      label: '当前 Runtime URL',
      value: state.runtimeUrl,
    })
  }

  if (state.diagnostics.failure !== null) {
    details.push({
      label: '失败摘要',
      value: `${state.diagnostics.failure.code} / ${state.diagnostics.failure.phase}`,
    })
  }

  return details
}

export function formatCopilotFailureSummary(
  diagnostics: CopilotDiagnosticsSummary,
): string {
  const failure = diagnostics.failure

  if (failure === null) {
    return 'No hosted failure summary.'
  }

  const lines = [
    `状态：${diagnostics.hostedStatus}`,
    `模式：${formatModeSummary(diagnostics)}`,
    `失败代码：${failure.code}`,
    `阶段：${failure.phase}`,
    `消息：${failure.message}`,
  ]

  if (failure.exitCode !== null) {
    lines.push(`退出码：${failure.exitCode}`)
  }

  if (failure.signal !== null) {
    lines.push(`信号：${failure.signal}`)
  }

  lines.push(`可重试：${failure.retryable ? '是' : '否'}`)
  lines.push(`记录时间：${failure.timestamp}`)

  return lines.join('\n')
}

export function canRetryCopilotRuntime(state: CopilotConfigState): boolean {
  return state.status === 'failed'
    && state.diagnostics.failure !== null
    && state.diagnostics.failure.retryable
}
