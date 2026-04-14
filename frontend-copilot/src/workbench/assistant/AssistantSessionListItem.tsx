import {
  useEffect,
  useRef,
  Fragment,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import { getAssistantSessionCopy, type WorkbenchLanguage } from '../locale'
import type { AssistantSessionShell } from '../types'
import {
  getAssistantSessionCardTestId,
  getAssistantSessionDropGapTestId,
  getAssistantSessionListItemTestId,
  getAssistantSessionRenameInputTestId,
} from './assistant-session-list-helpers'
import { resolveAssistantSessionTitle } from './assistant-session-helpers'

interface AssistantSessionListItemProps {
  language?: WorkbenchLanguage
  sessionEntry: AssistantSessionShell
  active: boolean
  visualIndex: number
  showDropGapBefore: boolean
  editing: boolean
  editingValue: string
  onSessionPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, sessionId: string) => void
  onSessionClick: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  onSessionContextMenu: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  onRenameValueChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
}

export function AssistantSessionListItem({
  language = 'zh-CN',
  sessionEntry,
  active,
  visualIndex,
  showDropGapBefore,
  editing,
  editingValue,
  onSessionPointerDown,
  onSessionClick,
  onSessionContextMenu,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
}: AssistantSessionListItemProps) {
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const copy = getAssistantSessionCopy(language)

  useEffect(() => {
    if (!editing || renameInputRef.current === null) {
      return
    }

    renameInputRef.current.focus()
    renameInputRef.current.select()
  }, [editing])

  const handleRenameInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    onRenameValueChange(event.currentTarget.value)
  }

  const handleRenameInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onCommitRename()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      onCancelRename()
    }
  }

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
        {editing
          ? (
              <div
                className={`topic-card${active ? ' topic-card--active' : ''}`}
                data-testid={getAssistantSessionCardTestId(sessionEntry.sessionId)}
              >
                <input
                  ref={renameInputRef}
                  type="text"
                  className="topic-card__title-input"
                  data-testid={getAssistantSessionRenameInputTestId(sessionEntry.sessionId)}
                  aria-label={copy.renameSessionAriaLabel(resolveAssistantSessionTitle(sessionEntry))}
                  value={editingValue}
                  onChange={handleRenameInputChange}
                  onKeyDown={handleRenameInputKeyDown}
                  onBlur={onCommitRename}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                />
                <span className="topic-card__meta" />
              </div>
            )
          : (
              <button
                type="button"
                className={`topic-card${active ? ' topic-card--active' : ''}`}
                data-testid={getAssistantSessionCardTestId(sessionEntry.sessionId)}
                onPointerDown={(event) => onSessionPointerDown(event, sessionEntry.sessionId)}
                onClick={(event) => onSessionClick(sessionEntry, event)}
                onContextMenu={(event) => onSessionContextMenu(sessionEntry, event)}
              >
                <span className="topic-card__title">{resolveAssistantSessionTitle(sessionEntry)}</span>
                <span className="topic-card__meta" />
              </button>
            )}
      </li>
    </Fragment>
  )
}
