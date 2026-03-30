import type { MutableRefObject } from 'react'

import type { ProviderProfile } from '../types'

import { getProviderProtocolLabel } from './provider-profile-list-helpers'

interface ProviderProfileDragOverlayProps {
  provider: ProviderProfile | null
  dragGhostRef: MutableRefObject<HTMLDivElement | null>
}

export function ProviderProfileDragOverlay({ provider, dragGhostRef }: ProviderProfileDragOverlayProps) {
  if (provider === null) {
    return null
  }

  return (
    <div
      ref={dragGhostRef}
      className="provider-card provider-card--drag-ghost"
      data-testid="settings-provider-drag-ghost"
      aria-hidden="true"
    >
      <span className="provider-card__title-row">
        <span className="provider-card__title">{provider.name}</span>
      </span>
      <span className="provider-card__meta-row">
        <span className="provider-card__meta">{getProviderProtocolLabel(provider.protocol)}</span>
      </span>
    </div>
  )
}
