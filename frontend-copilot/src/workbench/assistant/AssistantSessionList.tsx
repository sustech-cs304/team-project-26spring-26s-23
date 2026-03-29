import {
  Fragment,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react'

import type { AgentType, AssistantSessionShell } from '../types'
import type { AssistantSessionListState } from './assistant-workspace-controller'

export interface AssistantSessionContextMenuState {
  sessionId: string
  sessionLabel: string
  x: number
  y: number
  activeSubmenu: 'copy' | 'export' | null
}

export interface AssistantSessionDragState {
  draggingSessionId: string
  previewIndex: number
}

interface AssistantSessionListProps {
  selectedAgent: AgentType | null
  sessionListState: AssistantSessionListState
  sessionStatus: 'idle' | 'creating' | 'error'
  createSessionLabel: string
  createSessionButtonDisabled: boolean
  renderedSessions: AssistantSessionShell[]
  dragPreviewIndex: number | null
  draggingSessionShell: AssistantSessionShell | null
  sessionContextMenu: AssistantSessionContextMenuState | null
  sessionDragState: AssistantSessionDragState | null
  sessionError: string | null
  sessionListRef: Ref<HTMLUListElement>
  sessionDragGhostRef: Ref<HTMLDivElement>
  onCreateSession: () => void
  onSessionPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, sessionId: string) => void
  onSessionClick: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  onSessionContextMenu: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  onDismissContextMenu: () => void
  onSelectSubmenu: (submenu: 'copy' | 'export' | null) => void
}

export function AssistantSessionList({
  selectedAgent,
  sessionListState,
  sessionStatus,
  createSessionLabel,
  createSessionButtonDisabled,
  renderedSessions,
  dragPreviewIndex,
  draggingSessionShell,
  sessionContextMenu,
  sessionDragState,
  sessionError,
  sessionListRef,
  sessionDragGhostRef,
  onCreateSession,
  onSessionPointerDown,
  onSessionClick,
  onSessionContextMenu,
  onDismissContextMenu,
  onSelectSubmenu,
}: AssistantSessionListProps) {
  return (
    <aside className="workspace-panel topic-panel" aria-label="会话创建列">
      <header className="panel-head">
        <p className="panel-head__eyebrow">会话</p>
        <h2 className="panel-head__title">
          {selectedAgent?.label ?? '等待选择智能体'}
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
          ref={sessionListRef}
          className="topic-list topic-list--detailed"
          data-testid="assistant-session-list"
        >
          {renderedSessions.map((sessionEntry, visualIndex) => {
            const active = sessionEntry.sessionId === sessionListState.activeSessionId

            return (
              <Fragment key={sessionEntry.sessionId}>
                {dragPreviewIndex === visualIndex && (
                  <li
                    className="topic-list__drop-gap"
                    data-testid={`assistant-session-drop-gap-${visualIndex}`}
                    aria-hidden="true"
                  />
                )}
                <li
                  className="topic-list__item"
                  data-testid={`assistant-session-list-item-${sessionEntry.sessionId}`}
                  data-session-order-index={visualIndex}
                >
                  <button
                    type="button"
                    className={`topic-card${active ? ' topic-card--active' : ''}`}
                    data-testid={`assistant-session-card-${sessionEntry.sessionId}`}
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
          })}
          {dragPreviewIndex === renderedSessions.length && (
            <li
              className="topic-list__drop-gap"
              data-testid={`assistant-session-drop-gap-${renderedSessions.length}`}
              aria-hidden="true"
            />
          )}
        </ul>
      )}

      {sessionDragState !== null && draggingSessionShell !== null && (
        <div
          ref={sessionDragGhostRef}
          className="topic-card topic-card--drag-ghost"
          data-testid="assistant-session-drag-ghost"
          aria-hidden="true"
        >
          <span className="topic-card__title">{draggingSessionShell.boundAgent.label}</span>
          <span className="topic-card__meta" />
        </div>
      )}

      {sessionContextMenu !== null && (
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
              data-testid="assistant-session-context-action-rename"
              role="menuitem"
              onClick={onDismissContextMenu}
            >
              重命名会话
            </button>
            <button
              type="button"
              className="session-context-menu__item"
              data-testid="assistant-session-context-action-delete"
              role="menuitem"
              onClick={onDismissContextMenu}
            >
              删除会话
            </button>
            <button
              type="button"
              className="session-context-menu__item"
              data-testid="assistant-session-context-action-generate-title"
              role="menuitem"
              onClick={onDismissContextMenu}
            >
              生成会话名
            </button>

            <AssistantSessionSubmenu
              active={sessionContextMenu.activeSubmenu === 'copy'}
              panelTestId="assistant-session-context-submenu-panel-copy"
              triggerTestId="assistant-session-context-submenu-copy"
              label="复制会话"
              ariaLabel="复制会话子菜单"
              onActiveChange={(active) => onSelectSubmenu(active ? 'copy' : null)}
            >
              <button
                type="button"
                className="session-context-menu__item"
                data-testid="assistant-session-context-action-copy-session"
                role="menuitem"
                onClick={onDismissContextMenu}
              >
                复制为新会话
              </button>
              <button
                type="button"
                className="session-context-menu__item"
                data-testid="assistant-session-context-action-copy-markdown"
                role="menuitem"
                onClick={onDismissContextMenu}
              >
                复制为 Markdown
              </button>
              <button
                type="button"
                className="session-context-menu__item"
                data-testid="assistant-session-context-action-copy-text"
                role="menuitem"
                onClick={onDismissContextMenu}
              >
                复制为纯文本
              </button>
            </AssistantSessionSubmenu>

            <AssistantSessionSubmenu
              active={sessionContextMenu.activeSubmenu === 'export'}
              panelTestId="assistant-session-context-submenu-panel-export"
              triggerTestId="assistant-session-context-submenu-export"
              label="导出会话"
              ariaLabel="导出会话子菜单"
              onActiveChange={(active) => onSelectSubmenu(active ? 'export' : null)}
            >
              <button
                type="button"
                className="session-context-menu__item"
                data-testid="assistant-session-context-action-export-markdown"
                role="menuitem"
                onClick={onDismissContextMenu}
              >
                导出到 Markdown
              </button>
              <button
                type="button"
                className="session-context-menu__item"
                data-testid="assistant-session-context-action-export-json"
                role="menuitem"
                onClick={onDismissContextMenu}
              >
                导出到 JSON
              </button>
              <button
                type="button"
                className="session-context-menu__item"
                data-testid="assistant-session-context-action-export-text"
                role="menuitem"
                onClick={onDismissContextMenu}
              >
                导出为纯文本
              </button>
            </AssistantSessionSubmenu>
          </div>
        </div>
      )}

      {sessionError !== null && (
        <p className="panel-head__description" role="alert">{sessionError}</p>
      )}
    </aside>
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
