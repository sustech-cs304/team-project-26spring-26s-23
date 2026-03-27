import { useEffect, useMemo, useState } from 'react'

import {
  createRuntimeSession,
  listRuntimeAgents,
  type RuntimeAgentsListResponse,
  type RuntimeSessionCreateResponse,
} from '../../features/copilot/chat-contract'
import { CopilotChatPanel } from '../../features/copilot/CopilotChatPanel'
import type { CopilotBootstrapController, CopilotConnectableState } from '../../features/copilot/types'
import { enhanceRuntimeAgents, pickDefaultAgentId } from '../config'
import type { AgentType, AssistantSessionShell } from '../types'

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

interface AssistantWorkspaceProps {
  bootstrap: CopilotBootstrapController
  listAgents?: typeof listRuntimeAgents
  createSession?: typeof createRuntimeSession
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
  const [sessionShell, setSessionShell] = useState<AssistantSessionShell | null>(initialSessionShell)
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

  const handleCreateSession = async () => {
    if (!isCopilotConnectableState(bootstrap.state) || selectedAgent === null || sessionStatus === 'creating') {
      return
    }

    setSessionStatus('creating')
    setSessionError(null)

    try {
      const response = await createSessionImpl({
        runtimeUrl: bootstrap.state.runtimeUrl,
        agentId: selectedAgent.id,
      })
      setSessionShell(createAssistantSessionShell({
        response,
        selectedAgent,
      }))
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
                    <span className="assistant-card__meta">{agent.description}</span>
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

        <div className="copilot-panel__details-block">
          <p className="copilot-panel__details-heading">当前入口语义</p>
          <ul className="copilot-panel__list">
            <li>智能体目录以服务端 [`agents/list`](backend/app/copilot_runtime/contracts.py:14) 为真源。</li>
            <li>创建会话时绑定智能体，并持有 `sessionId + boundAgent`。</li>
            <li>本阶段不再回落到旧全局 agent/provider 消息路径。</li>
          </ul>
        </div>

        {sessionShell !== null && (
          <div className="copilot-panel__details-block" data-testid="assistant-session-shell-summary">
            <p className="copilot-panel__details-heading">当前会话绑定</p>
            <ul className="copilot-panel__list">
              <li>
                <strong>Session ID：</strong>
                {sessionShell.sessionId}
              </li>
              <li>
                <strong>Bound Agent：</strong>
                {sessionShell.boundAgent.label}
              </li>
              <li>
                <strong>创建时间：</strong>
                {sessionShell.createdAt}
              </li>
            </ul>
          </div>
        )}

        {sessionError !== null && (
          <p className="panel-head__description" role="alert">{sessionError}</p>
        )}
      </aside>

      <main className="workspace-main" aria-label="会话主内容区">
        <section className="workspace-chat-shell">
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
        </section>
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

export function createAssistantSessionShell(input: {
  response: RuntimeSessionCreateResponse
  selectedAgent: AgentType
}): AssistantSessionShell {
  return {
    sessionId: input.response.sessionId,
    boundAgent: input.selectedAgent,
    createdAt: input.response.createdAt,
    updatedAt: input.response.updatedAt,
    recommendedTools: [...input.response.recommendedTools],
    defaultModelPreference: input.response.defaultModelPreference,
  }
}

function isCopilotConnectableState(
  state: CopilotBootstrapController['state'],
): state is CopilotConnectableState {
  return state.status === 'ready' || state.status === 'degraded'
}

function formatAssistantWorkspaceError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
