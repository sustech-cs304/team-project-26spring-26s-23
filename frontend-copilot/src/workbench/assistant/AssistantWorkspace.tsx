import { useEffect, useMemo, useState } from 'react'

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

  const handleCreateSession = async () => {
    if (!isCopilotConnectableState(bootstrap.state) || selectedAgent === null || sessionStatus === 'creating') {
      return
    }

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
          onClick={() => {
            void handleCreateSession()
          }}
          disabled={!isCopilotConnectableState(bootstrap.state) || selectedAgent === null || sessionStatus === 'creating'}
        >
          <span>＋</span>
          <span>{sessionStatus === 'creating' ? '正在创建会话…' : createSessionLabel}</span>
        </button>

        {sessionListState.sessions.length > 0 && (
          <ul className="topic-list topic-list--detailed" data-testid="assistant-session-list">
            {sessionListState.sessions.map((sessionEntry) => {
              const active = sessionEntry.sessionId === sessionListState.activeSessionId

              return (
                <li key={sessionEntry.sessionId}>
                  <button
                    type="button"
                    className={`topic-card${active ? ' topic-card--active' : ''}`}
                    onClick={() => {
                      setSessionListState((current) => ({
                        ...current,
                        activeSessionId: sessionEntry.sessionId,
                      }))
                      setSelectedAgentId(sessionEntry.boundAgent.id)
                    }}
                  >
                    <span className="topic-card__title">{sessionEntry.boundAgent.label}</span>
                    <span className="topic-card__meta">
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
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
    sessions: [...remainingSessions, nextSessionShell],
    activeSessionId: nextSessionShell.sessionId,
  }
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
