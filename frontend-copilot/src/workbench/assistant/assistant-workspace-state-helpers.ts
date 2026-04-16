import type { AssistantSessionShell } from '../types'
import type {
  AssistantSessionContextMenuState,
  AssistantSessionDragState,
} from './assistant-session-list-helpers'
import {
  clampAssistantSessionPreviewIndex,
  filterDraggedSessionFromRender,
  resolveAssistantSessionTitle,
} from './assistant-session-helpers'

export interface AssistantRenderedSessionState {
  renderedSessions: AssistantSessionShell[]
  dragPreviewIndex: number | null
  draggingSessionShell: AssistantSessionShell | null
}

export function createAssistantSessionContextMenuState(input: {
  sessionEntry: AssistantSessionShell
  x: number
  y: number
}): AssistantSessionContextMenuState {
  return {
    sessionId: input.sessionEntry.sessionId,
    sessionLabel: resolveAssistantSessionTitle(input.sessionEntry),
    x: input.x,
    y: input.y,
  }
}

export function createAssistantRenderedSessionState(input: {
  sessions: AssistantSessionShell[]
  sessionDragState: AssistantSessionDragState | null
}): AssistantRenderedSessionState {
  const draggingSessionId = input.sessionDragState?.draggingSessionId ?? null
  const renderedSessions = filterDraggedSessionFromRender(input.sessions, draggingSessionId)

  return {
    renderedSessions,
    dragPreviewIndex: input.sessionDragState === null
      ? null
      : clampAssistantSessionPreviewIndex(input.sessionDragState.previewIndex, renderedSessions.length),
    draggingSessionShell: draggingSessionId === null
      ? null
      : input.sessions.find((sessionEntry) => sessionEntry.sessionId === draggingSessionId) ?? null,
  }
}
