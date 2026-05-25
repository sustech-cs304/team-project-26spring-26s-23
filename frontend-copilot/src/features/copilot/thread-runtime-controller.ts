import type { AssistantSessionCapabilities, AssistantSessionShell } from '../../workbench/types'
import { createEmptyComposerAttachmentsState } from './attachments/state'
import type { CopilotComposerAttachmentsState } from './attachments/types'
import {
  createComposerDraftFromSession,
  type CopilotChatComposerDraft,
  type CopilotTransientErrorState,
} from './copilot-chat-helpers'
import { createIdleCopilotRunState } from './copilot-send-controller'
import type { CopilotMessageListItem } from './run-segment-view-model'
import type { RuntimeThinkingCapability } from './thread-run-contract'
import type { CopilotRunState } from './types'

export interface CopilotThreadRuntimeControllerState {
  sessionId: string
  composerDraft: CopilotChatComposerDraft
  composerAttachments: CopilotComposerAttachmentsState
  conversation: CopilotMessageListItem[]
  runState: CopilotRunState
  sendError: CopilotTransientErrorState | null
  thinkingCapability: RuntimeThinkingCapability | null
  historyRebindAcknowledged: boolean
  activeAbortController: AbortController | null
  pendingHistorySyncRunId: string | null
  lastSettledRunId: string | null
  pendingHistorySyncLogKey: string | null
  lastAccessedAt: number
}

export function createCopilotThreadRuntimeControllerState(
  sessionShell?: (Pick<AssistantSessionShell, 'sessionId'> & Partial<Pick<AssistantSessionShell, 'capabilities'>>) | null,
  createdAt = Date.now(),
): CopilotThreadRuntimeControllerState {
  return {
    sessionId: sessionShell?.sessionId ?? '',
    composerDraft: createComposerDraftFromSession(sessionShell),
    composerAttachments: createEmptyComposerAttachmentsState(),
    conversation: [],
    runState: createIdleCopilotRunState(),
    sendError: null,
    thinkingCapability: null,
    historyRebindAcknowledged: false,
    activeAbortController: null,
    pendingHistorySyncRunId: null,
    lastSettledRunId: null,
    pendingHistorySyncLogKey: null,
    lastAccessedAt: createdAt,
  }
}

export function touchCopilotThreadRuntimeControllerState(
  state: CopilotThreadRuntimeControllerState,
  touchedAt = Date.now(),
): CopilotThreadRuntimeControllerState {
  return state.lastAccessedAt === touchedAt
    ? state
    : {
        ...state,
        lastAccessedAt: touchedAt,
      }
}

export function isCopilotThreadRuntimeControllerHandoffPending(
  state: CopilotThreadRuntimeControllerState,
): boolean {
  return state.pendingHistorySyncRunId !== null
}

export function hasCopilotThreadRuntimeControllerActiveRun(
  state: CopilotThreadRuntimeControllerState,
): boolean {
  return state.runState.phase === 'starting'
    || state.runState.phase === 'streaming'
    || state.activeAbortController !== null
}

export function isCopilotThreadRuntimeControllerLruCandidate(
  state: CopilotThreadRuntimeControllerState,
): boolean {
  return !hasCopilotThreadRuntimeControllerActiveRun(state)
    && !isCopilotThreadRuntimeControllerHandoffPending(state)
    && (
      state.runState.phase === 'idle'
      || state.runState.phase === 'awaiting_input'
      || state.runState.phase === 'completed'
      || state.runState.phase === 'failed'
      || state.runState.phase === 'cancelled'
    )
}

export function resolveCopilotThreadRuntimeControllerState(
  stateBySessionId: Record<string, CopilotThreadRuntimeControllerState>,
  sessionId: string | null | undefined,
): CopilotThreadRuntimeControllerState {
  const normalizedSessionId = sessionId?.trim() ?? ''
  if (normalizedSessionId === '') {
    return createCopilotThreadRuntimeControllerState()
  }

  return stateBySessionId[normalizedSessionId] ?? createCopilotThreadRuntimeControllerState({
    sessionId: normalizedSessionId,
  })
}

export function updateCopilotThreadRuntimeControllerStateRecord(
  stateBySessionId: Record<string, CopilotThreadRuntimeControllerState>,
  sessionId: string,
  updater: (state: CopilotThreadRuntimeControllerState) => CopilotThreadRuntimeControllerState,
  options: {
    touch?: boolean
    touchedAt?: number
    capabilities?: AssistantSessionCapabilities
  } = {},
): Record<string, CopilotThreadRuntimeControllerState> {
  const normalizedSessionId = sessionId.trim()
  if (normalizedSessionId === '') {
    return stateBySessionId
  }

  const existingState = stateBySessionId[normalizedSessionId]
  const currentState = existingState ?? createCopilotThreadRuntimeControllerState({
    sessionId: normalizedSessionId,
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
  }, options.touchedAt)
  let nextState = updater(currentState)
  if (options.touch !== false) {
    nextState = touchCopilotThreadRuntimeControllerState(nextState, options.touchedAt)
  }
  if (existingState !== undefined && nextState === currentState) {
    return stateBySessionId
  }

  return {
    ...stateBySessionId,
    [normalizedSessionId]: nextState,
  }
}

export function syncCopilotThreadRuntimeControllerStateRecord(
  stateBySessionId: Record<string, CopilotThreadRuntimeControllerState>,
  sessionShells: AssistantSessionShell[],
  options: {
    createdAt?: number
  } = {},
): Record<string, CopilotThreadRuntimeControllerState> {
  let hasChanged = false
  const nextState = { ...stateBySessionId }
  const sessionIds = new Set(sessionShells.map((sessionShell) => sessionShell.sessionId))
  const createdAt = options.createdAt ?? Date.now()

  for (const sessionShell of sessionShells) {
    if (nextState[sessionShell.sessionId] !== undefined) {
      continue
    }

    nextState[sessionShell.sessionId] = createCopilotThreadRuntimeControllerState(sessionShell, createdAt)
    hasChanged = true
  }

  for (const sessionId of Object.keys(nextState)) {
    if (sessionIds.has(sessionId)) {
      continue
    }

    delete nextState[sessionId]
    hasChanged = true
  }

  return hasChanged ? nextState : stateBySessionId
}
