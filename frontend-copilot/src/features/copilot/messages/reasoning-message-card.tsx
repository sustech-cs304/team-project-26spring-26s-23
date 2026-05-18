import { useEffect, useState } from 'react'
import { Lightbulb } from 'lucide-react'

import { getCopilotChatCopy } from '../../../workbench/locale'
import { formatCopilotReasoningDurationLabel, type CopilotReasoningMessageItem } from '../run-segment-view-model'

import { renderAssistantMarkdownMessageBody } from './assistant-markdown'

const reasoningTimerRefreshMs = 100

interface ReasoningMessageCardProps {
  turn: CopilotReasoningMessageItem
  index: number
  language: string
}

export function ReasoningMessageCard({
  turn,
  index,
  language,
}: ReasoningMessageCardProps) {
  const copy = getCopilotChatCopy(language)
  const [expanded, setExpanded] = useState(turn.isCollapsedByDefault !== true)
  const [observedNow, setObservedNow] = useState(() => turn.observedFinishedAt ?? Date.now())
  const panelId = `chat-message-reasoning-panel-${turn.id}`

  useEffect(() => {
    setObservedNow(turn.observedFinishedAt ?? Date.now())
  }, [turn.observedFinishedAt, turn.observedStartedAt])

  useEffect(() => {
    if (turn.observedFinishedAt !== null || turn.status !== 'streaming') {
      return
    }

    const intervalId = window.setInterval(() => {
      setObservedNow(Date.now())
    }, reasoningTimerRefreshMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [turn.observedFinishedAt, turn.status])

  const reasoningTitle = formatCopilotReasoningDurationLabel(turn, observedNow)

  return (
    <div className="copilot-chat__reasoning-card" data-testid={`chat-message-reasoning-card-${index}`}>
      {expanded
        ? (
            <button
              type="button"
              className="copilot-chat__reasoning-toggle"
              aria-controls={panelId}
              aria-expanded="true"
              data-expanded="true"
              data-testid={`chat-message-reasoning-toggle-${index}`}
              onClick={() => {
                setExpanded((current) => !current)
              }}
            >
              <span className="copilot-chat__reasoning-toggle-main">
                <span className="copilot-chat__step-icon copilot-chat__step-icon--reasoning" aria-hidden="true">
                  <Lightbulb size={14} strokeWidth={2.2} />
                </span>
                <span className="copilot-chat__reasoning-toggle-icon" aria-hidden="true">▾</span>
                <span className="copilot-chat__message-label">{reasoningTitle}</span>
              </span>
              {turn.status === 'streaming' && (
                <span className="copilot-chat__reasoning-status" data-testid={`chat-message-reasoning-status-${index}`}>
                  {copy.messages.reasoningGenerating}
                </span>
              )}
            </button>
          )
        : (
            <button
              type="button"
              className="copilot-chat__reasoning-toggle"
              aria-controls={panelId}
              aria-expanded="false"
              data-expanded="false"
              data-testid={`chat-message-reasoning-toggle-${index}`}
              onClick={() => {
                setExpanded((current) => !current)
              }}
            >
              <span className="copilot-chat__reasoning-toggle-main">
                <span className="copilot-chat__step-icon copilot-chat__step-icon--reasoning" aria-hidden="true">
                  <Lightbulb size={14} strokeWidth={2.2} />
                </span>
                <span className="copilot-chat__reasoning-toggle-icon" aria-hidden="true">▸</span>
                <span className="copilot-chat__message-label">{reasoningTitle}</span>
              </span>
              {turn.status === 'streaming' && (
                <span className="copilot-chat__reasoning-status" data-testid={`chat-message-reasoning-status-${index}`}>
                  {copy.messages.reasoningGenerating}
                </span>
              )}
            </button>
          )}
      {expanded && (
        <div className="copilot-chat__reasoning-panel" id={panelId} data-testid={`chat-message-reasoning-panel-${index}`}>
          {renderAssistantMarkdownMessageBody(turn.content)}
        </div>
      )}
    </div>
  )
}
