import { Plus } from 'lucide-react'
import { useMemo } from 'react'

import { getProviderListCopy } from '../locale'
import type { ProviderProfile } from '../types'
import { ProviderProfileContextMenu } from './ProviderProfileContextMenu'
import { ProviderProfileDragOverlay } from './ProviderProfileDragOverlay'
import { ProviderProfileListItem } from './ProviderProfileListItem'
import { filterProviderProfiles } from './provider-profile-list-helpers'
import { useProviderProfileContextMenu } from './useProviderProfileContextMenu'
import { useProviderProfileListDrag } from './useProviderProfileListDrag'

interface ProviderProfileListProps {
  language?: string
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
  language = 'zh-CN',
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
    () => filterProviderProfiles(providerProfiles, providerQuery, language),
    [providerProfiles, providerQuery, language],
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

  const copy = getProviderListCopy(language)

  return (
    <section className="settings-card">
      <div className="settings-card__header settings-card__header--spaced">
        <div>
          <h3 className="settings-card__title">{copy.title}</h3>
        </div>
      </div>

      <div className="settings-stack settings-stack--compact">
        <div className="settings-provider-add-row">
          <button type="button" className="secondary-button" onClick={onAddProvider}>
            <Plus size={14} />
            <span>{copy.addButton}</span>
          </button>
        </div>
      </div>

      <div className="search-box search-box--input">
        <input
          type="text"
          className="search-box__input"
          value={providerQuery}
          placeholder={copy.searchPlaceholder}
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
              language={language}
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
        language={language}
      />

      {providerContextMenu !== null ? (
        <ProviderProfileContextMenu
          contextMenu={providerContextMenu}
          language={language}
          onDismissContextMenu={closeProviderContextMenu}
          onCopyProvider={onCopyProvider}
          onDeleteProvider={onDeleteProvider}
        />
      ) : null}
    </section>
  )
}
