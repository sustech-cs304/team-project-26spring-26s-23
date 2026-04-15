import type { AssistantSessionShell } from '../../workbench/types'
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
  conversation: CopilotMessageListItem[]
  runState: CopilotRunState
  sendError: CopilotTransientErrorState | null
  thinkingCapability: RuntimeThinkingCapability | null
  historyRebindAcknowledged: boolean
  activeAbortController: AbortController | null
  pendingHistorySyncRunId: string | null
  lastSettledRunId: string | null
  pendingHistorySyncLogKey: string | null
}

export function createCopilotThreadRuntimeControllerState(
  sessionShell?: Pick<AssistantSessionShell, 'sessionId'> | null,
): CopilotThreadRuntimeControllerState {
  return {
    sessionId: sessionShell?.sessionId ?? '',
    composerDraft: createComposerDraftFromSession(sessionShell as AssistantSessionShell | undefined),
    conversation: [],
    runState: createIdleCopilotRunState(),
    sendError: null,
    thinkingCapability: null,
    historyRebindAcknowledged: false,
    activeAbortController: null,
    pendingHistorySyncRunId: null,
    lastSettledRunId: null,
    pendingHistorySyncLogKey: null,
  }
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
): Record<string, CopilotThreadRuntimeControllerState> {
  const normalizedSessionId = sessionId.trim()
  if (normalizedSessionId === '') {
    return stateBySessionId
  }

  const existingState = stateBySessionId[normalizedSessionId]
  const currentState = existingState ?? createCopilotThreadRuntimeControllerState({
    sessionId: normalizedSessionId,
  })
  const nextState = updater(currentState)
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
): Record<string, CopilotThreadRuntimeControllerState> {
  let hasChanged = false
  const nextState = { ...stateBySessionId }
  const sessionIds = new Set(sessionShells.map((sessionShell) => sessionShell.sessionId))

  for (const sessionShell of sessionShells) {
    if (nextState[sessionShell.sessionId] !== undefined) {
      continue
    }

    nextState[sessionShell.sessionId] = createCopilotThreadRuntimeControllerState(sessionShell)
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
