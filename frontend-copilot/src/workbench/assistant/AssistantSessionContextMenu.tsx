
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
  onSelectSubmenu: (sessionId: string, submenu: 'copy' | 'export' | null) => void
}

function clampMenuTop(top: number): number {
  const margin = 12
  const estimatedMenuHeight = 320
  const viewportHeight = window.innerHeight
  return Math.max(margin, Math.min(top, viewportHeight - estimatedMenuHeight - margin))
}

/* eslint-disable-next-line max-lines-per-function -- 右键菜单是一个紧凑的内聚组件，拆分会造成碎片化。 */
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
      style={{ left: `${sessionContextMenu.x}px`, top: `${clampMenuTop(sessionContextMenu.y)}px` }}
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
          onOpen={() => onSelectSubmenu(sessionContextMenu.sessionId, 'copy')}
          onClose={() => onSelectSubmenu(sessionContextMenu.sessionId, null)}
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
          onOpen={() => onSelectSubmenu(sessionContextMenu.sessionId, 'export')}
          onClose={() => onSelectSubmenu(sessionContextMenu.sessionId, null)}
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

interface AssistantSessionSubmenuProps {
  active: boolean
  panelTestId: string
  triggerTestId: string
  label: string
  ariaLabel: string
  children: ReactNode
  onOpen: () => void
  onClose: () => void
}

function AssistantSessionSubmenu({
  active,
  panelTestId,
  triggerTestId,
  label,
  ariaLabel,
  children,
  onOpen,
  onClose,
}: AssistantSessionSubmenuProps) {
  return (
    <div
      className="session-context-menu__submenu"
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
    >
      <button
        type="button"
        className="session-context-menu__item session-context-menu__item--submenu"
        data-testid={triggerTestId}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={active ? 'true' : 'false'}
        aria-label={ariaLabel}
        onMouseEnter={onOpen}
        onFocus={onOpen}
      >
        <span>{label}</span>
        <span className="session-context-menu__submenu-caret" aria-hidden="true">›</span>
      </button>
      {active && (
        <div className="session-context-submenu" data-testid={panelTestId}>
          {children}
        </div>
      )}
    </div>
  )
}
