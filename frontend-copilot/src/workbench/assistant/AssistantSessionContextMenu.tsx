import {
  assistantSessionPrimaryActions,
  type AssistantSessionContextMenuState,
} from './assistant-session-list-helpers'

interface AssistantSessionContextMenuProps {
  sessionContextMenu: AssistantSessionContextMenuState | null
  deleteConfirmationSessionId: string | null
  onRequestRename: (sessionId: string) => void
  onDuplicateSession: (sessionId: string) => void
  onRequestDelete: (sessionId: string) => void
  onConfirmDelete: (sessionId: string) => void
  onCancelDelete: () => void
}

export function AssistantSessionContextMenu({
  sessionContextMenu,
  deleteConfirmationSessionId,
  onRequestRename,
  onDuplicateSession,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: AssistantSessionContextMenuProps) {
  if (sessionContextMenu === null) {
    return null
  }

  const deleteConfirmationActive = deleteConfirmationSessionId === sessionContextMenu.sessionId
  const renameAction = assistantSessionPrimaryActions[0]
  const deleteAction = assistantSessionPrimaryActions[1]
  const duplicateAction = assistantSessionPrimaryActions[2]

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
      </div>
    </div>
  )
}
