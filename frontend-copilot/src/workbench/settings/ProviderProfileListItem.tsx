import { Fragment, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'

import type { ProviderProfile } from '../types'

import {
  resolveProviderStatusNotice,
  resolveProviderTypeLabel,
} from './settings-workspace-provider-helpers'

interface ProviderProfileListItemProps {
  profile: ProviderProfile
  active: boolean
  visualIndex: number
  showDropGapBefore: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, providerId: string) => void
  onClick: (event: ReactMouseEvent<HTMLButtonElement>, providerId: string) => void
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, providerId: string) => void
}

export function ProviderProfileListItem({
  profile,
  active,
  visualIndex,
  showDropGapBefore,
  onPointerDown,
  onClick,
  onContextMenu,
}: ProviderProfileListItemProps) {
  const providerTypeLabel = resolveProviderTypeLabel(profile)
  const providerStatusNotice = resolveProviderStatusNotice(profile)
  const providerLocation = (profile.baseUrl?.trim() || profile.endpoint.trim()) || '未设置服务地址'

  return (
    <Fragment>
      {showDropGapBefore ? <li className="topic-list__drop-gap" aria-hidden="true" /> : null}
      <li
        className="provider-list__item"
        data-provider-order-index={visualIndex}
        data-testid={`settings-provider-list-item-${profile.id}`}
      >
        <button
          type="button"
          className={`provider-card${active ? ' provider-card--active' : ''}`}
          data-testid={`settings-provider-card-${profile.id}`}
          onPointerDown={(event) => onPointerDown(event, profile.id)}
          onClick={(event) => onClick(event, profile.id)}
          onContextMenu={(event) => onContextMenu(event, profile.id)}
        >
          <span className="provider-card__title-row">
            <span className="provider-card__title">{profile.name}</span>
            {providerStatusNotice ? (
              <span
                className={`provider-card__status provider-card__status--${providerStatusNotice.tone}`}
                data-testid={`settings-provider-status-${profile.id}`}
              >
                {providerStatusNotice.title}
              </span>
            ) : null}
          </span>
          <span className="provider-card__meta-row">
            <span className="provider-card__meta">{providerTypeLabel}</span>
            <span className="provider-card__meta">{profile.hasApiKey ? '已配置密钥' : '未配置密钥'}</span>
          </span>
          <span className="provider-card__description">{providerLocation}</span>
          {providerStatusNotice ? (
            <span className="provider-card__description">{providerStatusNotice.description}</span>
          ) : null}
        </button>
      </li>
    </Fragment>
  )
}
