import { useEffect, useMemo, useState } from 'react'

import { CopilotChatPanel } from '../../features/copilot/CopilotChatPanel'
import type { CopilotBootstrapController, CopilotBootstrapState } from '../../features/copilot/types'
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

const conversationStatusLabels = {
  active: '进行中',
  attention: '需关注',
  idle: '已归档',
} satisfies Record<'active' | 'attention' | 'idle', string>

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
          <p className="panel-head__subtitle">按智能体能力域组织，不与具体会话混用。</p>
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
                    <span className="assistant-card__meta">{agent.shortLabel}</span>
                    <span className="assistant-card__description">{agent.description}</span>
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
          <p className="panel-head__subtitle">展示当前智能体类型下的会话与主题切换。</p>
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
                  <span className="topic-card__summary">{conversation.summary}</span>
                  <span className="topic-card__meta">
                    <span>{conversation.updatedAt}</span>
                    <span className={`status-pill status-pill--${conversation.status}`}>
                      {conversationStatusLabels[conversation.status]}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <main className="workspace-main" aria-label="会话主内容区">
        <header className="workspace-main__header">
          <div>
            <p className="workspace-main__eyebrow">当前会话</p>
            <h2 className="workspace-main__title">{activeConversation?.title ?? '未选择话题'}</h2>
            <p className="workspace-main__subtitle">
              {activeAgent.label} · {activeConversation?.updatedAt ?? '等待选择话题'}
            </p>
          </div>
          <span className="workspace-badge">{activeAgent.shortLabel}</span>
        </header>

        <section className="workspace-hero">
          <div className="workspace-hero__copy">
            <p className="workspace-hero__eyebrow">工作区摘要</p>
            <h3 className="workspace-hero__title">已切换到 {activeAgent.label} 工作区</h3>
            <p className="workspace-hero__text">
              根层已先完成运行态装配与 retry 收口；当前助手工作区只消费上层解析好的 Copilot 状态，不再自行读取配置或运行时。
            </p>
          </div>

          <div className="workspace-facts">
            <article className="workspace-fact">
              <span>当前智能体</span>
              <strong>{activeAgent.description}</strong>
            </article>
            <article className="workspace-fact">
              <span>会话数量</span>
              <strong>{currentConversations.length} 个主题会话</strong>
            </article>
            <article className="workspace-fact">
              <span>根层 Copilot 状态</span>
              <strong>{describeBootstrapStatus(bootstrap.state)}</strong>
            </article>
          </div>
        </section>

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

function describeBootstrapStatus(state: CopilotBootstrapState): string {
  switch (state.status) {
    case 'loading':
      return '根层仍在读取启动状态'
    case 'starting':
      return '宿主后端正在启动'
    case 'ready':
      return '宿主管理运行时已就绪'
    case 'degraded':
      return '运行时降级但仍保留连接地址'
    case 'failed':
      return '宿主启动失败，可从面板发起重试'
    case 'empty':
      return '尚无运行时与 Agent 配置'
    case 'incomplete':
      return '运行时信息仍不完整'
    case 'error':
      return '根层读取运行态失败'
  }
}
