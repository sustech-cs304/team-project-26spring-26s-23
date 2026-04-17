import type { ReactNode } from 'react'

import { getAssistantSessionCopy, type WorkbenchLanguage } from '../locale'
import {
  getAssistantSessionCopyActions,
  getAssistantSessionExportActions,
  getAssistantSessionPrimaryActions,
  type AssistantSessionContextMenuState,
} from './assistant-session-list-helpers'

interface AssistantSessionContextMenuProps {
  language?: WorkbenchLanguage
  sessionContextMenu: AssistantSessionContextMenuState | null
  deleteConfirmationSessionId: string | null
  onRequestRename: (sessionId: string) => void
  onDuplicateSession: (sessionId: string) => void
  onRequestDelete: (sessionId: string) => void
  onConfirmDelete: (sessionId: string) => void
  onCancelDelete: () => void
  onDismissContextMenu: () => void
  onSelectSubmenu: (submenu: 'copy' | 'export' | null) => void
}

interface AssistantSessionSubmenuProps {
  active: boolean
  panelTestId: string
  triggerTestId: string
  label: string
  ariaLabel: string
  children: ReactNode
  onActiveChange: (active: boolean) => void
}

export function AssistantSessionContextMenu({
  language = 'zh-CN',
  sessionContextMenu,
  deleteConfirmationSessionId,
  onRequestRename,
  onDuplicateSession,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onDismissContextMenu,
  onSelectSubmenu,
}: AssistantSessionContextMenuProps) {
  if (sessionContextMenu === null) {
    return null
  }

  const copy = getAssistantSessionCopy(language)
  const assistantSessionPrimaryActions = getAssistantSessionPrimaryActions(language)
  const assistantSessionCopyActions = getAssistantSessionCopyActions(language)
  const assistantSessionExportActions = getAssistantSessionExportActions(language)
  const deleteConfirmationActive = deleteConfirmationSessionId === sessionContextMenu.sessionId
  const renameAction = assistantSessionPrimaryActions[0]
  const deleteAction = assistantSessionPrimaryActions[1]
  const duplicateAction = assistantSessionPrimaryActions[2]

  return (
    <div
      className="session-context-menu"
      data-testid="assistant-session-context-menu"
      role="menu"
      aria-label={copy.contextMenu.menuAriaLabel(sessionContextMenu.sessionLabel)}
      style={{ left: `${sessionContextMenu.x}px`, top: `${sessionContextMenu.y}px` }}
    >
      <p className="session-context-menu__title">{sessionContextMenu.sessionLabel}</p>

      <div className="session-context-menu__group">
        <button
          type="button"
          className="session-context-menu__item"
          data-testid={renameAction?.testId}
          role="menuitem"
          onClick={() => onRequestRename(sessionContextMenu.sessionId)}
        >
          {renameAction?.label}
        </button>

        {deleteConfirmationActive
          ? (
              <>
                <button
                  type="button"
                  className="session-context-menu__item session-context-menu__item--danger"
                  data-testid="assistant-session-context-action-delete-confirm"
                  role="menuitem"
                  onClick={() => onConfirmDelete(sessionContextMenu.sessionId)}
                >
                  {copy.contextMenu.confirmDeleteSession}
                </button>
                <button
                  type="button"
                  className="session-context-menu__item"
                  data-testid="assistant-session-context-action-delete-cancel"
                  role="menuitem"
                  onClick={onCancelDelete}
                >
                  {copy.contextMenu.cancelDelete}
                </button>
              </>
            )
          : (
              <button
                type="button"
                className="session-context-menu__item"
                data-testid={deleteAction?.testId}
                role="menuitem"
                onClick={() => onRequestDelete(sessionContextMenu.sessionId)}
              >
                {deleteAction?.label}
              </button>
            )}

        <button
          type="button"
          className="session-context-menu__item"
          data-testid={duplicateAction?.testId}
          role="menuitem"
          onClick={() => onDuplicateSession(sessionContextMenu.sessionId)}
        >
          {duplicateAction?.label}
        </button>
        <AssistantSessionSubmenu
          active={sessionContextMenu.activeSubmenu === 'copy'}
          panelTestId="assistant-session-context-submenu-panel-copy"
          triggerTestId="assistant-session-context-submenu-copy"
          label={copy.contextMenu.copySession}
          ariaLabel={copy.contextMenu.copySession}
          onActiveChange={(active) => onSelectSubmenu(active ? 'copy' : null)}
        >
          {assistantSessionCopyActions.map((action) => (
            <button
              key={action.testId}
              type="button"
              className="session-context-menu__item"
              data-testid={action.testId}
              role="menuitem"
              onClick={onDismissContextMenu}
            >
              {action.label}
            </button>
          ))}
        </AssistantSessionSubmenu>

        <AssistantSessionSubmenu
          active={sessionContextMenu.activeSubmenu === 'export'}
          panelTestId="assistant-session-context-submenu-panel-export"
          triggerTestId="assistant-session-context-submenu-export"
          label={copy.contextMenu.exportSession}
          ariaLabel={copy.contextMenu.exportSession}
          onActiveChange={(active) => onSelectSubmenu(active ? 'export' : null)}
        >
          {assistantSessionExportActions.map((action) => (
            <button
              key={action.testId}
              type="button"
              className="session-context-menu__item"
              data-testid={action.testId}
              role="menuitem"
              onClick={onDismissContextMenu}
            >
              {action.label}
            </button>
          ))}
        </AssistantSessionSubmenu>
      </div>
    </div>
  )
}

function AssistantSessionSubmenu({
  active,
  panelTestId,
  triggerTestId,
  label,
  ariaLabel,
  children,
  onActiveChange,
}: AssistantSessionSubmenuProps) {
  return (
    <div className="session-context-submenu">
      <button
        type="button"
        className="session-context-menu__item"
        data-testid={triggerTestId}
        aria-haspopup="menu"
        aria-expanded={active ? 'true' : 'false'}
        aria-label={ariaLabel}
        onClick={() => onActiveChange(!active)}
      >
        {label}
      </button>
      {active && (
        <div className="session-context-menu__group" data-testid={panelTestId}>
          {children}
        </div>
      )}
    </div>
  )
}
