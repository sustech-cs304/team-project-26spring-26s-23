import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { ProviderProfile } from '../types'

import { gsap } from '../animation-utils'

import { computeProviderPreviewIndex, type ProviderDragState } from './provider-profiles'

interface UseProviderProfileListDragArgs {
  providerProfiles: ProviderProfile[]
  filteredProviderProfiles: ProviderProfile[]
  onReorderProviders: (providerId: string, nextIndex: number) => void
}

interface PendingProviderPointer {
  providerId: string
  startX: number
  startY: number
  pointerOffsetX: number
  pointerOffsetY: number
}

function createProviderPointerDownHandler(params: {
  providerListRef: React.RefObject<HTMLUListElement | null>
  providerDragGhostRef: React.RefObject<HTMLDivElement | null>
  providerDragStateRef: React.MutableRefObject<ProviderDragState | null>
  pendingProviderPointerRef: React.MutableRefObject<PendingProviderPointer | null>
  providerPointerCleanupRef: React.MutableRefObject<(() => void) | null>
  suppressProviderClickRef: React.MutableRefObject<boolean>
  ghostLiftedRef: React.MutableRefObject<boolean>
  setProviderDragState: React.Dispatch<React.SetStateAction<ProviderDragState | null>>
  onReorderProviders: (providerId: string, nextIndex: number) => void
}) {
  const {
    providerListRef,
    providerDragGhostRef,
    providerDragStateRef,
    pendingProviderPointerRef,
    providerPointerCleanupRef,
    suppressProviderClickRef,
    ghostLiftedRef,
    setProviderDragState,
    onReorderProviders,
  } = params

  return function handleProviderPointerDown(event: ReactPointerEvent<HTMLButtonElement>, providerId: string) {
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
      if (!ghostLiftedRef.current && providerDragGhostRef.current) {
        ghostLiftedRef.current = true
        gsap.from(providerDragGhostRef.current, { scale: 0.8, opacity: 0, duration: 0.18, ease: 'back.out(2)' })
      }
      gsap.set(providerDragGhostRef.current, {
        x: moveEvent.clientX - pending.pointerOffsetX,
        y: moveEvent.clientY - pending.pointerOffsetY,
      })

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
      ghostLiftedRef.current = false
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
  const pendingProviderPointerRef = useRef<PendingProviderPointer | null>(null)
  const providerPointerCleanupRef = useRef<(() => void) | null>(null)
  const suppressProviderClickRef = useRef(false)
  const ghostLiftedRef = useRef(false)

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
    const cleanupRef = providerPointerCleanupRef
    return () => { cleanupRef.current?.() }
  }, [])

  const handleProviderPointerDown = useMemo(
    () => createProviderPointerDownHandler({
      providerListRef,
      providerDragGhostRef,
      providerDragStateRef,
      pendingProviderPointerRef,
      providerPointerCleanupRef,
      suppressProviderClickRef,
      ghostLiftedRef,
      setProviderDragState,
      onReorderProviders,
    }),
    [onReorderProviders],
  )

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
