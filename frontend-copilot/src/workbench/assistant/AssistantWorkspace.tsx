import { useEffect, useMemo, useState } from 'react'

import { CopilotChatPanel } from '../../features/copilot/CopilotChatPanel'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import { agentTypes, conversationsByAgent } from '../config'
import type { AgentTypeId } from '../types'

console.info('[startup]', JSON.stringify({
  scope: 'AssistantWorkspace',
  stage: 'module-evaluated',
  t: Math.round(performance.now()),
}))

interface AssistantWorkspaceProps {
  bootstrap: CopilotBootstrapController
}


export function AssistantWorkspace({ bootstrap }: AssistantWorkspaceProps) {
  const [activeAgentType, setActiveAgentType] = useState<AgentTypeId>('general')
  const [activeConversationId, setActiveConversationId] = useState<string>(
    conversationsByAgent.general[0]?.id ?? '',
  )

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

  const activeAgent = useMemo(
    () => agentTypes.find((item) => item.id === activeAgentType) ?? agentTypes[0],
    [activeAgentType],
  )

  const currentConversations = useMemo(
    () => conversationsByAgent[activeAgentType],
    [activeAgentType],
  )

  const activeConversation = useMemo(
    () =>
      currentConversations.find((item) => item.id === activeConversationId) ?? currentConversations[0],
    [activeConversationId, currentConversations],
  )

  const handleSelectAgent = (agentId: AgentTypeId) => {
    setActiveAgentType(agentId)
    setActiveConversationId(conversationsByAgent[agentId][0]?.id ?? '')
  }

  return (
    <section className="workspace-stage conversation-workspace" aria-label="助手工作区">
      <aside className="workspace-panel assistant-panel" aria-label="助手类型列">
        <header className="panel-head">
          <p className="panel-head__eyebrow">助手</p>
          <h1 className="panel-head__title">固定智能体类型</h1>
        </header>

        <ul className="assistant-list">
          {agentTypes.map((agent) => {
            const Icon = agent.icon
            const active = agent.id === activeAgentType

            return (
              <li key={agent.id}>
                <button
                  type="button"
                  className={`assistant-card${active ? ' assistant-card--active' : ''}`}
                  onClick={() => handleSelectAgent(agent.id)}
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

      <aside className="workspace-panel topic-panel" aria-label="话题列">
        <header className="panel-head">
          <p className="panel-head__eyebrow">话题</p>
          <h2 className="panel-head__title">{activeAgent.label}</h2>
        </header>

        <button type="button" className="new-thread-button">
          <span>＋</span>
          <span>新建话题</span>
        </button>

        <ul className="topic-list topic-list--detailed">
          {currentConversations.map((conversation) => {
            const active = conversation.id === activeConversation?.id

            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  className={`topic-card${active ? ' topic-card--active' : ''}`}
                  onClick={() => setActiveConversationId(conversation.id)}
                >
                  <span className="topic-card__title">{conversation.title}</span>
                  <span className="topic-card__meta">{conversation.updatedAt}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <main className="workspace-main" aria-label="会话主内容区">
        <section className="workspace-chat-shell">
          <CopilotChatPanel
            state={bootstrap.state}
            retrying={bootstrap.retrying}
            retry={bootstrap.retry}
          />
        </section>
      </main>
    </section>
  )
}

