import type { CopilotConversationTurn } from './copilot-chat-helpers'
import {
  cloneRuntimeThinkingCapability as cloneRuntimeThinkingCapabilityValue,
  type RuntimeThinkingCapability,
} from './thread-run-contract'
import type {
  CopilotRunDiagnosticSummary,
  CopilotRunState,
} from './types'
import type {
  CopilotAssistantSegment,
  CopilotRunSegment,
  CopilotTerminalSegment,
  CopilotToolSegment,
} from './run-segment-types'

export function projectConversationTurnsFromRunState(input: {
  userTurns: CopilotConversationTurn[]
  runState: CopilotRunState
}): CopilotConversationTurn[] {
  const projectedRunTurns = input.runState.segments.flatMap((segment) => projectSegmentToTurn(segment, input.runState))
  const terminalSegment = findTerminalSegment(input.runState.segments)
  const turnsWithTerminal = terminalSegment === null
    ? projectedRunTurns
    : applyTerminalSegment(projectedRunTurns, terminalSegment, input.runState)
  const turnsWithDiagnostic = applyDiagnosticToTurns(turnsWithTerminal, input.runState.diagnostic)

  return [...input.userTurns, ...turnsWithDiagnostic]
}

function projectSegmentToTurn(
  segment: CopilotRunSegment,
  runState: Pick<CopilotRunState, 'requestedThinkingLevel' | 'appliedThinkingLevel' | 'thinkingCapabilitySnapshot'>,
): CopilotConversationTurn[] {
  switch (segment.kind) {
    case 'assistant':
      return segment.text === '' ? [] : [projectAssistantSegment(segment, runState)]
    case 'reasoning':
      return []
    case 'tool':
      return [projectToolSegment(segment)]
    case 'diagnostic':
    case 'terminal':
      return []
  }
}

function projectAssistantSegment(
  segment: CopilotAssistantSegment,
  runState: Pick<CopilotRunState, 'requestedThinkingLevel' | 'appliedThinkingLevel' | 'thinkingCapabilitySnapshot'>,
): CopilotConversationTurn {
  return {
    id: segment.id,
    runId: segment.runId,
    kind: 'assistant',
    title: '助手响应',
    content: segment.text,
    status: mapAssistantSegmentStatus(segment.status),
    resolvedModelId: segment.resolvedModelId ?? undefined,
    resolvedModelRoute: segment.resolvedModelRoute ?? undefined,
    resolvedToolIds: [...segment.resolvedToolIds],
    requestOptions: { ...segment.requestOptions },
    requestedThinkingLevel: runState.requestedThinkingLevel,
    appliedThinkingLevel: runState.appliedThinkingLevel,
    thinkingCapabilitySnapshot: cloneRuntimeThinkingCapability(runState.thinkingCapabilitySnapshot),
  }
}

function projectToolSegment(segment: CopilotToolSegment): CopilotConversationTurn {
  return {
    id: segment.id,
    runId: segment.runId,
    kind: 'tool',
    title: segment.title,
    content: segment.summary,
    status: mapToolSegmentStatus(segment.status),
    toolCallId: segment.toolCallId,
    toolId: segment.toolId,
    toolPhase: segment.toolPhase,
    inputSummary: segment.inputSummary,
    resultSummary: segment.resultSummary,
    errorSummary: segment.errorSummary,
  }
}

function applyTerminalSegment(
  turns: CopilotConversationTurn[],
  terminal: CopilotTerminalSegment,
  runState: Pick<CopilotRunState, 'requestedThinkingLevel' | 'appliedThinkingLevel' | 'thinkingCapabilitySnapshot'>,
): CopilotConversationTurn[] {
  switch (terminal.terminalPhase) {
    case 'completed':
      return turns
    case 'cancelled': {
      const assistantTurnIndex = findLastTurnIndex(turns, (turn) => turn.kind === 'assistant')
      if (assistantTurnIndex < 0) {
        return turns
      }

      return turns.map((turn, index) => (index === assistantTurnIndex
        ? {
            ...turn,
            title: '已取消',
            status: 'cancelled',
            content: turn.content === ''
              ? formatCancelledReason(terminal.cancelReason ?? '')
              : turn.content,
            requestedThinkingLevel: runState.requestedThinkingLevel,
            appliedThinkingLevel: runState.appliedThinkingLevel,
            thinkingCapabilitySnapshot: cloneRuntimeThinkingCapability(runState.thinkingCapabilitySnapshot),
          }
        : turn))
    }
    case 'failed': {
      const failureMessage = formatFailureMessage(terminal)
      const assistantTurnIndex = findLastTurnIndex(turns, (turn) => turn.kind === 'assistant')
      if (assistantTurnIndex < 0) {
        return [...turns, createErrorTurn({
          runId: terminal.runId,
          content: failureMessage,
          requestedThinkingLevel: runState.requestedThinkingLevel,
          appliedThinkingLevel: runState.appliedThinkingLevel,
          thinkingCapabilitySnapshot: runState.thinkingCapabilitySnapshot,
        })]
      }

      return turns.map((turn, index) => (index === assistantTurnIndex
        ? {
            ...turn,
            kind: 'error',
            title: '发送失败',
            content: failureMessage,
            status: 'failed',
            requestedThinkingLevel: runState.requestedThinkingLevel,
            appliedThinkingLevel: runState.appliedThinkingLevel,
            thinkingCapabilitySnapshot: cloneRuntimeThinkingCapability(runState.thinkingCapabilitySnapshot),
          }
        : turn))
    }
  }
}

function applyDiagnosticToTurns(
  turns: CopilotConversationTurn[],
  diagnostic: CopilotRunDiagnosticSummary | null,
): CopilotConversationTurn[] {
  if (diagnostic === null) {
    return turns
  }

  const targetTurnIndex = findLastTurnIndex(
    turns,
    (turn) => turn.kind === 'assistant' || turn.kind === 'error' || turn.kind === 'tool',
  )
  if (targetTurnIndex < 0) {
    return turns
  }

  return turns.map((turn, index) => (index === targetTurnIndex
    ? {
        ...turn,
        diagnostic: {
          code: diagnostic.code,
          message: diagnostic.message,
          stage: diagnostic.stage,
          details: { ...diagnostic.details },
        },
      }
    : turn))
}

function findTerminalSegment(segments: CopilotRunSegment[]): CopilotTerminalSegment | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (segment?.kind === 'terminal') {
      return segment
    }
  }

  return null
}

function findLastTurnIndex(
  turns: CopilotConversationTurn[],
  predicate: (turn: CopilotConversationTurn) => boolean,
): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn !== undefined && predicate(turn)) {
      return index
    }
  }

  return -1
}

function createErrorTurn(input: {
  runId: string
  content: string
  requestedThinkingLevel: CopilotRunState['requestedThinkingLevel']
  appliedThinkingLevel: CopilotRunState['appliedThinkingLevel']
  thinkingCapabilitySnapshot: CopilotRunState['thinkingCapabilitySnapshot']
}): CopilotConversationTurn {
  return {
    id: `error:${input.runId}`,
    runId: input.runId,
    kind: 'error',
    title: '发送失败',
    content: input.content,
    status: 'failed',
    requestedThinkingLevel: input.requestedThinkingLevel,
    appliedThinkingLevel: input.appliedThinkingLevel,
    thinkingCapabilitySnapshot: cloneRuntimeThinkingCapability(input.thinkingCapabilitySnapshot),
  }
}

function cloneRuntimeThinkingCapability(
  capability: RuntimeThinkingCapability | null | undefined,
): RuntimeThinkingCapability | null | undefined {
  return cloneRuntimeThinkingCapabilityValue(capability)
}

function mapAssistantSegmentStatus(
  status: CopilotAssistantSegment['status'],
): NonNullable<CopilotConversationTurn['status']> {
  switch (status) {
    case 'pending':
      return 'streaming'
    case 'streaming':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return status
  }
}

function mapToolSegmentStatus(
  status: CopilotToolSegment['status'],
): NonNullable<CopilotConversationTurn['status']> {
  switch (status) {
    case 'pending':
      return 'streaming'
    case 'streaming':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return status
  }
}

function formatFailureMessage(terminal: CopilotTerminalSegment): string {
  if (terminal.failure === null) {
    return '当前响应失败，请重试。'
  }

  switch (terminal.failure.code) {
    case 'tool_execution_failed':
      return '工具执行失败，请重试。'
    default:
      return '当前响应失败，请重试。'
  }
}

function formatCancelledReason(reason: string): string {
  const trimmedReason = reason.trim()
  return trimmedReason === '' ? '本次响应已取消。' : `本次响应已取消：${trimmedReason}`
}
