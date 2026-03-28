import { Plus } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { ProviderProfile } from '../types'
import { protocolOptions } from './config'
import {
  computeProviderPreviewIndex,
  type ProviderContextMenuState,
  type ProviderDragState,
} from './provider-profiles'

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
  const [providerContextMenu, setProviderContextMenu] = useState<ProviderContextMenuState | null>(null)
  const [providerDragState, setProviderDragState] = useState<ProviderDragState | null>(null)
  const providerListRef = useRef<HTMLUListElement | null>(null)
  const providerDragGhostRef = useRef<HTMLDivElement | null>(null)
  const providerDragStateRef = useRef<ProviderDragState | null>(null)
  const pendingProviderPointerRef = useRef<{
    providerId: string
    startX: number
    startY: number
    pointerOffsetX: number
    pointerOffsetY: number
  } | null>(null)
  const providerPointerCleanupRef = useRef<(() => void) | null>(null)
  const providerDragGhostFrameRef = useRef<number | null>(null)
  const suppressProviderClickRef = useRef(false)

  const activeProvider = useMemo(
    () => providerProfiles.find((profile) => profile.id === activeProviderId) ?? providerProfiles[0] ?? null,
    [activeProviderId, providerProfiles],
  )

  const filteredProviderProfiles = useMemo(() => {
    const keyword = providerQuery.trim().toLowerCase()

    if (!keyword) {
      return providerProfiles
    }

    return providerProfiles.filter((profile) => {
      return (
        profile.name.toLowerCase().includes(keyword)
        || profile.endpoint.toLowerCase().includes(keyword)
        || profile.defaultModel.toLowerCase().includes(keyword)
        || profile.availableModels.some((model) => {
          return (
            model.modelId.toLowerCase().includes(keyword)
            || model.displayName.toLowerCase().includes(keyword)
          )
        })
      )
    })
  }, [providerProfiles, providerQuery])

  const draggingProvider = useMemo(
    () => providerDragState === null
      ? null
      : providerProfiles.find((profile) => profile.id === providerDragState.draggingProviderId) ?? null,
    [providerDragState, providerProfiles],
  )
  const draggedProviderId = providerDragState?.draggingProviderId ?? null
  const renderedProviderProfiles = useMemo(
    () => draggedProviderId === null
      ? filteredProviderProfiles
      : filteredProviderProfiles.filter((profile) => profile.id !== draggedProviderId),
    [draggedProviderId, filteredProviderProfiles],
  )
  const providerDragPreviewIndex = providerDragState === null
    ? null
    : Math.max(0, Math.min(providerDragState.previewIndex, renderedProviderProfiles.length))

  useEffect(() => {
    providerDragStateRef.current = providerDragState
  }, [providerDragState])

  useEffect(() => {
    if (providerContextMenu === null) {
      return undefined
    }

    const handleWindowMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-testid="provider-context-menu"]') !== null) {
        return
      }

      setProviderContextMenu(null)
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProviderContextMenu(null)
        setProviderDragState(null)
        pendingProviderPointerRef.current = null
      }
    }

    const handleWindowBlur = () => {
      setProviderDragState(null)
      pendingProviderPointerRef.current = null
    }

    window.addEventListener('mousedown', handleWindowMouseDown)
    window.addEventListener('keydown', handleWindowKeyDown)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('mousedown', handleWindowMouseDown)
      window.removeEventListener('keydown', handleWindowKeyDown)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [providerContextMenu])

  useEffect(() => {
    return () => {
      providerPointerCleanupRef.current?.()
      if (providerDragGhostFrameRef.current !== null) {
        cancelAnimationFrame(providerDragGhostFrameRef.current)
      }
    }
  }, [])

  const handleOpenProviderContextMenu = (providerId: string, x: number, y: number) => {
    const provider = providerProfiles.find((profile) => profile.id === providerId)

    if (!provider) {
      return
    }

    setProviderContextMenu({
      providerId,
      providerName: provider.name,
      x,
      y,
    })
  }

  const scheduleProviderDragGhostPosition = (
    pointerX: number,
    pointerY: number,
    pointerOffsetX: number,
    pointerOffsetY: number,
  ) => {
    if (providerDragGhostFrameRef.current !== null) {
      cancelAnimationFrame(providerDragGhostFrameRef.current)
    }

    providerDragGhostFrameRef.current = requestAnimationFrame(() => {
      if (providerDragGhostRef.current !== null) {
        providerDragGhostRef.current.style.transform = `translate3d(${pointerX - pointerOffsetX}px, ${pointerY - pointerOffsetY}px, 0)`
      }
      providerDragGhostFrameRef.current = null
    })
  }

  const handleProviderPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, providerId: string) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    setProviderContextMenu(null)
    providerPointerCleanupRef.current?.()

    const previousUserSelect = document.body.style.userSelect
    const currentTargetRect = event.currentTarget.getBoundingClientRect()
    pendingProviderPointerRef.current = {
      providerId,
      startX: event.clientX,
      startY: event.clientY,
      pointerOffsetX: event.clientX - currentTargetRect.left,
      pointerOffsetY: event.clientY - currentTargetRect.top,
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      document.body.style.userSelect = previousUserSelect
      pendingProviderPointerRef.current = null
      providerPointerCleanupRef.current = null
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const pending = pendingProviderPointerRef.current
      if (pending === null) {
        return
      }

      const pointerTravel = Math.abs(moveEvent.clientX - pending.startX) + Math.abs(moveEvent.clientY - pending.startY)
      if (pointerTravel < 4 && providerDragStateRef.current === null) {
        return
      }

      suppressProviderClickRef.current = true
      document.body.style.userSelect = 'none'
      scheduleProviderDragGhostPosition(
        moveEvent.clientX,
        moveEvent.clientY,
        pending.pointerOffsetX,
        pending.pointerOffsetY,
      )

      const listElement = providerListRef.current
      const nextPreviewIndex = listElement === null
        ? 0
        : computeProviderPreviewIndex(listElement, moveEvent.clientY - pending.pointerOffsetY + (currentTargetRect.height / 2))

      setProviderDragState({
        draggingProviderId: pending.providerId,
        previewIndex: nextPreviewIndex,
      })
    }

    const handlePointerUp = () => {
      const dragSnapshot = providerDragStateRef.current
      if (dragSnapshot !== null) {
        onReorderProviders(dragSnapshot.draggingProviderId, dragSnapshot.previewIndex)
        setProviderDragState(null)
        requestAnimationFrame(() => {
          suppressProviderClickRef.current = false
        })
      }

      cleanup()
    }

    providerPointerCleanupRef.current = cleanup
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  return (
    <section className="settings-card">
      <div className="settings-card__header settings-card__header--spaced">
        <div>
          <h3 className="settings-card__title">模型服务商</h3>
        </div>
        <button type="button" className="secondary-button" onClick={onAddProvider}>
          <Plus size={14} />
          <span>添加</span>
        </button>
      </div>

      <div className="search-box search-box--input">
        <input
          type="text"
          className="search-box__input"
          value={providerQuery}
          placeholder="搜索服务商、地址或模型..."
          onChange={(event) => onProviderQueryChange(event.target.value)}
        />
      </div>

      <ul
        ref={providerListRef}
        className="provider-list provider-list--interactive"
        data-testid="settings-provider-list"
      >
        {renderedProviderProfiles.map((profile, visualIndex) => {
          const active = profile.id === activeProvider?.id

          return (
            <Fragment key={profile.id}>
              {providerDragPreviewIndex === visualIndex ? (
                <li className="topic-list__drop-gap" aria-hidden="true" />
              ) : null}
              <li
                className="provider-list__item"
                data-provider-order-index={visualIndex}
                data-testid={`settings-provider-list-item-${profile.id}`}
              >
                <button
                  type="button"
                  className={`provider-card${active ? ' provider-card--active' : ''}`}
                  data-testid={`settings-provider-card-${profile.id}`}
                  onPointerDown={(event) => handleProviderPointerDown(event, profile.id)}
                  onClick={(event) => {
                    if (suppressProviderClickRef.current) {
                      event.preventDefault()
                      event.stopPropagation()
                      suppressProviderClickRef.current = false
                      return
                    }

                    setProviderContextMenu(null)
                    onActiveProviderChange(profile.id)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    onActiveProviderChange(profile.id)
                    handleOpenProviderContextMenu(profile.id, event.clientX, event.clientY)
                  }}
                >
                  <span className="provider-card__title-row">
                    <span className="provider-card__title">{profile.name}</span>
                  </span>
                  <span className="provider-card__meta-row">
                    <span className="provider-card__meta">
                      {protocolOptions.find((option) => option.value === profile.protocol)?.label ?? profile.protocol}
                    </span>
                    <span className="provider-card__meta">
                      {profile.hasApiKey ? '已配置密钥' : '未配置密钥'}
                    </span>
                  </span>
                  <span className="provider-card__description">{profile.endpoint}</span>
                </button>
              </li>
            </Fragment>
          )
        })}
        {providerDragPreviewIndex === renderedProviderProfiles.length ? (
          <li className="topic-list__drop-gap" aria-hidden="true" />
        ) : null}
      </ul>

      {providerDragState !== null && draggingProvider !== null ? (
        <div
          ref={providerDragGhostRef}
          className="provider-card provider-card--drag-ghost"
          data-testid="settings-provider-drag-ghost"
          aria-hidden="true"
        >
          <span className="provider-card__title-row">
            <span className="provider-card__title">{draggingProvider.name}</span>
          </span>
          <span className="provider-card__meta-row">
            <span className="provider-card__meta">
              {protocolOptions.find((option) => option.value === draggingProvider.protocol)?.label ?? draggingProvider.protocol}
            </span>
          </span>
        </div>
      ) : null}

      {providerContextMenu !== null ? (
        <div
          className="session-context-menu provider-context-menu"
          data-testid="provider-context-menu"
          role="menu"
          aria-label={`${providerContextMenu.providerName} 服务商菜单`}
          style={{ left: `${providerContextMenu.x}px`, top: `${providerContextMenu.y}px` }}
        >
          <p className="session-context-menu__title">{providerContextMenu.providerName}</p>
          <div className="session-context-menu__group">
            <button
              type="button"
              className="session-context-menu__item"
              role="menuitem"
              onClick={() => {
                void onCopyProvider(providerContextMenu.providerId)
              }}
            >
              复制服务商
            </button>
            <button
              type="button"
              className="session-context-menu__item session-context-menu__item--danger"
              role="menuitem"
              onClick={() => {
                void onDeleteProvider(providerContextMenu.providerId)
              }}
            >
              删除服务商
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
