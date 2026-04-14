import type { MutableRefObject } from 'react'

import type { ProviderProfile } from '../types'

import {
  resolveProviderStatusNotice,
  resolveProviderTypeLabel,
} from './settings-workspace-provider-helpers'

interface ProviderProfileDragOverlayProps {
  provider: ProviderProfile | null
  dragGhostRef: MutableRefObject<HTMLDivElement | null>
  language?: string
}

export function ProviderProfileDragOverlay({
  provider,
  dragGhostRef,
  language = 'zh-CN',
}: ProviderProfileDragOverlayProps) {
  if (provider === null) {
    return null
  }

  const providerStatusNotice = resolveProviderStatusNotice(provider, language)

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
        <span className="provider-card__meta">{resolveProviderTypeLabel(provider, language)}</span>
        {providerStatusNotice ? <span className="provider-card__meta">{providerStatusNotice.title}</span> : null}
      </span>
    </div>
  )
}
