import { getProviderContextMenuCopy } from '../locale'
import type { ProviderContextMenuState } from './provider-profiles'

interface ProviderProfileContextMenuProps {
  contextMenu: ProviderContextMenuState
  language: string
  onDismissContextMenu: () => void
  onCopyProvider: (providerId: string) => void | Promise<void>
  onDeleteProvider: (providerId: string) => void | Promise<void>
}

interface ProviderProfileContextMenuAction {
  key: string
  label: string
  className: string
  onSelect: (providerId: string, handlers: Omit<ProviderProfileContextMenuProps, 'contextMenu' | 'language'>) => void
}

export function ProviderProfileContextMenu({
  contextMenu,
  language,
  onDismissContextMenu,
  onCopyProvider,
  onDeleteProvider,
}: ProviderProfileContextMenuProps) {
  const copy = getProviderContextMenuCopy(language)
  const providerProfileContextMenuActions = [
    {
      key: 'copy',
      label: copy.copyProvider,
      className: 'session-context-menu__item',
      onSelect: (providerId: string, handlers: Omit<ProviderProfileContextMenuProps, 'contextMenu' | 'language'>) => {
        handlers.onDismissContextMenu()
        void handlers.onCopyProvider(providerId)
      },
    },
    {
      key: 'delete',
      label: copy.deleteProvider,
      className: 'session-context-menu__item session-context-menu__item--danger',
      onSelect: (providerId: string, handlers: Omit<ProviderProfileContextMenuProps, 'contextMenu' | 'language'>) => {
        handlers.onDismissContextMenu()
        void handlers.onDeleteProvider(providerId)
      },
    },
  ] satisfies ProviderProfileContextMenuAction[]
  const actionHandlers = { onDismissContextMenu, onCopyProvider, onDeleteProvider }

  return (
    <div
      className="session-context-menu provider-context-menu"
      data-testid="provider-context-menu"
      role="menu"
      aria-label={copy.menuAriaLabel(contextMenu.providerName)}
      style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
    >
      <p className="session-context-menu__title">{contextMenu.providerName}</p>
      <div className="session-context-menu__group">
        {providerProfileContextMenuActions.map((action) => {
          return (
            <button
              key={action.key}
              type="button"
              className={action.className}
              role="menuitem"
              onClick={() => {
                action.onSelect(contextMenu.providerId, actionHandlers)
              }}
            >
              {action.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
