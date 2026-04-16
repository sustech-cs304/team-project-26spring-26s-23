import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react'

import type { AssistantSessionShell } from '../types'
import type {
  AssistantSessionContextMenuState,
  AssistantSessionDragState,
} from './assistant-session-list-helpers'
import type { AssistantSessionListState } from './assistant-workspace-controller'
import {
  computeAssistantSessionPreviewIndex,
  moveAssistantSessionShellToIndex,
} from './assistant-session-helpers'
import {
  createAssistantRenderedSessionState,
  createAssistantSessionContextMenuState,
} from './assistant-workspace-state-helpers'

interface UseAssistantSessionInteractionStateInput {
  sessionListState: AssistantSessionListState
  setSessionListState: Dispatch<SetStateAction<AssistantSessionListState>>
  activateSession: (sessionEntry: AssistantSessionShell) => void
}

interface UseAssistantSessionInteractionStateResult {
  renderedSessions: AssistantSessionShell[]
  dragPreviewIndex: number | null
  draggingSessionShell: AssistantSessionShell | null
  sessionContextMenu: AssistantSessionContextMenuState | null
  sessionDragState: AssistantSessionDragState | null
  sessionListRef: MutableRefObject<HTMLUListElement | null>
  sessionDragGhostRef: MutableRefObject<HTMLDivElement | null>
  handleSessionPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, sessionId: string) => void
  handleSessionClick: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  handleSessionContextMenu: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  dismissSessionContextMenu: () => void
}

export function useAssistantSessionInteractionState({
  sessionListState,
  setSessionListState,
  activateSession,
}: UseAssistantSessionInteractionStateInput): UseAssistantSessionInteractionStateResult {
  const [sessionContextMenu, setSessionContextMenu] = useState<AssistantSessionContextMenuState | null>(null)
  const [sessionDragState, setSessionDragState] = useState<AssistantSessionDragState | null>(null)
  const sessionListRef = useRef<HTMLUListElement | null>(null)
  const sessionDragGhostRef = useRef<HTMLDivElement | null>(null)
  const sessionDragStateRef = useRef<AssistantSessionDragState | null>(null)
  const pendingSessionPointerRef = useRef<{
    sessionId: string
    startX: number
    startY: number
    pointerOffsetX: number
    pointerOffsetY: number
  } | null>(null)
  const sessionPointerCleanupRef = useRef<(() => void) | null>(null)
  const sessionDragGhostFrameRef = useRef<number | null>(null)
  const suppressSessionClickRef = useRef(false)

  useEffect(() => {
    if (sessionContextMenu === null) {
      return undefined
    }

    const handleWindowMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-testid="assistant-session-context-menu"]') !== null) {
        return
      }

      setSessionContextMenu(null)
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSessionContextMenu(null)
        setSessionDragState(null)
        pendingSessionPointerRef.current = null
      }
    }

    const handleWindowBlur = () => {
      setSessionDragState(null)
      pendingSessionPointerRef.current = null
    }

    window.addEventListener('mousedown', handleWindowMouseDown)
    window.addEventListener('keydown', handleWindowKeyDown)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('mousedown', handleWindowMouseDown)
      window.removeEventListener('keydown', handleWindowKeyDown)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [sessionContextMenu])

  useEffect(() => {
    sessionDragStateRef.current = sessionDragState
  }, [sessionDragState])

  useEffect(() => {
    return () => {
      sessionPointerCleanupRef.current?.()
      if (sessionDragGhostFrameRef.current !== null) {
        cancelAnimationFrame(sessionDragGhostFrameRef.current)
      }
    }
  }, [])

  const scheduleSessionDragGhostPosition = useCallback((
    pointerX: number,
    pointerY: number,
    pointerOffsetX: number,
    pointerOffsetY: number,
  ) => {
    if (sessionDragGhostFrameRef.current !== null) {
      cancelAnimationFrame(sessionDragGhostFrameRef.current)
    }

    sessionDragGhostFrameRef.current = requestAnimationFrame(() => {
      if (sessionDragGhostRef.current !== null) {
        sessionDragGhostRef.current.style.transform = `translate3d(${pointerX - pointerOffsetX}px, ${pointerY - pointerOffsetY}px, 0)`
      }
      sessionDragGhostFrameRef.current = null
    })
  }, [])

  const handleSessionPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, sessionId: string) => {
    if (event.button !== 0) {
      return
    }

    setSessionContextMenu(null)
    sessionPointerCleanupRef.current?.()

    const previousUserSelect = document.body.style.userSelect
    const currentTargetRect = event.currentTarget.getBoundingClientRect()
    pendingSessionPointerRef.current = {
      sessionId,
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
      pendingSessionPointerRef.current = null
      sessionPointerCleanupRef.current = null
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const pending = pendingSessionPointerRef.current
      if (pending === null) {
        return
      }

      const pointerTravel = Math.abs(moveEvent.clientX - pending.startX) + Math.abs(moveEvent.clientY - pending.startY)
      if (pointerTravel < 4 && sessionDragStateRef.current === null) {
        return
      }

      suppressSessionClickRef.current = true
      document.body.style.userSelect = 'none'
      scheduleSessionDragGhostPosition(
        moveEvent.clientX,
        moveEvent.clientY,
        pending.pointerOffsetX,
        pending.pointerOffsetY,
      )

      const listElement = sessionListRef.current
      const nextPreviewIndex = listElement === null
        ? 0
        : computeAssistantSessionPreviewIndex(
            listElement,
            moveEvent.clientY - pending.pointerOffsetY + (currentTargetRect.height / 2),
          )

      setSessionDragState({
        draggingSessionId: pending.sessionId,
        previewIndex: nextPreviewIndex,
      })
    }

    const handlePointerUp = () => {
      const dragSnapshot = sessionDragStateRef.current
      if (dragSnapshot !== null) {
        setSessionListState((current) => moveAssistantSessionShellToIndex(
          current,
          dragSnapshot.draggingSessionId,
          dragSnapshot.previewIndex,
        ))
        setSessionDragState(null)
        requestAnimationFrame(() => {
          suppressSessionClickRef.current = false
        })
      }

      cleanup()
    }

    sessionPointerCleanupRef.current = cleanup
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }, [scheduleSessionDragGhostPosition, setSessionListState])

  const handleSessionClick = useCallback((sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressSessionClickRef.current) {
      event.preventDefault()
      event.stopPropagation()
      suppressSessionClickRef.current = false
      return
    }

    setSessionContextMenu(null)
    activateSession(sessionEntry)
  }, [activateSession])

  const handleSessionContextMenu = useCallback((sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    activateSession(sessionEntry)
    setSessionContextMenu(createAssistantSessionContextMenuState({
      sessionEntry,
      x: event.clientX,
      y: event.clientY,
    }))
  }, [activateSession])

  const dismissSessionContextMenu = useCallback(() => {
    setSessionContextMenu(null)
  }, [])

  const renderedSessionState = useMemo(
    () => createAssistantRenderedSessionState({
      sessions: sessionListState.sessions,
      sessionDragState,
    }),
    [sessionDragState, sessionListState.sessions],
  )

  return {
    renderedSessions: renderedSessionState.renderedSessions,
    dragPreviewIndex: renderedSessionState.dragPreviewIndex,
    draggingSessionShell: renderedSessionState.draggingSessionShell,
    sessionContextMenu,
    sessionDragState,
    sessionListRef,
    sessionDragGhostRef,
    handleSessionPointerDown,
    handleSessionClick,
    handleSessionContextMenu,
    dismissSessionContextMenu,
  }
}
