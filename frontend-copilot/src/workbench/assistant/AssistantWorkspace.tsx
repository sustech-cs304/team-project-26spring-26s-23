import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import {
  createRuntimeSession,
  getRuntimeCapabilities,
  listRuntimeAgents,
} from '../../features/copilot/chat-contract'
import { CopilotChatPanel } from '../../features/copilot/CopilotChatPanel'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import { pickDefaultAgentId } from '../config'
import type { AssistantSessionShell } from '../types'
import { AssistantAgentDirectoryPane } from './AssistantAgentDirectoryPane'
import {
  AssistantSessionList,
  type AssistantSessionContextMenuState,
  type AssistantSessionDragState,
} from './AssistantSessionList'
import {
  activateAssistantSession,
  createAssistantAgentDirectoryState,
  createAssistantSessionShellForAgent,
  emptyAssistantAgentDirectoryState,
  formatAssistantWorkspaceError,
  isCopilotConnectableState,
  type AssistantAgentDirectoryState,
  type AssistantSessionListState,
} from './assistant-workspace-controller'
import {
  appendAssistantSessionShell,
  clampAssistantSessionPreviewIndex,
  computeAssistantSessionPreviewIndex,
  createAssistantSessionListState,
  filterDraggedSessionFromRender,
  moveAssistantSessionShellToIndex,
  resolveActiveAssistantSessionShell,
} from './assistant-session-helpers'

export type {
  AssistantAgentDirectoryState,
  AssistantSessionListState,
} from './assistant-workspace-controller'
export {
  createAssistantAgentDirectoryState,
  createAssistantSessionCapabilities,
  createAssistantSessionShell,
  createAssistantSessionShellForAgent,
} from './assistant-workspace-controller'
export {
  appendAssistantSessionShell,
  createAssistantSessionListState,
  moveAssistantSessionShellToIndex,
  reorderAssistantSessionShells,
  resolveActiveAssistantSessionShell,
} from './assistant-session-helpers'

console.info('[startup]', JSON.stringify({
  scope: 'AssistantWorkspace',
  stage: 'module-evaluated',
  t: Math.round(performance.now()),
}))

interface AssistantWorkspaceProps {
  bootstrap: CopilotBootstrapController
  listAgents?: typeof listRuntimeAgents
  createSession?: typeof createRuntimeSession
  getCapabilities?: typeof getRuntimeCapabilities
  initialDirectoryState?: AssistantAgentDirectoryState
  initialSessionShell?: AssistantSessionShell | null
}

export function AssistantWorkspace({
  bootstrap,
  listAgents: listAgentsImpl = listRuntimeAgents,
  createSession: createSessionImpl = createRuntimeSession,
  getCapabilities: getCapabilitiesImpl = getRuntimeCapabilities,
  initialDirectoryState = emptyAssistantAgentDirectoryState,
  initialSessionShell = null,
}: AssistantWorkspaceProps) {
  const [directoryState, setDirectoryState] = useState<AssistantAgentDirectoryState>(initialDirectoryState)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    pickDefaultAgentId({
      agents: initialDirectoryState.agents,
      defaultAgentId: initialDirectoryState.defaultAgentId,
    }),
  )
  const [sessionListState, setSessionListState] = useState<AssistantSessionListState>(() => (
    createAssistantSessionListState(initialSessionShell)
  ))
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'creating' | 'error'>('idle')
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
      setDirectoryState((current) => ({
        ...current,
        status: current.status === 'ready' ? current.status : 'idle',
        error: null,
      }))
      return
    }

    let disposed = false
    setDirectoryState((current) => ({
      ...current,
      status: current.agents.length > 0 ? current.status : 'loading',
      error: null,
    }))

    void listAgentsImpl({ runtimeUrl: bootstrap.state.runtimeUrl })
      .then((response) => {
        if (disposed) {
          return
        }

        const nextDirectoryState = createAssistantAgentDirectoryState(response)
        setDirectoryState(nextDirectoryState)
        setSelectedAgentId((currentSelectedAgentId) => pickDefaultAgentId({
          agents: nextDirectoryState.agents,
          defaultAgentId: nextDirectoryState.defaultAgentId,
          previousAgentId: currentSelectedAgentId,
        }))
      })
      .catch((error) => {
        if (disposed) {
          return
        }

        setDirectoryState({
          ...emptyAssistantAgentDirectoryState,
          status: 'error',
          error: formatAssistantWorkspaceError(error),
        })
      })

    return () => {
      disposed = true
    }
  }, [bootstrap.state, listAgentsImpl])

  const selectedAgent = useMemo(
    () => directoryState.agents.find((agent) => agent.id === selectedAgentId) ?? null,
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

  const handleCreateSession = async () => {
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
  }

  const createSessionLabel = useMemo(() => {
    if (selectedAgent === null) {
      return '等待后端目录提供可用智能体'
    }

    if (sessionShell !== null && sessionShell.boundAgent.id !== selectedAgent.id) {
      return `切换到 ${selectedAgent.label} 并新建会话`
    }

    return `为 ${selectedAgent.label} 创建会话`
  }, [selectedAgent, sessionShell])

  const createSessionButtonDisabled = !isCopilotConnectableState(bootstrap.state)
    || selectedAgent === null
    || sessionStatus === 'creating'

  const scheduleSessionDragGhostPosition = (
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
  }

  const handleSelectSession = (sessionEntry: AssistantSessionShell) => {
    setSessionContextMenu(null)
    setSessionListState((current) => activateAssistantSession(current, sessionEntry.sessionId))
    setSelectedAgentId(sessionEntry.boundAgent.id)
  }

  const handleSessionPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, sessionId: string) => {
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
  }

  return (
    <section className="workspace-stage conversation-workspace" aria-label="助手工作区">
      <AssistantAgentDirectoryPane
        directoryState={directoryState}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgentId}
      />

      <AssistantSessionList
        selectedAgent={selectedAgent}
        sessionListState={sessionListState}
        sessionStatus={sessionStatus}
        createSessionLabel={createSessionLabel}
        createSessionButtonDisabled={createSessionButtonDisabled}
        renderedSessions={renderedSessions}
        dragPreviewIndex={dragPreviewIndex}
        draggingSessionShell={draggingSessionShell}
        sessionContextMenu={sessionContextMenu}
        sessionDragState={sessionDragState}
        sessionError={sessionError}
        sessionListRef={sessionListRef}
        sessionDragGhostRef={sessionDragGhostRef}
        onCreateSession={() => {
          void handleCreateSession()
        }}
        onSessionPointerDown={handleSessionPointerDown}
        onSessionClick={(sessionEntry, event) => {
          if (suppressSessionClickRef.current) {
            event.preventDefault()
            event.stopPropagation()
            suppressSessionClickRef.current = false
            return
          }

          handleSelectSession(sessionEntry)
        }}
        onSessionContextMenu={(sessionEntry, event) => {
          event.preventDefault()
          setSessionListState((current) => activateAssistantSession(current, sessionEntry.sessionId))
          setSelectedAgentId(sessionEntry.boundAgent.id)
          setSessionContextMenu({
            sessionId: sessionEntry.sessionId,
            sessionLabel: sessionEntry.boundAgent.label,
            x: event.clientX,
            y: event.clientY,
            activeSubmenu: null,
          })
        }}
        onDismissContextMenu={() => setSessionContextMenu(null)}
        onSelectSubmenu={(activeSubmenu) => {
          setSessionContextMenu((current) => current === null
            ? current
            : {
                ...current,
                activeSubmenu,
              })
        }}
      />

      <main className="workspace-main workspace-main--chat" aria-label="会话主内容区">
        <div className="workspace-chat-layout" data-testid="assistant-chat-workspace">
          <CopilotChatPanel
            state={bootstrap.state}
            retrying={bootstrap.retrying}
            retry={bootstrap.retry}
            selectedAgent={selectedAgent}
            sessionShell={sessionShell}
            directoryState={directoryState}
            sessionStatus={sessionStatus}
            sessionError={sessionError}
          />
        </div>
      </main>
    </section>
  )
}
