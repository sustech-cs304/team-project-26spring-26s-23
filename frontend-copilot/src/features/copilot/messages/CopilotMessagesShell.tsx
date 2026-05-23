import { useEffect, useMemo, useRef, useState } from 'react'

import { ANIM, useStaggerListEnter } from '../../../workbench/animation-utils'
import { getCopilotChatCopy } from '../../../workbench/locale'
import { ModelPickerIcon } from '../components/ModelPicker'
import type { CopilotTransientErrorState } from '../copilot-chat-helpers'
import type { CopilotErrorDetailSource } from '../error-detail-overlay-view-model'
import {
  createEmptyCopilotModel,
  createFallbackCopilotModel,
  resolveCopilotModelOption,
  type CopilotModelOption,
} from '../model-picker'
import {
  type CopilotAssistantMessageItem,
  type CopilotAssistantPlaceholderState,
  type CopilotMessageListItem,
} from '../run-segment-view-model'

import { InlineFormMessageCard } from './inline-form-message-card'
import { ToolMessageCard } from './tool-message-card'
import { ReasoningMessageCard } from './reasoning-message-card'
import {
  createRenderedAssistantPlaceholderState,
  renderAssistantPlaceholder,
  type RenderedAssistantPlaceholderState,
} from './assistant-placeholder'

import { renderAssistantMarkdownMessageBody } from './assistant-markdown'

const assistantPlaceholderExitMs = ANIM.DURATION_SLOW

export interface CopilotMessagesShellProps {
  language?: string
  sessionId?: string | null
  messageSurfaceVisible?: boolean
  conversation: CopilotMessageListItem[]
  assistantPlaceholder?: CopilotAssistantPlaceholderState | null
  models?: CopilotModelOption[]
  transientError?: CopilotTransientErrorState | null
  runtimeUrl?: string | null
  onSubmitInlineForm?: ((input: {
    toolCallId: string
    formId: string
    summary: string
    structuredPayload: Record<string, unknown>
    values: Record<string, string | number | boolean>
  }) => Promise<void>) | null
  onResolveToolApproval?: ((input: {
    runId: string
    toolCallId: string
    decision: 'approved' | 'rejected'
  }) => Promise<void>) | null
  onOpenErrorDetail?: ((errorDetail: CopilotErrorDetailSource, trigger: HTMLButtonElement | null) => void) | null
  emptyState?: {
    title: string
    description: string
  } | null
}

export function CopilotMessagesShell({
  language = 'zh-CN',
  sessionId = null,
  messageSurfaceVisible = true,
  conversation,
  assistantPlaceholder = null,
  models = [],
  transientError = null,
  runtimeUrl = null,
  onSubmitInlineForm = null,
  onResolveToolApproval = null,
  onOpenErrorDetail = null,
  emptyState = null,
}: CopilotMessagesShellProps) {
  const copy = getCopilotChatCopy(language)
  const messageListRef = useRef<HTMLDivElement>(null)
  const bottomAnchorRef = useRef<HTMLDivElement>(null)
  const visibleConversation = useMemo(
    () => buildVisibleConversation({
      conversation,
      transientError,
    }),
    [conversation, transientError],
  )
  const latestVisibleMessage = visibleConversation[visibleConversation.length - 1]
  const latestVisibleMessageId = latestVisibleMessage?.id ?? null
  useStaggerListEnter({
    scope: messageListRef,
    selector: '.copilot-chat__message',
    itemCount: visibleConversation.length,
  })
  const renderedAssistantPlaceholder = useAssistantPlaceholderState(assistantPlaceholder)

  useEffect(() => {
    if (!messageSurfaceVisible || visibleConversation.length === 0) {
      return
    }

    const bottomAnchor = bottomAnchorRef.current
    if (typeof bottomAnchor?.scrollIntoView !== 'function') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      bottomAnchor.scrollIntoView({ block: 'end' })
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [messageSurfaceVisible, sessionId, latestVisibleMessageId, visibleConversation.length])

  return (
    <div
      className="copilot-chat__stream copilot-chat__stream--scrollbarless"
      ref={messageListRef}
      data-testid="chat-message-scroll-region"
      data-scrollbar-visibility="hidden"
    >
      {visibleConversation.length === 0 && !renderedAssistantPlaceholder.visible
        ? (
            <div
              className="copilot-chat__empty copilot-panel__enter"
              data-testid={emptyState === null ? 'chat-empty-state' : 'chat-no-model-empty-state'}
            >
              <p className="copilot-chat__empty-title">{emptyState?.title ?? copy.messages.emptyStateTitle}</p>
              {emptyState !== null && (
                <p className="copilot-chat__empty-description">{emptyState.description}</p>
              )}
            </div>
          )
        : visibleConversation.map((turn, index) => (
            <MessageListItem
              key={turn.id}
              turn={turn}
              index={index}
              models={models}
              language={language}
              runtimeUrl={runtimeUrl}
              onSubmitInlineForm={onSubmitInlineForm}
              onResolveToolApproval={onResolveToolApproval}
              onOpenErrorDetail={onOpenErrorDetail}
            />
          ))}
      {renderedAssistantPlaceholder.visible && renderAssistantPlaceholder(renderedAssistantPlaceholder)}
      <div ref={bottomAnchorRef} aria-hidden="true" data-testid="chat-message-scroll-anchor" />
    </div>
  )
}

function useAssistantPlaceholderState(
  assistantPlaceholder: CopilotAssistantPlaceholderState | null | undefined,
): RenderedAssistantPlaceholderState {
  const [renderedAssistantPlaceholder, setRenderedAssistantPlaceholder] = useState<RenderedAssistantPlaceholderState>(
    () => createRenderedAssistantPlaceholderState(assistantPlaceholder ?? null),
  )

  useEffect(() => {
    if (assistantPlaceholder?.shouldRender === true) {
      setRenderedAssistantPlaceholder((current) => (
        current.visible && !current.fading && current.dismissReason === null
          ? current
          : {
              visible: true,
              fading: false,
              dismissReason: null,
            }
      ))
      return
    }

    if (!renderedAssistantPlaceholder.visible) {
      return
    }

    const dismissReason = assistantPlaceholder?.dismissReason ?? 'inactive'
    if (dismissReason !== 'assistant') {
      setRenderedAssistantPlaceholder({
        visible: false,
        fading: false,
        dismissReason,
      })
      return
    }

    if (
      !renderedAssistantPlaceholder.fading
      || renderedAssistantPlaceholder.dismissReason !== dismissReason
    ) {
      setRenderedAssistantPlaceholder({
        visible: true,
        fading: true,
        dismissReason,
      })
    }

    const timeoutId = window.setTimeout(() => {
      setRenderedAssistantPlaceholder({
        visible: false,
        fading: false,
        dismissReason,
      })
    }, assistantPlaceholderExitMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    assistantPlaceholder?.dismissReason,
    assistantPlaceholder?.shouldRender,
    renderedAssistantPlaceholder.dismissReason,
    renderedAssistantPlaceholder.fading,
    renderedAssistantPlaceholder.visible,
  ])

  return renderedAssistantPlaceholder
}

function MessageListItem({
  turn,
  index,
  models,
  language,
  runtimeUrl,
  onSubmitInlineForm,
  onResolveToolApproval,
  onOpenErrorDetail,
}: {
  turn: CopilotMessageListItem
  index: number
  models: CopilotModelOption[]
  language: string
  runtimeUrl: string | null
  onSubmitInlineForm: CopilotMessagesShellProps['onSubmitInlineForm']
  onResolveToolApproval: CopilotMessagesShellProps['onResolveToolApproval']
  onOpenErrorDetail: CopilotMessagesShellProps['onOpenErrorDetail']
}) {
  const detailRows = buildDetailRows()
  return (
    <article
      className={[
        'copilot-chat__message',
        `copilot-chat__message--${turn.kind}`,
        turn.status ? `copilot-chat__message--${turn.status}` : '',
      ].filter((className) => className !== '').join(' ')}
      data-testid={`chat-message-${turn.kind}-${index}`}
    >
      {turn.kind === 'inline-form'
        ? (
            <InlineFormMessageCard
              turn={turn}
              index={index}
              onSubmitInlineForm={onSubmitInlineForm ?? null}
            />
          )
        : turn.kind === 'tool'
        ? (
            <ToolMessageCard
              turn={turn}
              index={index}
              runtimeUrl={runtimeUrl}
              onResolveToolApproval={onResolveToolApproval}
              onOpenErrorDetail={onOpenErrorDetail}
              language={language}
            />
          )
        : turn.kind === 'reasoning'
          ? (
              <ReasoningMessageCard turn={turn} index={index} language={language} />
            )
          : (
              <>
                {turn.kind !== 'user' && renderMessageHeader(turn, index, { models, onOpenErrorDetail: onOpenErrorDetail ?? null, language })}
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
              </>
            )}
    </article>
  )
}

function buildVisibleConversation(input: {
  conversation: CopilotMessageListItem[]
  transientError: CopilotTransientErrorState | null
}): CopilotMessageListItem[] {
  const filteredConversation = input.conversation.filter((turn) => turn.kind !== 'diagnostic')
  const transientMessage = input.transientError?.message.trim() ?? ''

  if (transientMessage === '') {
    return filteredConversation
  }

  return [
    ...filteredConversation,
    createTransientErrorMessage(input.transientError!, filteredConversation.length + 1),
  ]
}

function createTransientErrorMessage(
  transientError: CopilotTransientErrorState,
  sequence: number,
): Extract<CopilotMessageListItem, { kind: 'terminal' }> {
  return {
    id: `transient-error:${sequence}`,
    kind: 'terminal',
    runId: 'transient-error',
    sequence,
    title: '发送失败',
    content: transientError.message,
    status: 'failed',
    terminalPhase: 'failed',
    cancelReason: null,
    failure: null,
    resolvedModelId: transientError.errorDetail?.resolvedModelId ?? null,
    resolvedModelRoute: transientError.errorDetail?.resolvedModelRoute ?? null,
    resolvedToolIds: [...(transientError.errorDetail?.resolvedToolIds ?? [])],
    requestOptions: { ...(transientError.errorDetail?.requestOptions ?? {}) },
    errorDetail: transientError.errorDetail,
  }
}

interface RenderMessageHeaderContext {
  models: CopilotModelOption[]
  onOpenErrorDetail: ((errorDetail: CopilotErrorDetailSource, trigger: HTMLButtonElement | null) => void) | null
  language: string
}

function renderMessageHeader(
  turn: Exclude<CopilotMessageListItem, { kind: 'user' }>,
  index: number,
  context: RenderMessageHeaderContext,
) {
  const { models, onOpenErrorDetail, language } = context
  const copy = getCopilotChatCopy(language)
  const errorDetail = resolveMessageErrorDetailSource(turn)

  if (turn.kind !== 'assistant') {
    return (
      <div className="copilot-chat__message-header">
        <p className="copilot-chat__message-label">{turn.title}</p>
        {errorDetail !== null && (
          <div className="copilot-chat__message-actions">
            <button
              type="button"
              className="icon-button copilot-chat__message-detail-trigger"
              aria-label={copy.messages.errorDetailButton}
              aria-haspopup="dialog"
              title={copy.messages.errorDetailButton}
              data-testid={`chat-message-error-detail-button-${index}`}
              disabled={onOpenErrorDetail === null}
              onClick={(event) => {
                onOpenErrorDetail?.(errorDetail, event.currentTarget)
              }}
            >
              <span aria-hidden="true">ⓘ</span>
            </button>
          </div>
        )}
      </div>
    )
  }

  const assistantHeader = resolveAssistantMessageHeader(turn, models, language)

  return (
    <div className="copilot-chat__message-header">
      <p
        className="copilot-chat__message-label copilot-chat__message-label--assistant"
        data-testid={`chat-message-assistant-label-${index}`}
      >
        <span className="copilot-chat__message-model-icon" data-testid={`chat-message-assistant-icon-${index}`}>
          <ModelPickerIcon icon={assistantHeader.icon} title={assistantHeader.name} language={language} />
        </span>
        <span className="copilot-chat__message-model-name">{assistantHeader.name}</span>
      </p>
    </div>
  )
}

function resolveMessageErrorDetailSource(
  turn: Exclude<CopilotMessageListItem, { kind: 'user' }>,
): CopilotErrorDetailSource | null {
  if (turn.kind !== 'terminal' || turn.status !== 'failed') {
    return null
  }

  return turn.errorDetail ?? null
}

function resolveAssistantMessageHeader(
  turn: CopilotAssistantMessageItem,
  models: CopilotModelOption[],
  language: string,
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
    readModelIdFromRoute(turn.resolvedModelRoute),
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
    name: getCopilotChatCopy(language).messages.assistantResponse,
    icon: createEmptyCopilotModel().icon,
  }
}

function readModelIdFromRoute(
  route: CopilotAssistantMessageItem['resolvedModelRoute'],
): string | null {
  if (route === null || route === undefined) {
    return null
  }

  return 'providerId' in route ? route.modelId : route.routeRef?.modelId ?? null
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
    return renderAssistantMarkdownMessageBody(turn.content)
  }

  if (turn.kind === 'user') {
    return <p className="copilot-chat__message-text copilot-chat__message-text--plain">{turn.content}</p>
  }

  return <p className="copilot-chat__message-text">{turn.content}</p>
}

function buildDetailRows(): Array<{
  kind: 'input' | 'result' | 'error' | 'meta'
  label: string
  value: string
}> {
  return []
}
