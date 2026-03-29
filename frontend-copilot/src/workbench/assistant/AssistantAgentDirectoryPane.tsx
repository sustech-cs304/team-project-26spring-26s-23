import type { AgentType } from '../types'
import type { AssistantAgentDirectoryState } from './assistant-workspace-controller'

interface AssistantAgentDirectoryPaneProps {
  directoryState: AssistantAgentDirectoryState
  selectedAgent: AgentType | null
  onSelectAgent: (agentId: string) => void
}

export function AssistantAgentDirectoryPane({
  directoryState,
  selectedAgent,
  onSelectAgent,
}: AssistantAgentDirectoryPaneProps) {
  return (
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
                onClick={() => onSelectAgent(agent.id)}
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
  )
}
