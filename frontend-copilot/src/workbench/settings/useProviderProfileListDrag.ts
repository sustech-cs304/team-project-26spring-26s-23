import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { ProviderProfile } from '../types'

import { computeProviderPreviewIndex, type ProviderDragState } from './provider-profiles'

interface UseProviderProfileListDragArgs {
  providerProfiles: ProviderProfile[]
  filteredProviderProfiles: ProviderProfile[]
  onReorderProviders: (providerId: string, nextIndex: number) => void
}

export function useProviderProfileListDrag({
  providerProfiles,
  filteredProviderProfiles,
  onReorderProviders,
}: UseProviderProfileListDragArgs) {
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
    return () => {
      providerPointerCleanupRef.current?.()
      if (providerDragGhostFrameRef.current !== null) {
        cancelAnimationFrame(providerDragGhostFrameRef.current)
      }
    }
  }, [])

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

  return {
    draggingProvider,
    providerDragGhostRef,
    providerDragPreviewIndex,
    providerListRef,
    renderedProviderProfiles,
    handleProviderPointerDown,
    consumeSuppressedProviderClick() {
      if (!suppressProviderClickRef.current) {
        return false
      }

      suppressProviderClickRef.current = false
      return true
    },
    resetProviderDragInteraction() {
      setProviderDragState(null)
      pendingProviderPointerRef.current = null
    },
  }
}
