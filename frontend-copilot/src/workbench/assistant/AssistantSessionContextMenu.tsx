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
  onDismissContextMenu: () => void
  onSelectSubmenu: (submenu: AssistantSessionContextSubmenu | null) => void
}

export function AssistantSessionContextMenu({
  sessionContextMenu,
  onDismissContextMenu,
  onSelectSubmenu,
}: AssistantSessionContextMenuProps) {
  if (sessionContextMenu === null) {
    return null
  }

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
        {assistantSessionPrimaryActions.map((action) => (
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
        onFocus={() => onActiveChange(true)}
        onClick={() => onActiveChange(!active)}
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
