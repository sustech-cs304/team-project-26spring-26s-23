import type { CopilotConversationTurn } from './copilot-chat-helpers'

interface CopilotMessageListProps {
  conversation: CopilotConversationTurn[]
  emptyState?: {
    title: string
    description: string
  } | null
}

export function CopilotMessageList({ conversation, emptyState = null }: CopilotMessageListProps) {
  return (
    <div
      className="copilot-chat__stream copilot-chat__stream--scrollbarless"
      data-testid="chat-message-scroll-region"
      data-scrollbar-visibility="hidden"
    >
      {conversation.length === 0
        ? (
            <div
              className="copilot-chat__empty"
              data-testid={emptyState === null ? 'chat-empty-state' : 'chat-no-model-empty-state'}
            >
              <p className="copilot-chat__empty-title">{emptyState?.title ?? '当前尚未发送消息'}</p>
              {emptyState !== null && (
                <p className="copilot-chat__empty-description">{emptyState.description}</p>
              )}
            </div>
          )
        : conversation.map((turn) => (
            <article
              key={turn.id}
              className={`copilot-chat__message copilot-chat__message--${turn.kind}`}
            >
              {turn.kind !== 'user' && <p className="copilot-chat__message-label">{turn.title}</p>}
              <p className="copilot-chat__message-text">{turn.content}</p>
            </article>
          ))}
    </div>
  )
}
