import {
  Fragment,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import type { AssistantSessionShell } from '../types'
import {
  getAssistantSessionCardTestId,
  getAssistantSessionDropGapTestId,
  getAssistantSessionListItemTestId,
} from './assistant-session-list-helpers'

interface AssistantSessionListItemProps {
  sessionEntry: AssistantSessionShell
  active: boolean
  visualIndex: number
  showDropGapBefore: boolean
  onSessionPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, sessionId: string) => void
  onSessionClick: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  onSessionContextMenu: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
}

export function AssistantSessionListItem({
  sessionEntry,
  active,
  visualIndex,
  showDropGapBefore,
  onSessionPointerDown,
  onSessionClick,
  onSessionContextMenu,
}: AssistantSessionListItemProps) {
  return (
    <Fragment>
      {showDropGapBefore && (
        <li
          className="topic-list__drop-gap"
          data-testid={getAssistantSessionDropGapTestId(visualIndex)}
          aria-hidden="true"
        />
      )}
      <li
        className="topic-list__item"
        data-testid={getAssistantSessionListItemTestId(sessionEntry.sessionId)}
        data-session-order-index={visualIndex}
      >
        <button
          type="button"
          className={`topic-card${active ? ' topic-card--active' : ''}`}
          data-testid={getAssistantSessionCardTestId(sessionEntry.sessionId)}
          onPointerDown={(event) => onSessionPointerDown(event, sessionEntry.sessionId)}
          onClick={(event) => onSessionClick(sessionEntry, event)}
          onContextMenu={(event) => onSessionContextMenu(sessionEntry, event)}
        >
          <span className="topic-card__title">{sessionEntry.boundAgent.label}</span>
          <span className="topic-card__meta" />
        </button>
      </li>
    </Fragment>
  )
}
