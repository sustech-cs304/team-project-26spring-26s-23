import type {
  ThinkingLevelIntent,
} from '../../workbench/types'
import type { CopilotRunDiagnosticSummary } from './types'
import type {
  RuntimeModelRoute,
  RuntimeResolvedModelRoute,
  RuntimeRunCompletedEvent,
  RuntimeThinkingCapability,
  RuntimeToolEvent,
  RuntimeToolEventPhase,
} from './thread-run-contract'

export type CopilotToolStepPhase = RuntimeToolEventPhase | 'cancelled'

export interface CopilotTransientErrorState {
  message: string
  errorDetail: CopilotErrorDetailSource | null
}

import type { CopilotErrorDetailSource } from './error-detail-overlay-view-model'

export interface CopilotConversationTurn {
  id: string
  runId?: string
  kind: 'user' | 'assistant' | 'error' | 'tool' | 'diagnostic' | 'terminal'
  title: string
  content: string
  status?: 'streaming' | 'completed' | 'failed' | 'cancelled'
  resolvedModelId?: string
  resolvedModelRoute?: RuntimeResolvedModelRoute | RuntimeModelRoute
  resolvedToolIds?: string[]
  requestOptions?: Record<string, unknown>
  requestedThinkingLevel?: ThinkingLevelIntent | null
  appliedThinkingLevel?: ThinkingLevelIntent | null
  thinkingCapabilitySnapshot?: RuntimeThinkingCapability | null
  diagnostic?: CopilotRunDiagnosticSummary | null
  toolCallId?: string
  toolId?: string
  toolPhase?: CopilotToolStepPhase
  inputSummary?: string | null
  resultSummary?: string | null
  errorSummary?: string | null
}

export function createUserTurn(content: string): CopilotConversationTurn {
  return {
    id: `user:${content}:${Math.random().toString(36).slice(2)}`,
    kind: 'user',
    title: '',
    content,
    status: 'completed',
  }
}

export function createPendingAssistantTurn(input: {
  assistantMessageId: string
  diagnostic?: CopilotRunDiagnosticSummary | null
}): CopilotConversationTurn {
  return {
    id: input.assistantMessageId,
    kind: 'assistant',
    title: '助手响应',
    content: '',
    status: 'streaming',
    diagnostic: input.diagnostic ?? null,
  }
}

export function appendAssistantDelta(
  turns: CopilotConversationTurn[],
  input: {
    assistantMessageId: string
    delta: string
  },
): CopilotConversationTurn[] {
  return turns.map((turn) => {
    if (turn.id !== input.assistantMessageId) {
      return turn
    }

    return {
      ...turn,
      content: `${turn.content}${input.delta}`,
      status: 'streaming',
    }
  })
}

export function completeAssistantTurn(
  turns: CopilotConversationTurn[],
  event: RuntimeRunCompletedEvent,
  diagnostic: CopilotRunDiagnosticSummary | null,
): CopilotConversationTurn[] {
  const nextTurns: CopilotConversationTurn[] = turns.map((turn): CopilotConversationTurn => {
    if (turn.id !== event.payload.assistantMessageId) {
      return turn
    }

    return {
      ...turn,
      content: event.payload.assistantText,
      status: 'completed',
      resolvedModelId: event.payload.resolvedModelId,
      resolvedModelRoute: cloneRuntimeResolvedModelRoute(event.payload.resolvedModelRoute),
      resolvedToolIds: [...event.payload.resolvedToolIds],
      requestOptions: { ...event.payload.requestOptions },
      diagnostic,
    }
  })

  return ensureAssistantTurnExists(nextTurns, {
    id: event.payload.assistantMessageId,
    kind: 'assistant',
    title: '助手响应',
    content: event.payload.assistantText,
    status: 'completed',
    resolvedModelId: event.payload.resolvedModelId,
    resolvedModelRoute: cloneRuntimeResolvedModelRoute(event.payload.resolvedModelRoute),
    resolvedToolIds: [...event.payload.resolvedToolIds],
    requestOptions: { ...event.payload.requestOptions },
    diagnostic,
  })
}

export function upsertToolStepTurn(
  turns: CopilotConversationTurn[],
  event: RuntimeToolEvent,
  input: {
    assistantMessageId: string | null
  },
): CopilotConversationTurn[] {
  const nextTurn = buildToolStepTurn(event)
  const existingTurnIndex = turns.findIndex((turn) => turn.toolCallId === event.payload.toolCallId)
  if (existingTurnIndex >= 0) {
    return turns.map((turn, index) => (index === existingTurnIndex ? {
      ...turn,
      ...nextTurn,
    } : turn))
  }

  const insertIndex = resolveToolTurnInsertIndex(turns, input.assistantMessageId)
  return [
    ...turns.slice(0, insertIndex),
    nextTurn,
    ...turns.slice(insertIndex),
  ]
}

export function cancelStreamingToolTurns(turns: CopilotConversationTurn[]): CopilotConversationTurn[] {
  return turns.map((turn) => {
    if (turn.kind !== 'tool' || turn.status !== 'streaming') {
      return turn
    }

    return {
      ...turn,
      status: 'cancelled',
      toolPhase: 'cancelled',
    }
  })
}

export function failAssistantTurn(
  turns: CopilotConversationTurn[],
  input: {
    assistantMessageId: string | null
    content: string
    diagnostic: CopilotRunDiagnosticSummary | null
  },
): CopilotConversationTurn[] {
  if (input.assistantMessageId === null) {
    return [...turns, createErrorTurn(input.content, input.diagnostic)]
  }

  const nextTurns: CopilotConversationTurn[] = turns.map((turn): CopilotConversationTurn => {
    if (turn.id !== input.assistantMessageId) {
      return turn
    }

    return {
      ...turn,
      kind: 'error',
      title: '发送失败',
      content: input.content,
      status: 'failed',
      diagnostic: input.diagnostic,
    }
  })

  return ensureAssistantTurnExists(nextTurns, {
    id: input.assistantMessageId,
    kind: 'error',
    title: '发送失败',
    content: input.content,
    status: 'failed',
    diagnostic: input.diagnostic,
  })
}

export function cancelAssistantTurn(
  turns: CopilotConversationTurn[],
  input: {
    assistantMessageId: string | null
    reason: string
    diagnostic: CopilotRunDiagnosticSummary | null
  },
): CopilotConversationTurn[] {
  if (input.assistantMessageId === null) {
    return turns
  }

  return turns.map((turn) => {
    if (turn.id !== input.assistantMessageId) {
      return turn
    }

    return {
      ...turn,
      status: 'cancelled',
      title: '已取消',
      content: turn.content === '' ? formatCancelledReason(input.reason) : turn.content,
      diagnostic: input.diagnostic,
    }
  })
}

export function createErrorTurn(
  content: string,
  diagnostic: CopilotRunDiagnosticSummary | null = null,
): CopilotConversationTurn {
  return {
    id: `error:${content}:${Math.random().toString(36).slice(2)}`,
    kind: 'error',
    title: '发送失败',
    content,
    status: 'failed',
    diagnostic,
  }
}

// ── Internal helpers ──

function ensureAssistantTurnExists(
  turns: CopilotConversationTurn[],
  turn: CopilotConversationTurn,
): CopilotConversationTurn[] {
  return turns.some((currentTurn) => currentTurn.id === turn.id)
    ? turns
    : [...turns, turn]
}

function buildToolStepTurn(event: RuntimeToolEvent): CopilotConversationTurn {
  return {
    id: `tool:${event.payload.toolCallId}`,
    kind: 'tool',
    title: event.payload.title,
    content: event.payload.summary,
    status: mapToolPhaseToTurnStatus(event.payload.phase),
    toolCallId: event.payload.toolCallId,
    toolId: event.payload.toolId,
    toolPhase: event.payload.phase,
    inputSummary: event.payload.inputSummary ?? null,
    resultSummary: event.payload.resultSummary ?? null,
    errorSummary: event.payload.errorSummary ?? null,
  }
}

function mapToolPhaseToTurnStatus(
  phase: RuntimeToolEventPhase,
): NonNullable<CopilotConversationTurn['status']> {
  switch (phase) {
    case 'started':
    case 'waiting_approval':
      return 'streaming'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
  }
}

function resolveToolTurnInsertIndex(
  turns: CopilotConversationTurn[],
  assistantMessageId: string | null,
): number {
  if (assistantMessageId === null) {
    return turns.length
  }

  const assistantTurnIndex = turns.findIndex((turn) => turn.id === assistantMessageId)
  if (assistantTurnIndex < 0) {
    return turns.length
  }

  const assistantTurn = turns[assistantTurnIndex]
  if (assistantTurn.kind === 'assistant' && assistantTurn.status === 'streaming' && assistantTurn.content === '') {
    return assistantTurnIndex
  }

  return turns.length
}

function cloneRuntimeResolvedModelRoute(route: RuntimeResolvedModelRoute): RuntimeResolvedModelRoute {
  return {
    ...route,
    routeRef: {
      ...route.routeRef,
    },
  }
}

function formatCancelledReason(reason: string): string {
  const trimmedReason = reason.trim()
  return trimmedReason === '' ? '本次响应已取消。' : `本次响应已取消：${trimmedReason}`
}
