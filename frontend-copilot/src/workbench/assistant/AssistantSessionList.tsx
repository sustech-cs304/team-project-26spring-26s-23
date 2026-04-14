import type {
  MutableRefObject,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'

import { getAssistantSessionCopy, type WorkbenchLanguage } from '../locale'
import type { AgentType, AssistantSessionShell } from '../types'
import type { AssistantSessionListState } from './assistant-workspace-controller'
import { AssistantSessionContextMenu } from './AssistantSessionContextMenu'
import { AssistantSessionDragOverlay } from './AssistantSessionDragOverlay'
import { AssistantSessionListItem } from './AssistantSessionListItem'
import {
  getAssistantSessionDropGapTestId,
  resolveAssistantSessionActiveState,
  type AssistantSessionContextMenuState,
  type AssistantSessionContextSubmenu,
  type AssistantSessionDragState,
} from './assistant-session-list-helpers'

interface AssistantSessionListProps {
  language?: WorkbenchLanguage
  selectedAgent: AgentType | null
  sessionListState: AssistantSessionListState
  sessionStatus: 'idle' | 'creating' | 'error'
  createSessionLabel: string
  createSessionButtonDisabled: boolean
  renderedSessions: AssistantSessionShell[]
  dragPreviewIndex: number | null
  draggingSessionShell: AssistantSessionShell | null
  sessionContextMenu: AssistantSessionContextMenuState | null
  renamingSessionId: string | null
  renamingValue: string
  deleteConfirmationSessionId: string | null
  sessionDragState: AssistantSessionDragState | null
  sessionError: string | null
  sessionListRef: MutableRefObject<HTMLUListElement | null>
  sessionDragGhostRef: MutableRefObject<HTMLDivElement | null>
  onCreateSession: () => void
  onSessionPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, sessionId: string) => void
  onSessionClick: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  onSessionContextMenu: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  onDismissContextMenu: () => void
  onRequestRename: (sessionId: string) => void
  onRenameValueChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onRequestDelete: (sessionId: string) => void
  onConfirmDelete: (sessionId: string) => void
  onCancelDelete: () => void
  onSelectSubmenu: (submenu: AssistantSessionContextSubmenu | null) => void
}

export function AssistantSessionList({
  language = 'zh-CN',
  selectedAgent,
  sessionListState,
  sessionStatus,
  createSessionLabel,
  createSessionButtonDisabled,
  renderedSessions,
  dragPreviewIndex,
  draggingSessionShell,
  sessionContextMenu,
  renamingSessionId,
  renamingValue,
  deleteConfirmationSessionId,
  sessionDragState,
  sessionError,
  sessionListRef,
  sessionDragGhostRef,
  onCreateSession,
  onSessionPointerDown,
  onSessionClick,
  onSessionContextMenu,
  onDismissContextMenu,
  onRequestRename,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onSelectSubmenu,
}: AssistantSessionListProps) {
  const copy = getAssistantSessionCopy(language)

  return (
    <aside className="workspace-panel topic-panel" aria-label={copy.sessionListAriaLabel}>
      <header className="panel-head">
        <p className="panel-head__eyebrow">{copy.sessionEyebrow}</p>
        <h2 className="panel-head__title">
          {selectedAgent?.label ?? copy.waitingForAgent}
        </h2>
      </header>

      <button
        type="button"
        className="new-thread-button"
        data-testid="assistant-create-session-button"
        onClick={onCreateSession}
        disabled={createSessionButtonDisabled}
        aria-busy={sessionStatus === 'creating'}
        aria-label={createSessionLabel}
      >
        <span>＋</span>
        <span>{createSessionLabel}</span>
      </button>

      {sessionListState.sessions.length > 0 && (
        <ul
          ref={(node) => {
            sessionListRef.current = node
          }}
          className="topic-list topic-list--detailed"
          data-testid="assistant-session-list"
        >
          {renderedSessions.map((sessionEntry, visualIndex) => (
            <AssistantSessionListItem
              key={sessionEntry.sessionId}
              language={language}
              sessionEntry={sessionEntry}
              active={resolveAssistantSessionActiveState(sessionEntry, sessionListState.activeSessionId)}
              visualIndex={visualIndex}
              showDropGapBefore={dragPreviewIndex === visualIndex}
              editing={renamingSessionId === sessionEntry.sessionId}
              editingValue={renamingSessionId === sessionEntry.sessionId ? renamingValue : ''}
              onSessionPointerDown={onSessionPointerDown}
              onSessionClick={onSessionClick}
              onSessionContextMenu={onSessionContextMenu}
              onRenameValueChange={onRenameValueChange}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
            />
          ))}
          {dragPreviewIndex === renderedSessions.length && (
            <li
              className="topic-list__drop-gap"
              data-testid={getAssistantSessionDropGapTestId(renderedSessions.length)}
              aria-hidden="true"
            />
          )}
        </ul>
      )}

      <AssistantSessionDragOverlay
        sessionDragState={sessionDragState}
        draggingSessionShell={draggingSessionShell}
        sessionDragGhostRef={sessionDragGhostRef}
      />

      <AssistantSessionContextMenu
        language={language}
        sessionContextMenu={sessionContextMenu}
        deleteConfirmationSessionId={deleteConfirmationSessionId}
        onDismissContextMenu={onDismissContextMenu}
        onRequestRename={onRequestRename}
        onRequestDelete={onRequestDelete}
        onConfirmDelete={onConfirmDelete}
        onCancelDelete={onCancelDelete}
        onSelectSubmenu={onSelectSubmenu}
      />

      {sessionError !== null && (
        <p className="panel-head__description" role="alert">{sessionError}</p>
      )}
    </aside>
  )
}
