import type { Ref } from 'react'

import type { AssistantSessionShell } from '../types'
import type { AssistantSessionDragState } from './assistant-session-list-helpers'

interface AssistantSessionDragOverlayProps {
  sessionDragState: AssistantSessionDragState | null
  draggingSessionShell: AssistantSessionShell | null
  sessionDragGhostRef: Ref<HTMLDivElement>
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
      ref={sessionDragGhostRef}
      className="topic-card topic-card--drag-ghost"
      data-testid="assistant-session-drag-ghost"
      aria-hidden="true"
    >
      <span className="topic-card__title">{draggingSessionShell.boundAgent.label}</span>
      <span className="topic-card__meta" />
    </div>
  )
}
