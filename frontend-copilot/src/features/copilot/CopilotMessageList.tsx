import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeMathjax from 'rehype-mathjax/svg'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { ModelPickerIcon } from './components/ModelPicker'
import {
  createEmptyCopilotModel,
  createFallbackCopilotModel,
  resolveCopilotModelOption,
  type CopilotModelOption,
} from './model-picker'
import type {
  CopilotAssistantMessageItem,
  CopilotMessageListItem,
} from './run-segment-view-model'

const assistantMarkdownComponents: Components = {
  hr({ node: _node, className, ...props }) {
    return (
      <hr
        {...props}
        className={[
          'copilot-chat__markdown-divider',
          className,
        ].filter((value) => value !== undefined && value !== '').join(' ')}
      />
    )
  },
}

const assistantMarkdownRemarkPlugins = [remarkGfm, remarkMath]
const assistantMarkdownRehypePlugins = [rehypeMathjax]

interface CopilotMessageListProps {
  conversation: CopilotMessageListItem[]
  models?: CopilotModelOption[]
  showDiagnostics?: boolean
  emptyState?: {
    title: string
    description: string
  } | null
}
 
export function CopilotMessageList({
  conversation,
  models = [],
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
                {turn.kind !== 'user' && renderMessageHeader(turn, index, models)}
                {renderMessageBody(turn)}
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

function renderMessageHeader(
  turn: Exclude<CopilotMessageListItem, { kind: 'user' }>,
  index: number,
  models: CopilotModelOption[],
) {
  if (turn.kind !== 'assistant') {
    return (
      <div className="copilot-chat__message-header">
        <p className="copilot-chat__message-label">{turn.title}</p>
      </div>
    )
  }

  const assistantHeader = resolveAssistantMessageHeader(turn, models)

  return (
    <div className="copilot-chat__message-header">
      <p
        className="copilot-chat__message-label copilot-chat__message-label--assistant"
        data-testid={`chat-message-assistant-label-${index}`}
      >
        <span className="copilot-chat__message-model-icon" data-testid={`chat-message-assistant-icon-${index}`}>
          <ModelPickerIcon icon={assistantHeader.icon} title={assistantHeader.name} />
        </span>
        <span className="copilot-chat__message-model-name">{assistantHeader.name}</span>
      </p>
    </div>
  )
}

function resolveAssistantMessageHeader(
  turn: CopilotAssistantMessageItem,
  models: CopilotModelOption[],
): {
  name: string
  icon: CopilotModelOption['icon']
} {
  const resolvedModel = resolveCopilotModelOption({
    models,
    resolvedModelId: turn.resolvedModelId,
    resolvedModelRoute: turn.resolvedModelRoute,
  })
  if (resolvedModel !== null) {
    return {
      name: resolvedModel.name,
      icon: resolvedModel.icon,
    }
  }

  const resolvedModelId = findFirstNonEmptyValue(
    turn.resolvedModelId,
    turn.resolvedModelRoute?.snapshot.modelId,
  )
  if (resolvedModelId !== null) {
    const fallbackModel = createFallbackCopilotModel(resolvedModelId)
    return {
      name: fallbackModel.name,
      icon: fallbackModel.icon,
    }
  }

  const fallbackTitle = findFirstNonEmptyValue(turn.title)
  if (fallbackTitle !== null) {
    return {
      name: fallbackTitle,
      icon: createEmptyCopilotModel().icon,
    }
  }

  return {
    name: '助手响应',
    icon: createEmptyCopilotModel().icon,
  }
}

function findFirstNonEmptyValue(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmedValue = value?.trim() ?? ''
    if (trimmedValue !== '') {
      return trimmedValue
    }
  }

  return null
}

function renderMessageBody(turn: CopilotMessageListItem) {
  if (turn.kind === 'assistant') {
    return (
      <div className="copilot-chat__message-text copilot-chat__message-text--markdown">
        <ReactMarkdown
          components={assistantMarkdownComponents}
          remarkPlugins={assistantMarkdownRemarkPlugins}
          rehypePlugins={assistantMarkdownRehypePlugins}
        >
          {turn.content}
        </ReactMarkdown>
      </div>
    )
  }

  if (turn.kind === 'user') {
    return <p className="copilot-chat__message-text copilot-chat__message-text--plain">{turn.content}</p>
  }

  return <p className="copilot-chat__message-text">{turn.content}</p>
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
