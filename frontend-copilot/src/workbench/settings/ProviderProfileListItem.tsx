import { Fragment, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'

import type { ProviderProfile } from '../types'

import { getProviderProtocolLabel } from './provider-profile-list-helpers'

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
          </span>
          <span className="provider-card__meta-row">
            <span className="provider-card__meta">{getProviderProtocolLabel(profile.protocol)}</span>
            <span className="provider-card__meta">{profile.hasApiKey ? '已配置密钥' : '未配置密钥'}</span>
          </span>
          <span className="provider-card__description">{profile.endpoint}</span>
        </button>
      </li>
    </Fragment>
  )
}
