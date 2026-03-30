import type { MutableRefObject } from 'react'

import type { AssistantSessionShell } from '../types'
import type { AssistantSessionDragState } from './assistant-session-list-helpers'
import { resolveAssistantSessionTitle } from './assistant-session-helpers'

interface AssistantSessionDragOverlayProps {
  sessionDragState: AssistantSessionDragState | null
  draggingSessionShell: AssistantSessionShell | null
  sessionDragGhostRef: MutableRefObject<HTMLDivElement | null>
}

export function AssistantSessionDragOverlay({
  sessionDragState,
  draggingSessionShell,
  sessionDragGhostRef,
}: AssistantSessionDragOverlayProps) {
  if (sessionDragState === null || draggingSessionShell === null) {
    return null
  }

  return (
    <div
      ref={(node) => {
        sessionDragGhostRef.current = node
      }}
      className="topic-card topic-card--drag-ghost"
      data-testid="assistant-session-drag-ghost"
      aria-hidden="true"
    >
      <span className="topic-card__title">{resolveAssistantSessionTitle(draggingSessionShell)}</span>
      <span className="topic-card__meta" />
    </div>
  )
}
