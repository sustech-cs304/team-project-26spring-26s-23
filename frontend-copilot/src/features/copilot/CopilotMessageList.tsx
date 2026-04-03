import type { CopilotMessageListItem } from './run-segment-view-model'

interface CopilotMessageListProps {
  conversation: CopilotMessageListItem[]
  showDiagnostics?: boolean
  emptyState?: {
    title: string
    description: string
  } | null
}
 
export function CopilotMessageList({
  conversation,
  showDiagnostics = true,
  emptyState = null,
}: CopilotMessageListProps) {
  const visibleConversation = showDiagnostics
    ? conversation
    : conversation.filter((turn) => turn.kind !== 'diagnostic')

  return (
    <div
      className="copilot-chat__stream copilot-chat__stream--scrollbarless"
      data-testid="chat-message-scroll-region"
      data-scrollbar-visibility="hidden"
    >
      {visibleConversation.length === 0
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
        : visibleConversation.map((turn, index) => {
            const detailRows = buildDetailRows(turn)
            return (
              <article
                key={turn.id}
                className={[
                  'copilot-chat__message',
                  `copilot-chat__message--${turn.kind}`,
                  turn.status ? `copilot-chat__message--${turn.status}` : '',
                ].filter((className) => className !== '').join(' ')}
                data-testid={`chat-message-${turn.kind}-${index}`}
              >
                {turn.kind !== 'user' && (
                  <div className="copilot-chat__message-header">
                    <p className="copilot-chat__message-label">{turn.title}</p>
                    {turn.status !== undefined && (
                      <span className={`copilot-chat__message-status copilot-chat__message-status--${turn.status}`}>
                        {formatTurnStatus(turn.status)}
                      </span>
                    )}
                  </div>
                )}
                <p className="copilot-chat__message-text">{turn.content}</p>
                {detailRows.length > 0 && (
                  <div className="copilot-chat__message-detail-list">
                    {detailRows.map((detail) => (
                      <p
                        key={`${turn.id}:${detail.label}`}
                        className={[
                          'copilot-chat__message-detail',
                          `copilot-chat__message-detail--${detail.kind}`,
                        ].join(' ')}
                      >
                        <span className="copilot-chat__message-detail-label">{detail.label}</span>
                        <span>{detail.value}</span>
                      </p>
                    ))}
                  </div>
                )}
                {turn.kind === 'diagnostic' && (
                  <p className="copilot-chat__message-diagnostic" data-testid={`chat-message-diagnostic-${turn.id}`}>
                    诊断：{turn.diagnostic.stage} / {turn.diagnostic.code} / {turn.diagnostic.message}
                  </p>
                )}
              </article>
            )
          })}
    </div>
  )
}

function formatTurnStatus(status: 'streaming' | 'completed' | 'failed' | 'cancelled'): string {
  switch (status) {
    case 'streaming':
      return '流式输出中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
  }
}

function buildDetailRows(turn: CopilotMessageListItem): Array<{
  kind: 'input' | 'result' | 'error' | 'meta'
  label: string
  value: string
}> {
  switch (turn.kind) {
    case 'tool':
      return buildToolDetailRows(turn)
    case 'diagnostic':
      return [
        {
          kind: 'meta',
          label: '阶段',
          value: turn.diagnostic.stage,
        },
        {
          kind: 'meta',
          label: '代码',
          value: turn.diagnostic.code,
        },
      ]
    case 'terminal':
      return turn.terminalPhase === 'failed' && turn.failure !== null
        ? [{
            kind: 'error',
            label: '代码',
            value: turn.failure.code,
          }]
        : []
    case 'assistant':
    case 'user':
      return []
  }
}

function buildToolDetailRows(turn: Extract<CopilotMessageListItem, { kind: 'tool' }>): Array<{
  kind: 'input' | 'result' | 'error'
  label: string
  value: string
}> {
  const details: Array<{
    kind: 'input' | 'result' | 'error'
    label: string
    value: string
  }> = []

  if (turn.inputSummary !== null && turn.inputSummary !== undefined && turn.inputSummary !== '') {
    details.push({
      kind: 'input',
      label: '输入',
      value: turn.inputSummary,
    })
  }
  if (turn.resultSummary !== null && turn.resultSummary !== undefined && turn.resultSummary !== '' && turn.resultSummary !== turn.content) {
    details.push({
      kind: 'result',
      label: '结果',
      value: turn.resultSummary,
    })
  }
  if (turn.errorSummary !== null && turn.errorSummary !== undefined && turn.errorSummary !== '') {
    details.push({
      kind: 'error',
      label: '错误',
      value: turn.errorSummary,
    })
  }

  return details
}
