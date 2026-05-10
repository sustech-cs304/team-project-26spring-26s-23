import type { AssistantSessionShell } from '../types'
import type { AssistantSessionListState } from './assistant-workspace-controller'

export function createAssistantSessionListState(
  initialSessionShell: AssistantSessionShell | null,
): AssistantSessionListState {
  if (initialSessionShell === null) {
    return {
      sessions: [],
      activeSessionId: null,
    }
  }

  return {
    sessions: [initialSessionShell],
    activeSessionId: initialSessionShell.sessionId,
  }
}

export function appendAssistantSessionShell(
  state: AssistantSessionListState,
  nextSessionShell: AssistantSessionShell,
): AssistantSessionListState {
  const remainingSessions = state.sessions.filter((sessionEntry) => sessionEntry.sessionId !== nextSessionShell.sessionId)

  return {
    sessions: [nextSessionShell, ...remainingSessions],
    activeSessionId: nextSessionShell.sessionId,
  }
}

export function resolveAssistantSessionTitle(sessionEntry: AssistantSessionShell): string {
  const normalizedTitle = sessionEntry.title?.trim()

  if (normalizedTitle !== undefined && normalizedTitle.length > 0) {
    return normalizedTitle
  }

  return sessionEntry.boundAgent.label
}

export function renameAssistantSessionShell(
  state: AssistantSessionListState,
  sessionId: string,
  nextTitle: string,
): AssistantSessionListState {
  const normalizedTitle = nextTitle.trim()

  if (normalizedTitle.length === 0) {
    return state
  }

  let hasChanged = false
  const nextSessions = state.sessions.map((sessionEntry) => {
    if (sessionEntry.sessionId !== sessionId) {
      return sessionEntry
    }

    if (resolveAssistantSessionTitle(sessionEntry) === normalizedTitle && sessionEntry.title === normalizedTitle) {
      return sessionEntry
    }

    hasChanged = true
    return {
      ...sessionEntry,
      title: normalizedTitle,
    }
  })

  if (!hasChanged) {
    return state
  }

  return {
    ...state,
    sessions: nextSessions,
  }
}

export function removeAssistantSessionShell(
  state: AssistantSessionListState,
  sessionId: string,
): AssistantSessionListState {
  if (!state.sessions.some((sessionEntry) => sessionEntry.sessionId === sessionId)) {
    return state
  }

  const nextSessions = state.sessions.filter((sessionEntry) => sessionEntry.sessionId !== sessionId)

  return {
    sessions: nextSessions,
    activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
  }
}

export function moveAssistantSessionShellToIndex(
  state: AssistantSessionListState,
  draggingSessionId: string,
  nextIndex: number,
): AssistantSessionListState {
  const draggingIndex = state.sessions.findIndex((sessionEntry) => sessionEntry.sessionId === draggingSessionId)

  if (draggingIndex === -1) {
    return state
  }

  const nextSessions = [...state.sessions]
  const [draggingSession] = nextSessions.splice(draggingIndex, 1)

  if (draggingSession === undefined) {
    return state
  }

  const normalizedIndex = Math.max(0, Math.min(nextIndex, nextSessions.length))
  nextSessions.splice(normalizedIndex, 0, draggingSession)

  return {
    ...state,
    sessions: nextSessions,
  }
}

export function reorderAssistantSessionShells(
  state: AssistantSessionListState,
  draggingSessionId: string,
  targetSessionId: string,
): AssistantSessionListState {
  if (draggingSessionId === targetSessionId) {
    return state
  }

  const draggingIndex = state.sessions.findIndex((sessionEntry) => sessionEntry.sessionId === draggingSessionId)
  const targetIndex = state.sessions.findIndex((sessionEntry) => sessionEntry.sessionId === targetSessionId)

  if (draggingIndex === -1 || targetIndex === -1) {
    return state
  }

  const nextIndex = draggingIndex < targetIndex ? targetIndex - 1 : targetIndex
  return moveAssistantSessionShellToIndex(state, draggingSessionId, nextIndex)
}

export function resolveActiveAssistantSessionShell(
  state: AssistantSessionListState,
): AssistantSessionShell | null {
  if (state.activeSessionId === null) {
    return null
  }

  return state.sessions.find((sessionEntry) => sessionEntry.sessionId === state.activeSessionId) ?? null
}

export function filterDraggedSessionFromRender(
  sessions: AssistantSessionShell[],
  draggingSessionId: string | null,
): AssistantSessionShell[] {
  if (draggingSessionId === null) {
    return sessions
  }

  return sessions.filter((sessionEntry) => sessionEntry.sessionId !== draggingSessionId)
}

export function clampAssistantSessionPreviewIndex(
  previewIndex: number,
  renderedSessionsLength: number,
): number {
  return Math.max(0, Math.min(previewIndex, renderedSessionsLength))
}

export function computeAssistantSessionPreviewIndex(listElement: HTMLUListElement, clientY: number): number {
  const orderedItems = Array.from(
    listElement.querySelectorAll<HTMLElement>('[data-session-order-index]'),
  )
  let nextPreviewIndex = orderedItems.length

  for (const orderedItem of orderedItems) {
    const itemIndex = Number(orderedItem.dataset.sessionOrderIndex)
    if (Number.isNaN(itemIndex)) {
      continue
    }

    const { top, height } = orderedItem.getBoundingClientRect()
    if (clientY < top + (height / 2)) {
      nextPreviewIndex = itemIndex
      break
    }
  }

  return nextPreviewIndex
}
