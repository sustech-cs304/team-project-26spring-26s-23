import type { ProviderContextMenuState } from './provider-profiles'

interface ProviderProfileContextMenuProps {
  contextMenu: ProviderContextMenuState
  onCopyProvider: (providerId: string) => void | Promise<void>
  onDeleteProvider: (providerId: string) => void | Promise<void>
}

interface ProviderProfileContextMenuAction {
  key: string
  label: string
  className: string
  onSelect: (providerId: string, handlers: Omit<ProviderProfileContextMenuProps, 'contextMenu'>) => void
}

const providerProfileContextMenuActions = [
  {
    key: 'copy',
    label: '复制服务商',
    className: 'session-context-menu__item',
    onSelect: (providerId: string, handlers: Omit<ProviderProfileContextMenuProps, 'contextMenu'>) => {
      void handlers.onCopyProvider(providerId)
    },
  },
  {
    key: 'delete',
    label: '删除服务商',
    className: 'session-context-menu__item session-context-menu__item--danger',
    onSelect: (providerId: string, handlers: Omit<ProviderProfileContextMenuProps, 'contextMenu'>) => {
      void handlers.onDeleteProvider(providerId)
    },
  },
] satisfies ProviderProfileContextMenuAction[]

export function ProviderProfileContextMenu({
  contextMenu,
  onCopyProvider,
  onDeleteProvider,
}: ProviderProfileContextMenuProps) {
  const actionHandlers = { onCopyProvider, onDeleteProvider }

  return (
    <div
      className="session-context-menu provider-context-menu"
      data-testid="provider-context-menu"
      role="menu"
      aria-label={`${contextMenu.providerName} 服务商菜单`}
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
