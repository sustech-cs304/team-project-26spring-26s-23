import type { ReactNode } from 'react'

import {
  assistantSessionCopyActions,
  assistantSessionExportActions,
  assistantSessionPrimaryActions,
  type AssistantSessionContextMenuState,
  type AssistantSessionContextSubmenu,
} from './assistant-session-list-helpers'

interface AssistantSessionContextMenuProps {
  sessionContextMenu: AssistantSessionContextMenuState | null
  deleteConfirmationSessionId: string | null
  onDismissContextMenu: () => void
  onRequestRename: (sessionId: string) => void
  onDuplicateSession: (sessionId: string) => void
  onRequestDelete: (sessionId: string) => void
  onConfirmDelete: (sessionId: string) => void
  onCancelDelete: () => void
  onSelectSubmenu: (submenu: AssistantSessionContextSubmenu | null) => void
}

export function AssistantSessionContextMenu({
  sessionContextMenu,
  deleteConfirmationSessionId,
  onDismissContextMenu,
  onRequestRename,
  onDuplicateSession,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onSelectSubmenu,
}: AssistantSessionContextMenuProps) {
  if (sessionContextMenu === null) {
    return null
  }

  const deleteConfirmationActive = deleteConfirmationSessionId === sessionContextMenu.sessionId

  return (
    <div
      className="session-context-menu"
      data-testid="assistant-session-context-menu"
      role="menu"
      aria-label={`${sessionContextMenu.sessionLabel} 会话菜单`}
      style={{ left: `${sessionContextMenu.x}px`, top: `${sessionContextMenu.y}px` }}
    >
      <p className="session-context-menu__title">{sessionContextMenu.sessionLabel}</p>

      <div className="session-context-menu__group">
        <button
          type="button"
          className="session-context-menu__item"
          data-testid={assistantSessionPrimaryActions[0]?.testId}
          role="menuitem"
          onClick={() => onRequestRename(sessionContextMenu.sessionId)}
        >
          {assistantSessionPrimaryActions[0]?.label}
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
                  确认删除会话
                </button>
                <button
                  type="button"
                  className="session-context-menu__item"
                  data-testid="assistant-session-context-action-delete-cancel"
                  role="menuitem"
                  onClick={onCancelDelete}
                >
                  取消删除
                </button>
              </>
            )
          : (
              <button
                type="button"
                className="session-context-menu__item"
                data-testid={assistantSessionPrimaryActions[1]?.testId}
                role="menuitem"
                onClick={() => onRequestDelete(sessionContextMenu.sessionId)}
              >
                {assistantSessionPrimaryActions[1]?.label}
              </button>
            )}

        <button
          type="button"
          className="session-context-menu__item"
          data-testid={assistantSessionPrimaryActions[2]?.testId}
          role="menuitem"
          onClick={onDismissContextMenu}
        >
          {assistantSessionPrimaryActions[2]?.label}
        </button>

        <AssistantSessionSubmenu
          active={sessionContextMenu.activeSubmenu === 'copy'}
          panelTestId="assistant-session-context-submenu-panel-copy"
          triggerTestId="assistant-session-context-submenu-copy"
          label="复制会话"
          ariaLabel="复制会话子菜单"
          onActiveChange={(active) => onSelectSubmenu(active ? 'copy' : null)}
        >
          {assistantSessionCopyActions.map((action) => (
            <button
              key={action.testId}
              type="button"
              className="session-context-menu__item"
              data-testid={action.testId}
              role="menuitem"
              onClick={() => {
                if (action.testId === assistantSessionCopyActions[0]?.testId) {
                  onDuplicateSession(sessionContextMenu.sessionId)
                  return
                }
                onDismissContextMenu()
              }}
            >
              {action.label}
            </button>
          ))}
        </AssistantSessionSubmenu>

        <AssistantSessionSubmenu
          active={sessionContextMenu.activeSubmenu === 'export'}
          panelTestId="assistant-session-context-submenu-panel-export"
          triggerTestId="assistant-session-context-submenu-export"
          label="导出会话"
          ariaLabel="导出会话子菜单"
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

interface AssistantSessionSubmenuProps {
  active: boolean
  triggerTestId: string
  panelTestId: string
  label: string
  ariaLabel: string
  onActiveChange: (active: boolean) => void
  children: ReactNode
}

function AssistantSessionSubmenu({
  active,
  triggerTestId,
  panelTestId,
  label,
  ariaLabel,
  onActiveChange,
  children,
}: AssistantSessionSubmenuProps) {
  return (
    <div
      className="session-context-menu__submenu"
      onMouseEnter={() => onActiveChange(true)}
      onMouseLeave={() => onActiveChange(false)}
    >
      <button
        type="button"
        className="session-context-menu__item session-context-menu__item--submenu"
        data-testid={triggerTestId}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={active}
      >
        <span>{label}</span>
        <span className="session-context-menu__submenu-caret" aria-hidden="true">›</span>
      </button>

      {active && (
        <div
          className="session-context-submenu"
          data-testid={panelTestId}
          role="menu"
          aria-label={ariaLabel}
        >
          {children}
        </div>
      )}
    </div>
  )
}
