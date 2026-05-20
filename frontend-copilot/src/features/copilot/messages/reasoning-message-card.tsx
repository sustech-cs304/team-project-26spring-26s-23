import { useEffect, useRef, useState } from 'react'
import { Lightbulb } from 'lucide-react'

import { gsap, useGSAP } from '../../../workbench/animation-utils'
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
  const [renderPanel, setRenderPanel] = useState(expanded)
  const [observedNow, setObservedNow] = useState(() => turn.observedFinishedAt ?? Date.now())
  const panelId = `chat-message-reasoning-panel-${turn.id}`
  const panelRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLSpanElement>(null)

  useGSAP(() => {
    const panel = panelRef.current
    if (!panel) return

    gsap.killTweensOf(panel)

    if (expanded && renderPanel) {
      gsap.fromTo(panel,
        { height: 0, opacity: 0 },
        {
          height: 'auto',
          opacity: 1,
          duration: 0.22,
          ease: 'power3.out',
          onComplete: () => {
            if (panelRef.current) {
              gsap.set(panelRef.current, { clearProps: 'height' })
            }
          },
        },
      )
      return
    }

    if (!expanded && renderPanel) {
      gsap.to(panel, {
        height: 0,
        opacity: 0,
        duration: 0.15,
        ease: 'power3.in',
        onComplete: () => {
          setRenderPanel(false)
          if (panelRef.current) {
            gsap.set(panelRef.current, { clearProps: 'height' })
          }
        },
      })
    }
  }, { dependencies: [expanded, renderPanel] })

  useGSAP(() => {
    if (!cursorRef.current) return
    gsap.to(cursorRef.current, { opacity: 0, duration: 0.5, repeat: -1, yoyo: true, ease: 'steps(1)' })
  }, { scope: cursorRef })

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
                if (expanded) {
                  setExpanded(false)
                } else {
                  setRenderPanel(true)
                  setExpanded(true)
                }
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
                  <span ref={cursorRef} className="copilot-chat__streaming-cursor">|</span>
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
                if (expanded) {
                  setExpanded(false)
                } else {
                  setRenderPanel(true)
                  setExpanded(true)
                }
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
                  <span ref={cursorRef} className="copilot-chat__streaming-cursor">|</span>
                </span>
              )}
            </button>
          )}
      {renderPanel && (
        <div ref={panelRef} className="copilot-chat__reasoning-panel" id={panelId} data-testid={`chat-message-reasoning-panel-${index}`}>
          {renderAssistantMarkdownMessageBody(turn.content)}
        </div>
      )}
    </div>
  )
}
