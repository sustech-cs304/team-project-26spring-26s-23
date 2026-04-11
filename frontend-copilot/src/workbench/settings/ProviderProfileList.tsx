import { Plus } from 'lucide-react'
import { useMemo } from 'react'

import type { ProviderProfile } from '../types'
import { ProviderProfileContextMenu } from './ProviderProfileContextMenu'
import { ProviderProfileDragOverlay } from './ProviderProfileDragOverlay'
import { ProviderProfileListItem } from './ProviderProfileListItem'
import { filterProviderProfiles } from './provider-profile-list-helpers'
import { useProviderProfileContextMenu } from './useProviderProfileContextMenu'
import { useProviderProfileListDrag } from './useProviderProfileListDrag'

interface ProviderProfileListProps {
  providerProfiles: ProviderProfile[]
  activeProviderId: string
  providerQuery: string
  onProviderQueryChange: (value: string) => void
  onActiveProviderChange: (providerId: string) => void
  onAddProvider: () => void
  onCopyProvider: (providerId: string) => void | Promise<void>
  onDeleteProvider: (providerId: string) => void | Promise<void>
  onReorderProviders: (providerId: string, nextIndex: number) => void
}

export function ProviderProfileList({
  providerProfiles,
  activeProviderId,
  providerQuery,
  onProviderQueryChange,
  onActiveProviderChange,
  onAddProvider,
  onCopyProvider,
  onDeleteProvider,
  onReorderProviders,
}: ProviderProfileListProps) {
  const activeProvider = useMemo(
    () => providerProfiles.find((profile) => profile.id === activeProviderId) ?? providerProfiles[0] ?? null,
    [activeProviderId, providerProfiles],
  )
  const filteredProviderProfiles = useMemo(
    () => filterProviderProfiles(providerProfiles, providerQuery),
    [providerProfiles, providerQuery],
  )
  const providerListDrag = useProviderProfileListDrag({
    providerProfiles,
    filteredProviderProfiles,
    onReorderProviders,
  })
  const { providerContextMenu, closeProviderContextMenu, openProviderContextMenu } = useProviderProfileContextMenu({
    providerProfiles,
    onEscape: () => {
      providerListDrag.resetProviderDragInteraction()
    },
    onBlur: () => {
      providerListDrag.resetProviderDragInteraction()
    },
  })

  return (
    <section className="settings-card">
      <div className="settings-card__header settings-card__header--spaced">
        <div>
          <h3 className="settings-card__title">模型服务</h3>
          <p className="settings-card__subtitle">在这里管理可用的模型服务。</p>
        </div>
      </div>

      <div className="settings-stack settings-stack--compact">
        <div className="settings-provider-add-row">
          <button type="button" className="secondary-button" onClick={onAddProvider}>
            <Plus size={14} />
            <span>添加</span>
          </button>
        </div>
      </div>

      <div className="search-box search-box--input">
        <input
          type="text"
          className="search-box__input"
          value={providerQuery}
          placeholder="搜索服务、地址或模型..."
          onChange={(event) => onProviderQueryChange(event.target.value)}
        />
      </div>

      <ul
        ref={providerListDrag.providerListRef}
        className="provider-list provider-list--interactive"
        data-testid="settings-provider-list"
      >
        {providerListDrag.renderedProviderProfiles.map((profile, visualIndex) => {
          const active = profile.id === activeProvider?.id

          return (
            <ProviderProfileListItem
              key={profile.id}
              profile={profile}
              active={active}
              visualIndex={visualIndex}
              showDropGapBefore={providerListDrag.providerDragPreviewIndex === visualIndex}
              onPointerDown={(event, providerId) => {
                closeProviderContextMenu()
                providerListDrag.handleProviderPointerDown(event, providerId)
              }}
              onClick={(event, providerId) => {
                if (providerListDrag.consumeSuppressedProviderClick()) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }

                closeProviderContextMenu()
                onActiveProviderChange(providerId)
              }}
              onContextMenu={(event, providerId) => {
                event.preventDefault()
                onActiveProviderChange(providerId)
                openProviderContextMenu(providerId, event.clientX, event.clientY)
              }}
            />
          )
        })}
        {providerListDrag.providerDragPreviewIndex === providerListDrag.renderedProviderProfiles.length ? (
          <li className="topic-list__drop-gap" aria-hidden="true" />
        ) : null}
      </ul>

      <ProviderProfileDragOverlay
        provider={providerListDrag.draggingProvider}
        dragGhostRef={providerListDrag.providerDragGhostRef}
      />

      {providerContextMenu !== null ? (
        <ProviderProfileContextMenu
          contextMenu={providerContextMenu}
          onDismissContextMenu={closeProviderContextMenu}
          onCopyProvider={onCopyProvider}
          onDeleteProvider={onDeleteProvider}
        />
      ) : null}
    </section>
  )
}
