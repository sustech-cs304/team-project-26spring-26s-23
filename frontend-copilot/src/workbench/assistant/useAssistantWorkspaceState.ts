import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import {
  createRuntimeSession,
  getRuntimeCapabilities,
  listRuntimeAgents,
} from '../../features/copilot/chat-contract'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import type { AgentType, AssistantSessionShell } from '../types'
import type {
  AssistantSessionContextMenuState,
  AssistantSessionContextSubmenu,
  AssistantSessionDragState,
} from './assistant-session-list-helpers'
import {
  activateAssistantSession,
  emptyAssistantAgentDirectoryState,
  formatAssistantWorkspaceError,
  isCopilotConnectableState,
  type AssistantAgentDirectoryState,
  type AssistantSessionListState,
} from './assistant-workspace-controller'
import {
  createAssistantDirectoryDisconnectedState,
  createAssistantDirectoryErrorState,
  createAssistantDirectoryLoadingState,
  createInitialAssistantSelectedAgentId,
  loadAssistantAgentDirectory,
  resolveAssistantSelectedAgent,
  resolveAssistantSelectedAgentId,
} from './assistant-workspace-directory-loader'
import {
  createAssistantSessionContextMenuState,
  createAssistantSessionShellForAgent,
  getAssistantCreateSessionLabel,
  isAssistantCreateSessionButtonDisabled,
  type AssistantWorkspaceSessionStatus,
} from './assistant-workspace-session-controller'
import {
  appendAssistantSessionShell,
  clampAssistantSessionPreviewIndex,
  computeAssistantSessionPreviewIndex,
  createAssistantSessionListState,
  filterDraggedSessionFromRender,
  moveAssistantSessionShellToIndex,
  resolveActiveAssistantSessionShell,
} from './assistant-session-helpers'

interface UseAssistantWorkspaceStateInput {
  bootstrap: CopilotBootstrapController
  listAgents?: typeof listRuntimeAgents
  createSession?: typeof createRuntimeSession
  getCapabilities?: typeof getRuntimeCapabilities
  initialDirectoryState?: AssistantAgentDirectoryState
  initialSessionShell?: AssistantSessionShell | null
}

interface UseAssistantWorkspaceStateResult {
  directoryState: AssistantAgentDirectoryState
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  sessionListState: AssistantSessionListState
  sessionStatus: AssistantWorkspaceSessionStatus
  sessionError: string | null
  createSessionLabel: string
  createSessionButtonDisabled: boolean
  renderedSessions: AssistantSessionShell[]
  dragPreviewIndex: number | null
  draggingSessionShell: AssistantSessionShell | null
  sessionContextMenu: AssistantSessionContextMenuState | null
  sessionDragState: AssistantSessionDragState | null
  sessionListRef: MutableRefObject<HTMLUListElement | null>
  sessionDragGhostRef: MutableRefObject<HTMLDivElement | null>
  selectAgent: (agentId: string | null) => void
  handleCreateSession: () => Promise<void>
  handleSessionPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, sessionId: string) => void
  handleSessionClick: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  handleSessionContextMenu: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  dismissSessionContextMenu: () => void
  selectSessionSubmenu: (submenu: AssistantSessionContextSubmenu | null) => void
}

export function useAssistantWorkspaceState({
  bootstrap,
  listAgents: listAgentsImpl = listRuntimeAgents,
  createSession: createSessionImpl = createRuntimeSession,
  getCapabilities: getCapabilitiesImpl = getRuntimeCapabilities,
  initialDirectoryState = emptyAssistantAgentDirectoryState,
  initialSessionShell = null,
}: UseAssistantWorkspaceStateInput): UseAssistantWorkspaceStateResult {
  const [directoryState, setDirectoryState] = useState<AssistantAgentDirectoryState>(initialDirectoryState)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(() => (
    createInitialAssistantSelectedAgentId(initialDirectoryState)
  ))
  const [sessionListState, setSessionListState] = useState<AssistantSessionListState>(() => (
    createAssistantSessionListState(initialSessionShell)
  ))
  const [sessionStatus, setSessionStatus] = useState<AssistantWorkspaceSessionStatus>('idle')
  const [sessionError, setSessionError] = useState<string | null>(null)
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
    console.info('[startup]', JSON.stringify({
      scope: 'AssistantWorkspace',
      stage: 'mounted',
      t: Math.round(performance.now()),
      bootstrapStatus: bootstrap.state.status,
    }))

    return () => {
      console.info('[startup]', JSON.stringify({
        scope: 'AssistantWorkspace',
        stage: 'unmounted',
        t: Math.round(performance.now()),
      }))
    }
  }, [bootstrap.state.status])

  useEffect(() => {
    if (!isCopilotConnectableState(bootstrap.state)) {
      setDirectoryState((current) => createAssistantDirectoryDisconnectedState(current))
      return
    }

    let disposed = false
    setDirectoryState((current) => createAssistantDirectoryLoadingState(current))

    void loadAssistantAgentDirectory({
      runtimeUrl: bootstrap.state.runtimeUrl,
      listAgents: listAgentsImpl,
    })
      .then((nextDirectoryState) => {
        if (disposed) {
          return
        }

        setDirectoryState(nextDirectoryState)
        setSelectedAgentId((currentSelectedAgentId) => resolveAssistantSelectedAgentId({
          directoryState: nextDirectoryState,
          previousAgentId: currentSelectedAgentId,
        }))
      })
      .catch((error) => {
        if (disposed) {
          return
        }

        setDirectoryState(createAssistantDirectoryErrorState(error))
      })

    return () => {
      disposed = true
    }
  }, [bootstrap.state, listAgentsImpl])

  const selectedAgent = useMemo(
    () => resolveAssistantSelectedAgent({
      agents: directoryState.agents,
      selectedAgentId,
    }),
    [directoryState.agents, selectedAgentId],
  )
  const sessionShell = useMemo(
    () => resolveActiveAssistantSessionShell(sessionListState),
    [sessionListState],
  )
  const draggingSessionShell = useMemo(
    () => sessionDragState === null
      ? null
      : sessionListState.sessions.find((sessionEntry) => sessionEntry.sessionId === sessionDragState.draggingSessionId) ?? null,
    [sessionDragState, sessionListState.sessions],
  )
  const draggedSessionId = sessionDragState?.draggingSessionId ?? null
  const renderedSessions = useMemo(
    () => filterDraggedSessionFromRender(sessionListState.sessions, draggedSessionId),
    [draggedSessionId, sessionListState.sessions],
  )
  const dragPreviewIndex = sessionDragState === null
    ? null
    : clampAssistantSessionPreviewIndex(sessionDragState.previewIndex, renderedSessions.length)
  const createSessionLabel = useMemo(
    () => getAssistantCreateSessionLabel({ selectedAgent, sessionShell }),
    [selectedAgent, sessionShell],
  )
  const createSessionButtonDisabled = isAssistantCreateSessionButtonDisabled({
    bootstrapState: bootstrap.state,
    selectedAgent,
    sessionStatus,
  })

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

  const handleSelectSession = useCallback((sessionEntry: AssistantSessionShell) => {
    setSessionContextMenu(null)
    setSessionListState((current) => activateAssistantSession(current, sessionEntry.sessionId))
    setSelectedAgentId(sessionEntry.boundAgent.id)
  }, [])

  const handleCreateSession = useCallback(async () => {
    if (!isCopilotConnectableState(bootstrap.state) || selectedAgent === null || sessionStatus === 'creating') {
      return
    }

    setSessionContextMenu(null)
    setSessionStatus('creating')
    setSessionError(null)

    try {
      const nextSessionShell = await createAssistantSessionShellForAgent({
        runtimeUrl: bootstrap.state.runtimeUrl,
        selectedAgent,
        createSession: createSessionImpl,
        getCapabilities: getCapabilitiesImpl,
      })
      setSessionListState((current) => appendAssistantSessionShell(current, nextSessionShell))
      setSessionStatus('idle')
    } catch (error) {
      setSessionStatus('error')
      setSessionError(formatAssistantWorkspaceError(error))
    }
  }, [bootstrap.state, createSessionImpl, getCapabilitiesImpl, selectedAgent, sessionStatus])

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
  }, [scheduleSessionDragGhostPosition])

  const handleSessionClick = useCallback((sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressSessionClickRef.current) {
      event.preventDefault()
      event.stopPropagation()
      suppressSessionClickRef.current = false
      return
    }

    handleSelectSession(sessionEntry)
  }, [handleSelectSession])

  const handleSessionContextMenu = useCallback((sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setSessionListState((current) => activateAssistantSession(current, sessionEntry.sessionId))
    setSelectedAgentId(sessionEntry.boundAgent.id)
    setSessionContextMenu(createAssistantSessionContextMenuState({
      sessionEntry,
      x: event.clientX,
      y: event.clientY,
    }))
  }, [])

  const dismissSessionContextMenu = useCallback(() => {
    setSessionContextMenu(null)
  }, [])

  const selectSessionSubmenu = useCallback((submenu: AssistantSessionContextSubmenu | null) => {
    setSessionContextMenu((current) => current === null
      ? current
      : {
          ...current,
          activeSubmenu: submenu,
        })
  }, [])

  return {
    directoryState,
    selectedAgent,
    sessionShell,
    sessionListState,
    sessionStatus,
    sessionError,
    createSessionLabel,
    createSessionButtonDisabled,
    renderedSessions,
    dragPreviewIndex,
    draggingSessionShell,
    sessionContextMenu,
    sessionDragState,
    sessionListRef,
    sessionDragGhostRef,
    selectAgent: setSelectedAgentId,
    handleCreateSession,
    handleSessionPointerDown,
    handleSessionClick,
    handleSessionContextMenu,
    dismissSessionContextMenu,
    selectSessionSubmenu,
  }
}
