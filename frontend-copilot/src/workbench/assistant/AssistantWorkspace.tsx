import {
  Fragment,
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
  type RuntimeAgentsListResponse,
  type RuntimeCapabilitiesGetResponse,
  type RuntimeSessionCreateResponse,
} from '../../features/copilot/chat-contract'
import { CopilotChatPanel } from '../../features/copilot/CopilotChatPanel'
import type { CopilotBootstrapController, CopilotConnectableState } from '../../features/copilot/types'
import { enhanceRuntimeAgents, pickDefaultAgentId } from '../config'
import type { AgentType, AssistantSessionCapabilities, AssistantSessionShell } from '../types'

console.info('[startup]', JSON.stringify({
  scope: 'AssistantWorkspace',
  stage: 'module-evaluated',
  t: Math.round(performance.now()),
}))

export interface AssistantAgentDirectoryState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  directoryVersion: string | null
  defaultAgentId: string | null
  agents: AgentType[]
  error: string | null
}

export interface AssistantSessionListState {
  sessions: AssistantSessionShell[]
  activeSessionId: string | null
}

interface AssistantSessionContextMenuState {
  sessionId: string
  sessionLabel: string
  x: number
  y: number
  activeSubmenu: 'copy' | 'export' | null
}

interface AssistantSessionDragState {
  draggingSessionId: string
  previewIndex: number
}

interface AssistantWorkspaceProps {
  bootstrap: CopilotBootstrapController
  listAgents?: typeof listRuntimeAgents
  createSession?: typeof createRuntimeSession
  getCapabilities?: typeof getRuntimeCapabilities
  initialDirectoryState?: AssistantAgentDirectoryState
  initialSessionShell?: AssistantSessionShell | null
}

const emptyDirectoryState: AssistantAgentDirectoryState = {
  status: 'idle',
  directoryVersion: null,
  defaultAgentId: null,
  agents: [],
  error: null,
}

export function AssistantWorkspace({
  bootstrap,
  listAgents: listAgentsImpl = listRuntimeAgents,
  createSession: createSessionImpl = createRuntimeSession,
  getCapabilities: getCapabilitiesImpl = getRuntimeCapabilities,
  initialDirectoryState = emptyDirectoryState,
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
          ...emptyDirectoryState,
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
    () => draggedSessionId === null
      ? sessionListState.sessions
      : sessionListState.sessions.filter((sessionEntry) => sessionEntry.sessionId !== draggedSessionId),
    [draggedSessionId, sessionListState.sessions],
  )
  const dragPreviewIndex = sessionDragState === null
    ? null
    : Math.max(0, Math.min(sessionDragState.previewIndex, renderedSessions.length))

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
      <aside className="workspace-panel assistant-panel" aria-label="智能体目录列">
        <header className="panel-head">
          <p className="panel-head__eyebrow">助手</p>
          <h1 className="panel-head__title">后端智能体目录</h1>
        </header>

        {directoryState.status === 'loading' && (
          <p className="panel-head__description">正在从后端拉取智能体目录…</p>
        )}
        {directoryState.status === 'error' && directoryState.error !== null && (
          <p className="panel-head__description">{directoryState.error}</p>
        )}

        <ul className="assistant-list">
          {directoryState.agents.map((agent) => {
            const Icon = agent.icon
            const active = agent.id === selectedAgent?.id

            return (
              <li key={agent.id}>
                <button
                  type="button"
                  className={`assistant-card${active ? ' assistant-card--active' : ''}`}
                  onClick={() => setSelectedAgentId(agent.id)}
                  disabled={agent.status !== 'active'}
                  >
                    <span className="assistant-card__icon-wrap">
                      <Icon size={18} className="assistant-card__icon" />
                    </span>
                    <span className="assistant-card__body">
                      <span className="assistant-card__title">{agent.label}</span>
                    </span>
                  </button>
                </li>
            )
          })}
        </ul>
      </aside>

      <aside className="workspace-panel topic-panel" aria-label="会话创建列">
        <header className="panel-head">
          <p className="panel-head__eyebrow">会话</p>
          <h2 className="panel-head__title">
            {selectedAgent?.label ?? '等待选择智能体'}
          </h2>
        </header>

        <button
          type="button"
          className="new-thread-button"
          data-testid="assistant-create-session-button"
          onClick={() => {
            void handleCreateSession()
          }}
          disabled={createSessionButtonDisabled}
          aria-busy={sessionStatus === 'creating'}
          aria-label={createSessionLabel}
        >
          <span>＋</span>
          <span>{createSessionLabel}</span>
        </button>

        {sessionListState.sessions.length > 0 && (
          <ul
            ref={sessionListRef}
            className="topic-list topic-list--detailed"
            data-testid="assistant-session-list"
          >
            {renderedSessions.map((sessionEntry, visualIndex) => {
              const active = sessionEntry.sessionId === sessionListState.activeSessionId

              return (
                <Fragment key={sessionEntry.sessionId}>
                  {dragPreviewIndex === visualIndex && (
                    <li
                      className="topic-list__drop-gap"
                      data-testid={`assistant-session-drop-gap-${visualIndex}`}
                      aria-hidden="true"
                    />
                  )}
                  <li
                    className="topic-list__item"
                    data-testid={`assistant-session-list-item-${sessionEntry.sessionId}`}
                    data-session-order-index={visualIndex}
                  >
                    <button
                      type="button"
                      className={`topic-card${active ? ' topic-card--active' : ''}`}
                      data-testid={`assistant-session-card-${sessionEntry.sessionId}`}
                      onPointerDown={(event) => handleSessionPointerDown(event, sessionEntry.sessionId)}
                      onClick={(event) => {
                        if (suppressSessionClickRef.current) {
                          event.preventDefault()
                          event.stopPropagation()
                          suppressSessionClickRef.current = false
                          return
                        }

                        setSessionContextMenu(null)
                        setSessionListState((current) => ({
                          ...current,
                          activeSessionId: sessionEntry.sessionId,
                        }))
                        setSelectedAgentId(sessionEntry.boundAgent.id)
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setSessionListState((current) => ({
                          ...current,
                          activeSessionId: sessionEntry.sessionId,
                        }))
                        setSelectedAgentId(sessionEntry.boundAgent.id)
                        setSessionContextMenu({
                          sessionId: sessionEntry.sessionId,
                          sessionLabel: sessionEntry.boundAgent.label,
                          x: event.clientX,
                          y: event.clientY,
                          activeSubmenu: null,
                        })
                      }}
                    >
                      <span className="topic-card__title">{sessionEntry.boundAgent.label}</span>
                      <span className="topic-card__meta">
                      </span>
                    </button>
                  </li>
                </Fragment>
              )
            })}
            {dragPreviewIndex === renderedSessions.length && (
              <li
                className="topic-list__drop-gap"
                data-testid={`assistant-session-drop-gap-${renderedSessions.length}`}
                aria-hidden="true"
              />
            )}
          </ul>
        )}

        {sessionDragState !== null && draggingSessionShell !== null && (
          <div
            ref={sessionDragGhostRef}
            className="topic-card topic-card--drag-ghost"
            data-testid="assistant-session-drag-ghost"
            aria-hidden="true"
          >
            <span className="topic-card__title">{draggingSessionShell.boundAgent.label}</span>
            <span className="topic-card__meta">
            </span>
          </div>
        )}

        {sessionContextMenu !== null && (
          <div
            className="session-context-menu"
            data-testid="assistant-session-context-menu"
            role="menu"
            aria-label={`${sessionContextMenu.sessionLabel} 会话菜单`}
            style={{ left: `${sessionContextMenu.x}px`, top: `${sessionContextMenu.y}px` }}
          >
            <p className="session-context-menu__title">{sessionContextMenu.sessionLabel}</p>

            <div className="session-context-menu__group">
              <button
                type="button"
                className="session-context-menu__item"
                data-testid="assistant-session-context-action-rename"
                role="menuitem"
                onClick={() => setSessionContextMenu(null)}
              >
                重命名会话
              </button>
              <button
                type="button"
                className="session-context-menu__item"
                data-testid="assistant-session-context-action-delete"
                role="menuitem"
                onClick={() => setSessionContextMenu(null)}
              >
                删除会话
              </button>
              <button
                type="button"
                className="session-context-menu__item"
                data-testid="assistant-session-context-action-generate-title"
                role="menuitem"
                onClick={() => setSessionContextMenu(null)}
              >
                生成会话名
              </button>

              <div
                className="session-context-menu__submenu"
                onMouseEnter={() => {
                  setSessionContextMenu((current) => current === null
                    ? current
                    : {
                        ...current,
                        activeSubmenu: 'copy',
                      })
                }}
                onMouseLeave={() => {
                  setSessionContextMenu((current) => current === null
                    ? current
                    : {
                        ...current,
                        activeSubmenu: current.activeSubmenu === 'copy' ? null : current.activeSubmenu,
                      })
                }}
              >
                <button
                  type="button"
                  className="session-context-menu__item session-context-menu__item--submenu"
                  data-testid="assistant-session-context-submenu-copy"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={sessionContextMenu.activeSubmenu === 'copy'}
                  onFocus={() => {
                    setSessionContextMenu((current) => current === null
                      ? current
                      : {
                          ...current,
                          activeSubmenu: 'copy',
                        })
                  }}
                  onClick={() => {
                    setSessionContextMenu((current) => current === null
                      ? current
                      : {
                          ...current,
                          activeSubmenu: current.activeSubmenu === 'copy' ? null : 'copy',
                        })
                  }}
                >
                  <span>复制会话</span>
                  <span className="session-context-menu__submenu-caret" aria-hidden="true">›</span>
                </button>

                {sessionContextMenu.activeSubmenu === 'copy' && (
                  <div
                    className="session-context-submenu"
                    data-testid="assistant-session-context-submenu-panel-copy"
                    role="menu"
                    aria-label="复制会话子菜单"
                  >
                    <button
                      type="button"
                      className="session-context-menu__item"
                      data-testid="assistant-session-context-action-copy-session"
                      role="menuitem"
                      onClick={() => setSessionContextMenu(null)}
                    >
                      复制为新会话
                    </button>
                    <button
                      type="button"
                      className="session-context-menu__item"
                      data-testid="assistant-session-context-action-copy-markdown"
                      role="menuitem"
                      onClick={() => setSessionContextMenu(null)}
                    >
                      复制为 Markdown
                    </button>
                    <button
                      type="button"
                      className="session-context-menu__item"
                      data-testid="assistant-session-context-action-copy-text"
                      role="menuitem"
                      onClick={() => setSessionContextMenu(null)}
                    >
                      复制为纯文本
                    </button>
                  </div>
                )}
              </div>

              <div
                className="session-context-menu__submenu"
                onMouseEnter={() => {
                  setSessionContextMenu((current) => current === null
                    ? current
                    : {
                        ...current,
                        activeSubmenu: 'export',
                      })
                }}
                onMouseLeave={() => {
                  setSessionContextMenu((current) => current === null
                    ? current
                    : {
                        ...current,
                        activeSubmenu: current.activeSubmenu === 'export' ? null : current.activeSubmenu,
                      })
                }}
              >
                <button
                  type="button"
                  className="session-context-menu__item session-context-menu__item--submenu"
                  data-testid="assistant-session-context-submenu-export"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={sessionContextMenu.activeSubmenu === 'export'}
                  onFocus={() => {
                    setSessionContextMenu((current) => current === null
                      ? current
                      : {
                          ...current,
                          activeSubmenu: 'export',
                        })
                  }}
                  onClick={() => {
                    setSessionContextMenu((current) => current === null
                      ? current
                      : {
                          ...current,
                          activeSubmenu: current.activeSubmenu === 'export' ? null : 'export',
                        })
                  }}
                >
                  <span>导出会话</span>
                  <span className="session-context-menu__submenu-caret" aria-hidden="true">›</span>
                </button>

                {sessionContextMenu.activeSubmenu === 'export' && (
                  <div
                    className="session-context-submenu"
                    data-testid="assistant-session-context-submenu-panel-export"
                    role="menu"
                    aria-label="导出会话子菜单"
                  >
                    <button
                      type="button"
                      className="session-context-menu__item"
                      data-testid="assistant-session-context-action-export-markdown"
                      role="menuitem"
                      onClick={() => setSessionContextMenu(null)}
                    >
                      导出到 Markdown
                    </button>
                    <button
                      type="button"
                      className="session-context-menu__item"
                      data-testid="assistant-session-context-action-export-json"
                      role="menuitem"
                      onClick={() => setSessionContextMenu(null)}
                    >
                      导出到 JSON
                    </button>
                    <button
                      type="button"
                      className="session-context-menu__item"
                      data-testid="assistant-session-context-action-export-text"
                      role="menuitem"
                      onClick={() => setSessionContextMenu(null)}
                    >
                      导出为纯文本
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {sessionError !== null && (
          <p className="panel-head__description" role="alert">{sessionError}</p>
        )}
      </aside>

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

export function createAssistantAgentDirectoryState(
  response: RuntimeAgentsListResponse,
): AssistantAgentDirectoryState {
  return {
    status: 'ready',
    directoryVersion: response.directoryVersion,
    defaultAgentId: response.defaultAgentId,
    agents: enhanceRuntimeAgents(response.agents),
    error: null,
  }
}

export function createAssistantSessionCapabilities(
  response: RuntimeCapabilitiesGetResponse,
): AssistantSessionCapabilities {
  return {
    capabilitiesVersion: response.capabilitiesVersion,
    allAvailableTools: response.tools.map((tool) => ({ ...tool })),
    recommendedToolsForAgent: [...response.recommendedTools],
    defaultEnabledTools: [...response.recommendedTools],
    toolSelectionMode: response.toolSelectionMode,
    defaultModelPreference: response.defaultModelPreference,
  }
}

export function createAssistantSessionShell(input: {
  response: RuntimeSessionCreateResponse
  selectedAgent: AgentType
  capabilities: RuntimeCapabilitiesGetResponse
}): AssistantSessionShell {
  return {
    sessionId: input.response.sessionId,
    boundAgent: input.selectedAgent,
    createdAt: input.response.createdAt,
    updatedAt: input.response.updatedAt,
    capabilities: createAssistantSessionCapabilities(input.capabilities),
  }
}

export async function createAssistantSessionShellForAgent(input: {
  runtimeUrl: string
  selectedAgent: AgentType
  createSession: typeof createRuntimeSession
  getCapabilities: typeof getRuntimeCapabilities
}): Promise<AssistantSessionShell> {
  const sessionResponse = await input.createSession({
    runtimeUrl: input.runtimeUrl,
    agentId: input.selectedAgent.id,
  })
  const capabilitiesResponse = await input.getCapabilities({
    runtimeUrl: input.runtimeUrl,
    sessionId: sessionResponse.sessionId,
  })

  return createAssistantSessionShell({
    response: sessionResponse,
    selectedAgent: input.selectedAgent,
    capabilities: capabilitiesResponse,
  })
}

export function createAssistantSessionListState(
  initialSessionShell: AssistantSessionShell | null,
): AssistantSessionListState {
  if (initialSessionShell === null) {
    return {
      sessions: [],
      activeSessionId: null,
    }
  }

  return {
    sessions: [initialSessionShell],
    activeSessionId: initialSessionShell.sessionId,
  }
}

export function appendAssistantSessionShell(
  state: AssistantSessionListState,
  nextSessionShell: AssistantSessionShell,
): AssistantSessionListState {
  const remainingSessions = state.sessions.filter((sessionEntry) => sessionEntry.sessionId !== nextSessionShell.sessionId)

  return {
    sessions: [nextSessionShell, ...remainingSessions],
    activeSessionId: nextSessionShell.sessionId,
  }
}

export function moveAssistantSessionShellToIndex(
  state: AssistantSessionListState,
  draggingSessionId: string,
  nextIndex: number,
): AssistantSessionListState {
  const draggingIndex = state.sessions.findIndex((sessionEntry) => sessionEntry.sessionId === draggingSessionId)

  if (draggingIndex === -1) {
    return state
  }

  const nextSessions = [...state.sessions]
  const [draggingSession] = nextSessions.splice(draggingIndex, 1)

  if (draggingSession === undefined) {
    return state
  }

  const normalizedIndex = Math.max(0, Math.min(nextIndex, nextSessions.length))
  nextSessions.splice(normalizedIndex, 0, draggingSession)

  return {
    ...state,
    sessions: nextSessions,
  }
}

export function reorderAssistantSessionShells(
  state: AssistantSessionListState,
  draggingSessionId: string,
  targetSessionId: string,
): AssistantSessionListState {
  if (draggingSessionId === targetSessionId) {
    return state
  }

  const draggingIndex = state.sessions.findIndex((sessionEntry) => sessionEntry.sessionId === draggingSessionId)
  const targetIndex = state.sessions.findIndex((sessionEntry) => sessionEntry.sessionId === targetSessionId)

  if (draggingIndex === -1 || targetIndex === -1) {
    return state
  }

  const nextIndex = draggingIndex < targetIndex ? targetIndex - 1 : targetIndex
  return moveAssistantSessionShellToIndex(state, draggingSessionId, nextIndex)
}

export function resolveActiveAssistantSessionShell(
  state: AssistantSessionListState,
): AssistantSessionShell | null {
  if (state.activeSessionId === null) {
    return null
  }

  return state.sessions.find((sessionEntry) => sessionEntry.sessionId === state.activeSessionId) ?? null
}

function isCopilotConnectableState(
  state: CopilotBootstrapController['state'],
): state is CopilotConnectableState {
  return state.status === 'ready' || state.status === 'degraded'
}

function formatAssistantWorkspaceError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function computeAssistantSessionPreviewIndex(listElement: HTMLUListElement, clientY: number): number {
  const orderedItems = Array.from(
    listElement.querySelectorAll<HTMLElement>('[data-session-order-index]'),
  )
  let nextPreviewIndex = orderedItems.length

  for (const orderedItem of orderedItems) {
    const itemIndex = Number(orderedItem.dataset.sessionOrderIndex)
    if (Number.isNaN(itemIndex)) {
      continue
    }

    const { top, height } = orderedItem.getBoundingClientRect()
    if (clientY < top + (height / 2)) {
      nextPreviewIndex = itemIndex
      break
    }
  }

  return nextPreviewIndex
}
