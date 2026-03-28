import type { CopilotConversationTurn } from './copilot-chat-helpers'

interface CopilotMessageListProps {
  conversation: CopilotConversationTurn[]
}

export function CopilotMessageList({ conversation }: CopilotMessageListProps) {
  return (
    <div
      className="copilot-chat__stream copilot-chat__stream--scrollbarless"
      data-testid="chat-message-scroll-region"
      data-scrollbar-visibility="hidden"
    >
      {conversation.length === 0
        ? (
            <div className="copilot-chat__empty">
              <p className="copilot-chat__empty-title">当前尚未发送消息</p>
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
