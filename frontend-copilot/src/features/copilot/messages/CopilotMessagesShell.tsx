import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeMathjax from 'rehype-mathjax/svg'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { getCopilotChatCopy } from '../../../workbench/locale'
import {
  CONTROLLED_INLINE_FORM_TOOL_ID,
  buildInlineFormSubmissionPayload,
  buildInlineFormSubmissionSummary,
  formatInlineFormValue,
  validateInlineFormValues,
  type CopilotInlineFormDraftValues,
} from '../inline-form'
import { ModelPickerIcon } from '../components/ModelPicker'
import type { CopilotTransientErrorState } from '../copilot-chat-helpers'
import type { CopilotErrorDetailSource } from '../error-detail-overlay-view-model'
import {
  createEmptyCopilotModel,
  createFallbackCopilotModel,
  resolveCopilotModelOption,
  type CopilotModelOption,
} from '../model-picker'
import { resolveCopilotToolDisplayNameFromToolId } from '../tool-presentation'
import {
  formatCopilotReasoningDurationLabel,
  type CopilotAssistantMessageItem,
  type CopilotAssistantPlaceholderState,
  type CopilotInlineFormMessageItem,
  type CopilotMessageListItem,
  type CopilotReasoningMessageItem,
  type CopilotToolMessageItem,
} from '../run-segment-view-model'
import type { RuntimeInlineFormFieldOption } from '../thread-run-contract'

const assistantMarkdownComponents: Components = {
  hr({ className, ...props }) {
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

const assistantPlaceholderExitMs = 180
const reasoningTimerRefreshMs = 100

interface JsonViewComponentProps {
  src: unknown
  collapsed?: boolean | number
  displaySize?: boolean | number | 'collapsed' | 'expanded'
  enableClipboard?: boolean
  theme?: 'default' | 'a11y' | 'github' | 'vscode' | 'atom' | 'winter-is-coming' | 'vitesse'
}

type JsonViewComponent = ComponentType<JsonViewComponentProps>

export interface CopilotMessagesShellProps {
  language?: string
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

interface RenderedAssistantPlaceholderState {
  visible: boolean
  fading: boolean
  dismissReason: CopilotAssistantPlaceholderState['dismissReason']
}

export function CopilotMessagesShell({
  language = 'zh-CN',
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
  const visibleConversation = useMemo(
    () => buildVisibleConversation({
      conversation,
      transientError,
    }),
    [conversation, transientError],
  )
  const [renderedAssistantPlaceholder, setRenderedAssistantPlaceholder] = useState<RenderedAssistantPlaceholderState>(
    () => createRenderedAssistantPlaceholderState(assistantPlaceholder),
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

  return (
    <div
      className="copilot-chat__stream copilot-chat__stream--scrollbarless"
      data-testid="chat-message-scroll-region"
      data-scrollbar-visibility="hidden"
    >
      {visibleConversation.length === 0 && !renderedAssistantPlaceholder.visible
        ? (
            <div
              className="copilot-chat__empty"
              data-testid={emptyState === null ? 'chat-empty-state' : 'chat-no-model-empty-state'}
            >
              <p className="copilot-chat__empty-title">{emptyState?.title ?? copy.messages.emptyStateTitle}</p>
              {emptyState !== null && (
                <p className="copilot-chat__empty-description">{emptyState.description}</p>
              )}
            </div>
          )
        : visibleConversation.map((turn, index) => {
            const detailRows = buildDetailRows()
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
                {turn.kind === 'inline-form'
                  ? (
                      <InlineFormMessageCard
                        turn={turn}
                        index={index}
                        onSubmitInlineForm={onSubmitInlineForm}
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
                          {turn.kind !== 'user' && renderMessageHeader(turn, index, models, onOpenErrorDetail, language)}
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
          })}
      {renderedAssistantPlaceholder.visible && renderAssistantPlaceholder(renderedAssistantPlaceholder)}
    </div>
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

function InlineFormMessageCard({
  turn,
  index,
  onSubmitInlineForm,
}: {
  turn: CopilotInlineFormMessageItem
  index: number
  onSubmitInlineForm: CopilotMessagesShellProps['onSubmitInlineForm']
}) {
  const [draftValues, setDraftValues] = useState<CopilotInlineFormDraftValues>(() => {
    const initialValues: CopilotInlineFormDraftValues = {}
    for (const [key, value] of Object.entries(turn.formValues)) {
      initialValues[key] = typeof value === 'boolean' ? value : String(value)
    }
    return initialValues
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const initialValues: CopilotInlineFormDraftValues = {}
    for (const [key, value] of Object.entries(turn.formValues)) {
      initialValues[key] = typeof value === 'boolean' ? value : String(value)
    }
    setDraftValues(initialValues)
    setErrors({})
    setSubmitError(null)
    setSubmitting(false)
  }, [turn.formState, turn.formValues, turn.id])

  const readOnly = turn.formState !== 'pending'
  const helperDescription = turn.description !== null && turn.description !== turn.content
    ? turn.description
    : null
  const statusText = turn.formState === 'submitted'
    ? '已提交'
    : turn.formState === 'expired'
      ? '已过期'
      : '填写后继续'

  const handleSubmit = async () => {
    const validation = validateInlineFormValues({
      fields: turn.fields,
      values: draftValues,
    })
    setErrors(validation.errors)
    if (!validation.isValid || onSubmitInlineForm == null) {
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      await onSubmitInlineForm({
        toolCallId: turn.toolCallId,
        formId: turn.formId,
        summary: buildInlineFormSubmissionSummary({
          request: {
            title: turn.title,
            fields: turn.fields,
          },
          values: validation.values,
        }),
        structuredPayload: {
          ...buildInlineFormSubmissionPayload({
            toolId: turn.toolId,
            toolCallId: turn.toolCallId,
            formId: turn.formId,
            values: validation.values,
          }),
        },
        values: validation.values,
      })
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '表单提交失败。')
      setSubmitting(false)
    }
  }

  return (
    <div className="copilot-chat__inline-form-card" data-testid={`chat-message-inline-form-card-${index}`}>
      <div className="copilot-chat__inline-form-header">
        <div className="copilot-chat__inline-form-header-copy">
          <p className="copilot-chat__inline-form-eyebrow">需要你补充信息</p>
          <p className="copilot-chat__inline-form-title">{turn.title}</p>
        </div>
        <span className={`copilot-chat__inline-form-status copilot-chat__inline-form-status--${turn.formState}`}>{statusText}</span>
      </div>
      <div className="copilot-chat__inline-form-panel" data-testid={`chat-message-inline-form-panel-${index}`}>
        <p className="copilot-chat__inline-form-description">{turn.content}</p>
        {helperDescription !== null && <p className="copilot-chat__inline-form-description copilot-chat__inline-form-description--secondary">{helperDescription}</p>}
        {turn.fields.map((field) => {
          const fieldId = `chat-inline-form-${turn.id}-${field.name}`
          const value = draftValues[field.name] ?? (field.type === 'checkbox' ? false : '')
          const submittedValue = formatInlineFormValue(turn.formValues[field.name])
          return (
            <div
              key={field.name}
              className={`copilot-chat__inline-form-field copilot-chat__inline-form-field--${field.type}`}
              data-testid={`chat-message-inline-form-field-${field.name}-${index}`}
            >
              <div className="copilot-chat__inline-form-field-header">
                <label className="copilot-chat__inline-form-label" htmlFor={fieldId}>{field.label}</label>
                {field.required === true && <span className="copilot-chat__inline-form-required">必填</span>}
              </div>
              {field.description !== undefined && field.description.trim() !== '' && (
                <p className="copilot-chat__inline-form-field-description">{field.description}</p>
              )}
              {!readOnly && (field.type === 'textarea'
                ? (
                    <textarea
                      id={fieldId}
                      className="copilot-chat__inline-form-control copilot-chat__inline-form-control--textarea"
                      value={typeof value === 'boolean' ? '' : value}
                      placeholder={field.placeholder ?? ''}
                      readOnly={readOnly}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value
                        setDraftValues((current) => ({ ...current, [field.name]: nextValue }))
                      }}
                    />
                  )
                : field.type === 'number'
                  ? (
                      <input
                        id={fieldId}
                        className="copilot-chat__inline-form-control"
                        type="number"
                        value={typeof value === 'boolean' ? '' : value}
                        placeholder={field.placeholder ?? ''}
                        readOnly={readOnly}
                        onChange={(event) => {
                          const nextValue = event.currentTarget.value
                          setDraftValues((current) => ({ ...current, [field.name]: nextValue }))
                        }}
                      />
                    )
                  : field.type === 'select'
                    ? (
                        <InlineFormSelectControl
                          id={fieldId}
                          value={typeof value === 'boolean' ? '' : value}
                          disabled={readOnly}
                          placeholder="请选择"
                          options={field.options ?? []}
                          onChange={(nextValue) => {
                            setDraftValues((current) => ({ ...current, [field.name]: nextValue }))
                          }}
                        />
                      )
                    : field.type === 'checkbox'
                      ? (
                          <label
                            className={[
                              'copilot-chat__inline-form-checkbox',
                              value === true ? 'copilot-chat__inline-form-checkbox--checked' : '',
                              readOnly ? 'copilot-chat__inline-form-checkbox--readonly' : '',
                            ].filter((className) => className !== '').join(' ')}
                            htmlFor={fieldId}
                          >
                            <input
                              id={fieldId}
                              className="copilot-chat__inline-form-checkbox-input"
                              type="checkbox"
                              checked={value === true}
                              disabled={readOnly}
                              onChange={(event) => {
                                const nextChecked = event.currentTarget.checked
                                setDraftValues((current) => ({ ...current, [field.name]: nextChecked }))
                              }}
                            />
                            <span className="copilot-chat__inline-form-checkbox-box" aria-hidden="true">
                              <span className="copilot-chat__inline-form-checkbox-checkmark" />
                            </span>
                            <span className="copilot-chat__inline-form-checkbox-body">
                              <span className="copilot-chat__inline-form-checkbox-copy">{field.placeholder ?? '确认此项'}</span>
                            </span>
                          </label>
                        )
                      : (
                          <input
                            id={fieldId}
                            className="copilot-chat__inline-form-control"
                            type="text"
                            value={typeof value === 'boolean' ? '' : value}
                            placeholder={field.placeholder ?? ''}
                            readOnly={readOnly}
                            onChange={(event) => {
                              const nextValue = event.currentTarget.value
                              setDraftValues((current) => ({ ...current, [field.name]: nextValue }))
                            }}
                          />
                        ))}
              {readOnly && (
                <div className="copilot-chat__inline-form-readonly" data-testid={`chat-message-inline-form-value-${field.name}-${index}`}>{submittedValue}</div>
              )}
              {errors[field.name] !== undefined && (
                <span className="copilot-chat__inline-form-error" data-testid={`chat-message-inline-form-error-${field.name}-${index}`}>{errors[field.name]}</span>
              )}
            </div>
          )
        })}
        {turn.formState === 'expired' && (
          <p className="copilot-chat__inline-form-notice copilot-chat__inline-form-notice--expired" data-testid={`chat-message-inline-form-expired-${index}`}>该表单已过期，不能继续提交。</p>
        )}
        {submitError !== null && <p className="copilot-chat__inline-form-notice copilot-chat__inline-form-notice--error" data-testid={`chat-message-inline-form-submit-error-${index}`}>{submitError}</p>}
        {!readOnly && (
          <button
            type="button"
            className="copilot-chat__inline-form-submit"
            data-testid={`chat-message-inline-form-submit-${index}`}
            disabled={submitting || onSubmitInlineForm === null}
            onClick={() => {
              void handleSubmit()
            }}
          >
            {submitting ? '提交中…' : turn.submitLabel}
          </button>
        )}
      </div>
    </div>
  )
}

function InlineFormSelectControl({
  id,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  id: string
  value: string
  options: RuntimeInlineFormFieldOption[]
  placeholder: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const selectedLabel = options.find((option) => option.value === value)?.label ?? null

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return
      }
      setOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className={[
        'copilot-chat__inline-form-select',
        open ? 'copilot-chat__inline-form-select--open' : '',
        disabled ? 'copilot-chat__inline-form-select--disabled' : '',
      ].filter((className) => className !== '').join(' ')}
    >
      <button
        id={id}
        type="button"
        className="copilot-chat__inline-form-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return
          }
          setOpen((current) => !current)
        }}
      >
        <span
          className={[
            'copilot-chat__inline-form-select-value',
            selectedLabel === null ? 'copilot-chat__inline-form-select-value--placeholder' : '',
          ].filter((className) => className !== '').join(' ')}
        >
          {selectedLabel ?? placeholder}
        </span>
        <span className="copilot-chat__inline-form-select-icon" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="copilot-chat__inline-form-select-popover" role="listbox" aria-labelledby={id}>
          <button
            type="button"
            className={[
              'copilot-chat__inline-form-select-option',
              value === '' ? 'copilot-chat__inline-form-select-option--selected' : '',
            ].filter((className) => className !== '').join(' ')}
            role="option"
            aria-selected={value === ''}
            onClick={() => {
              onChange('')
              setOpen(false)
            }}
          >
            {placeholder}
          </button>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={[
                'copilot-chat__inline-form-select-option',
                value === option.value ? 'copilot-chat__inline-form-select-option--selected' : '',
              ].filter((className) => className !== '').join(' ')}
              role="option"
              aria-selected={value === option.value}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function renderMessageHeader(
  turn: Exclude<CopilotMessageListItem, { kind: 'user' }>,
  index: number,
  models: CopilotModelOption[],
  onOpenErrorDetail: ((errorDetail: CopilotErrorDetailSource, trigger: HTMLButtonElement | null) => void) | null,
  language: string,
) {
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
  if (turn.kind === 'tool') {
    return turn.errorDetail ?? null
  }

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

function renderMarkdownMessageBody(content: string) {
  return (
    <div className="copilot-chat__message-text copilot-chat__message-text--markdown">
      <ReactMarkdown
        components={assistantMarkdownComponents}
        remarkPlugins={assistantMarkdownRemarkPlugins}
        rehypePlugins={assistantMarkdownRehypePlugins}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function renderMessageBody(turn: CopilotMessageListItem) {
  if (turn.kind === 'assistant') {
    return renderMarkdownMessageBody(turn.content)
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

function ReasoningMessageCard({
  turn,
  index,
  language,
}: {
  turn: CopilotReasoningMessageItem
  index: number
  language: string
}) {
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
          {renderMarkdownMessageBody(turn.content)}
        </div>
      )}
    </div>
  )
}

function ToolMessageCard({
  turn,
  index,
  runtimeUrl,
  onResolveToolApproval,
  onOpenErrorDetail,
  language,
}: {
  turn: CopilotToolMessageItem
  index: number
  runtimeUrl: string | null
  onResolveToolApproval?: CopilotMessagesShellProps['onResolveToolApproval']
  onOpenErrorDetail?: CopilotMessagesShellProps['onOpenErrorDetail']
  language: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [inputExpanded, setInputExpanded] = useState(false)
  const [approvalPendingDecision, setApprovalPendingDecision] = useState<'approved' | 'rejected' | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [countdownNow, setCountdownNow] = useState(() => Date.now())
  const contentSections = buildToolContentSections(turn)
  const inputSummary = hasNonEmptyValue(turn.inputSummary) ? turn.inputSummary : null
  const panelId = `chat-message-tool-panel-${turn.id}`
  const inputPanelId = `chat-message-tool-input-panel-${turn.id}`
  const approval = turn.approval ?? null
  const errorDetail = resolveMessageErrorDetailSource(turn)
  const copy = getCopilotChatCopy(language)
  const timeoutSecondsLabel = approval === null ? null : formatToolApprovalTimeoutSecondsLabel(approval, countdownNow)
  const showApprovalActions = turn.toolPhase === 'waiting_approval'
  const approvalControlsEnabled = runtimeUrl !== null && typeof onResolveToolApproval === 'function' && approvalPendingDecision === null

  useEffect(() => {
    if (turn.toolPhase !== 'waiting_approval' || approval?.timeoutAt === null || approval?.timeoutAt === undefined) {
      return
    }

    const intervalId = window.setInterval(() => {
      setCountdownNow(Date.now())
    }, 1_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [approval?.timeoutAt, turn.toolPhase])

  useEffect(() => {
    if (turn.toolPhase !== 'waiting_approval') {
      setApprovalPendingDecision(null)
      setApprovalError(null)
    }
  }, [turn.toolPhase])

  const handleResolveApproval = async (decision: 'approved' | 'rejected') => {
    if (turn.toolPhase !== 'waiting_approval' || typeof onResolveToolApproval !== 'function') {
      return
    }

    setApprovalPendingDecision(decision)
    setApprovalError(null)
    try {
      await onResolveToolApproval({
        runId: turn.runId,
        toolCallId: turn.toolCallId,
        decision,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '工具审批提交失败。'
      setApprovalError(message)
      setApprovalPendingDecision(null)
    }
  }

  return (
    <div className="copilot-chat__tool-card" data-testid={`chat-message-tool-card-${index}`}>
      {expanded
        ? (
            <div className="copilot-chat__tool-header-row">
              <button
                type="button"
                className="copilot-chat__tool-toggle"
                aria-controls={panelId}
                aria-expanded="true"
                data-expanded="true"
                data-testid={`chat-message-tool-toggle-${index}`}
                onClick={() => {
                  setExpanded((current) => !current)
                }}
              >
                <span className="copilot-chat__tool-toggle-main">
                  <span className="copilot-chat__tool-toggle-icon" aria-hidden="true">▾</span>
                  <span className="copilot-chat__message-label">{resolveToolCardTitle(turn)}</span>
                </span>
                {turn.status === 'streaming' && (
                  <span
                    className="copilot-chat__tool-spinner"
                    data-testid={`chat-message-tool-spinner-${index}`}
                    aria-label="工具调用进行中"
                  />
                )}
              </button>
              {renderToolErrorDetailButton({ turn, index, errorDetail, onOpenErrorDetail, copy })}
            </div>
          )
        : (
            <div className="copilot-chat__tool-header-row">
              <button
                type="button"
                className="copilot-chat__tool-toggle"
                aria-controls={panelId}
                aria-expanded="false"
                data-expanded="false"
                data-testid={`chat-message-tool-toggle-${index}`}
                onClick={() => {
                  setExpanded((current) => !current)
                }}
              >
                <span className="copilot-chat__tool-toggle-main">
                  <span className="copilot-chat__tool-toggle-icon" aria-hidden="true">▸</span>
                  <span className="copilot-chat__message-label">{resolveToolCardTitle(turn)}</span>
                </span>
                {turn.status === 'streaming' && (
                  <span
                    className="copilot-chat__tool-spinner"
                    data-testid={`chat-message-tool-spinner-${index}`}
                    aria-label="工具调用进行中"
                  />
                )}
              </button>
              {renderToolErrorDetailButton({ turn, index, errorDetail, onOpenErrorDetail, copy })}
            </div>
          )}
      {showApprovalActions && renderToolApprovalBar({
        turn,
        index,
        timeoutSecondsLabel,
        approvalPendingDecision,
        approvalControlsEnabled,
        approvalError,
        onApprove: () => {
          void handleResolveApproval('approved')
        },
        onReject: () => {
          void handleResolveApproval('rejected')
        },
      })}
      {expanded && (
        <div className="copilot-chat__tool-panel" id={panelId} data-testid={`chat-message-tool-panel-${index}`}>
          {contentSections.map((section, sectionIndex) => (
            <ToolContentSection
              key={`${turn.id}:${section.label}:${sectionIndex}`}
              label={section.label}
              value={section.value}
              kind={section.kind}
              testIdPrefix={sectionIndex === 0
                ? `chat-message-tool-output-${index}`
                : `chat-message-tool-extra-${index}-${sectionIndex}`}
            />
          ))}
          {inputSummary !== null && (
            <div className="copilot-chat__tool-nested">
              {inputExpanded
                ? (
                    <button
                      type="button"
                      className="copilot-chat__tool-nested-toggle"
                      aria-controls={inputPanelId}
                      aria-expanded="true"
                      data-expanded="true"
                      data-testid={`chat-message-tool-input-toggle-${index}`}
                      onClick={() => {
                        setInputExpanded((current) => !current)
                      }}
                    >
                      <span className="copilot-chat__tool-toggle-main">
                        <span className="copilot-chat__tool-toggle-icon" aria-hidden="true">▾</span>
                        <span className="copilot-chat__tool-section-label">输入</span>
                      </span>
                    </button>
                  )
                : (
                    <button
                      type="button"
                      className="copilot-chat__tool-nested-toggle"
                      aria-controls={inputPanelId}
                      aria-expanded="false"
                      data-expanded="false"
                      data-testid={`chat-message-tool-input-toggle-${index}`}
                      onClick={() => {
                        setInputExpanded((current) => !current)
                      }}
                    >
                      <span className="copilot-chat__tool-toggle-main">
                        <span className="copilot-chat__tool-toggle-icon" aria-hidden="true">▸</span>
                        <span className="copilot-chat__tool-section-label">输入</span>
                      </span>
                    </button>
                  )}
              {inputExpanded && (
                <div
                  className="copilot-chat__tool-nested-panel"
                  id={inputPanelId}
                  data-testid={`chat-message-tool-input-panel-${index}`}
                >
                  <ToolStructuredContent
                    value={inputSummary}
                    kind="input"
                    testIdPrefix={`chat-message-tool-input-${index}`}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToolContentSection({
  label,
  value,
  kind,
  testIdPrefix,
}: {
  label: string
  value: string
  kind: 'input' | 'result' | 'error'
  testIdPrefix: string
}) {
  return (
    <section className={[`copilot-chat__tool-section`, `copilot-chat__tool-section--${kind}`].join(' ')}>
      <p className="copilot-chat__tool-section-label">{label}</p>
      <ToolStructuredContent value={value} kind={kind} testIdPrefix={testIdPrefix} />
    </section>
  )
}

function ToolStructuredContent({
  value,
  kind,
  testIdPrefix,
}: {
  value: string
  kind: 'input' | 'result' | 'error'
  testIdPrefix: string
}) {
  const structuredValue = useMemo(() => parseStructuredToolValue(value), [value])
  const [jsonViewComponent, setJsonViewComponent] = useState<JsonViewComponent | null>(null)

  useEffect(() => {
    if (structuredValue.kind !== 'json' || typeof document === 'undefined') {
      return
    }

    let active = true

    void import('react18-json-view')
      .then((module) => {
        if (!active) {
          return
        }

        setJsonViewComponent(() => resolveJsonViewComponent(module))
      })
      .catch(() => {
        if (!active) {
          return
        }

        setJsonViewComponent(null)
      })

    return () => {
      active = false
    }
  }, [structuredValue.kind])

  if (structuredValue.kind === 'json') {
    const JsonViewComponent = jsonViewComponent
    return (
      <div
        className={[
          'copilot-chat__tool-json-viewer',
          `copilot-chat__tool-json-viewer--${kind}`,
        ].join(' ')}
        data-testid={`${testIdPrefix}-json`}
        data-json-viewer={JsonViewComponent === null ? 'fallback' : 'react18-json-view'}
      >
        {JsonViewComponent === null
          ? <ToolJsonFallback value={structuredValue.value} />
          : (
              <JsonViewComponent
                src={structuredValue.value}
                collapsed={false}
                displaySize="collapsed"
                enableClipboard={false}
                theme="vscode"
              />
            )}
      </div>
    )
  }

  return (
    <pre
      className={[
        'copilot-chat__tool-plain-text',
        `copilot-chat__tool-plain-text--${kind}`,
      ].join(' ')}
      data-testid={`${testIdPrefix}-text`}
    >
      {structuredValue.value}
    </pre>
  )
}

function buildToolContentSections(turn: CopilotToolMessageItem): Array<{
  label: string
  value: string
  kind: 'result' | 'error'
}> {
  const sections: Array<{
    label: string
    value: string
    kind: 'result' | 'error'
  }> = [{
    label: resolveToolPrimarySectionLabel(turn),
    value: turn.content,
    kind: turn.status === 'failed' ? 'error' : 'result',
  }]

  if (hasDistinctNonEmptyValue(turn.resultSummary, turn.content)) {
    sections.push({
      label: '结果摘要',
      value: turn.resultSummary,
      kind: 'result',
    })
  }

  if (hasDistinctNonEmptyValue(turn.errorSummary, turn.content)) {
    sections.push({
      label: '错误',
      value: turn.errorSummary,
      kind: 'error',
    })
  }

  return sections
}

function resolveToolPrimarySectionLabel(turn: CopilotToolMessageItem): string {
  switch (turn.status) {
    case 'streaming':
      return '当前状态'
    case 'failed':
      return '状态'
    case 'cancelled':
      return '当前状态'
    case 'completed':
      return '返回内容'
  }
}

function resolveToolCardTitle(turn: CopilotToolMessageItem): string {
  const displayNameFromTitle = extractToolDisplayNameFromTitle(turn.title)
  const displayName = displayNameFromTitle ?? resolveToolDisplayNameFromToolId(turn.toolId)

  if (turn.toolId === CONTROLLED_INLINE_FORM_TOOL_ID && turn.status === 'streaming') {
    return '工具等待中'
  }

  switch (turn.status) {
    case 'streaming':
      return displayName === null ? turn.title : `${displayName}调用中`
    case 'completed':
      return displayName === null ? turn.title : `${displayName}被调用`
    case 'cancelled':
      return displayName === null ? (findFirstNonEmptyValue(turn.title) ?? '工具调用已取消') : `${displayName}已取消`
    case 'failed':
      return displayNameFromTitle === null ? (findFirstNonEmptyValue(turn.title) ?? '工具调用失败') : `${displayNameFromTitle}调用失败`
  }
}

function extractToolDisplayNameFromTitle(title: string): string | null {
  const trimmedTitle = title.trim()
  if (trimmedTitle === '') {
    return null
  }

  const titlePatterns = [
    /^调用(.+?工具)$/,
    /^(.+?工具)已返回结果$/,
    /^(.+?工具)被调用$/,
    /^(.+?工具)调用中$/,
    /^(.+?工具)调用失败$/,
    /^(.+?工具)已取消$/,
  ]

  for (const pattern of titlePatterns) {
    const matched = trimmedTitle.match(pattern)
    const candidate = matched?.[1]?.trim() ?? ''
    if (candidate !== '') {
      return candidate
    }
  }

  return trimmedTitle.endsWith('工具') && trimmedTitle !== '工具' ? trimmedTitle : null
}

function resolveToolDisplayNameFromToolId(toolId: string): string | null {
  const normalizedToolId = toolId.trim()
  if (normalizedToolId === '') {
    return null
  }

  return resolveCopilotToolDisplayNameFromToolId(normalizedToolId)
}

function renderToolErrorDetailButton(input: {
  turn: CopilotToolMessageItem
  index: number
  errorDetail: CopilotErrorDetailSource | null
  onOpenErrorDetail?: CopilotMessagesShellProps['onOpenErrorDetail']
  copy: ReturnType<typeof getCopilotChatCopy>
}) {
  if (input.turn.status !== 'failed' || input.errorDetail === null) {
    return null
  }

  return (
    <button
      type="button"
      className="icon-button copilot-chat__message-detail-trigger copilot-chat__tool-detail-trigger"
      aria-label={input.copy.messages.errorDetailButton}
      aria-haspopup="dialog"
      title={input.copy.messages.errorDetailButton}
      data-testid={`chat-message-tool-error-detail-button-${input.index}`}
      disabled={input.onOpenErrorDetail == null}
      onClick={(event) => {
        if (input.errorDetail !== null) {
          input.onOpenErrorDetail?.(input.errorDetail, event.currentTarget)
        }
      }}
    >
      <span aria-hidden="true">ⓘ</span>
    </button>
  )
}

function hasNonEmptyValue(value: string | null | undefined): value is string {
  return (value?.trim() ?? '') !== ''
}

function renderToolApprovalBar(input: {
  turn: CopilotToolMessageItem
  index: number
  timeoutSecondsLabel: string | null
  approvalPendingDecision: 'approved' | 'rejected' | null
  approvalControlsEnabled: boolean
  approvalError: string | null
  onApprove: () => void
  onReject: () => void
}) {
  if (input.turn.toolPhase !== 'waiting_approval') {
    return null
  }

  return (
    <div className="copilot-chat__tool-approval" data-testid={`chat-message-tool-approval-${input.index}`}>
      {input.approvalPendingDecision === null && (
        <div className="copilot-chat__tool-approval-actions">
          <button
            type="button"
            className="copilot-chat__tool-approval-button copilot-chat__tool-approval-button--reject"
            data-testid={`chat-message-tool-approval-reject-${input.index}`}
            disabled={!input.approvalControlsEnabled}
            onClick={input.onReject}
          >
            {resolveToolApprovalActionLabel({
              action: 'reject',
              approval: input.turn.approval ?? null,
              timeoutSecondsLabel: input.timeoutSecondsLabel,
            })}
          </button>
          <button
            type="button"
            className="copilot-chat__tool-approval-button copilot-chat__tool-approval-button--approve"
            data-testid={`chat-message-tool-approval-approve-${input.index}`}
            disabled={!input.approvalControlsEnabled}
            onClick={input.onApprove}
          >
            {resolveToolApprovalActionLabel({
              action: 'approve',
              approval: input.turn.approval ?? null,
              timeoutSecondsLabel: input.timeoutSecondsLabel,
            })}
          </button>
        </div>
      )}
      {input.approvalError !== null && (
        <p className="copilot-chat__tool-approval-error" data-testid={`chat-message-tool-approval-error-${input.index}`}>
          {input.approvalError}
        </p>
      )}
    </div>
  )
}

function formatToolApprovalTimeoutSecondsLabel(
  approval: NonNullable<CopilotToolMessageItem['approval']>,
  observedNow: number,
): string | null {
  if (approval.timeoutAt === null || approval.timeoutAt === undefined) {
    return approval.timeoutSeconds === null || approval.timeoutSeconds === undefined
      ? null
      : `${Math.max(0, Math.ceil(approval.timeoutSeconds))}s`
  }

  const timeoutAt = Date.parse(approval.timeoutAt)
  if (Number.isNaN(timeoutAt)) {
    return approval.timeoutSeconds === null || approval.timeoutSeconds === undefined
      ? null
      : `${Math.max(0, Math.ceil(approval.timeoutSeconds))}s`
  }

  const secondsRemaining = Math.max(0, Math.ceil((timeoutAt - observedNow) / 1_000))
  return `${secondsRemaining}s`
}

function resolveToolApprovalActionLabel(input: {
  action: 'approve' | 'reject'
  approval: CopilotToolMessageItem['approval']
  timeoutSecondsLabel: string | null
}): string {
  const baseLabel = input.action === 'approve' ? '批准' : '拒绝'
  if (
    input.approval === null
    || input.approval === undefined
    || input.approval.mode !== 'delay'
    || input.timeoutSecondsLabel === null
    || input.approval.timeoutAction === null
  ) {
    return baseLabel
  }

  const timeoutMatchesAction = (input.action === 'approve' && input.approval.timeoutAction === 'approve')
    || (input.action === 'reject' && input.approval.timeoutAction === 'deny')
  return timeoutMatchesAction ? `${baseLabel}（${input.timeoutSecondsLabel}）` : baseLabel
}

function hasDistinctNonEmptyValue(
  value: string | null | undefined,
  comparedValue: string,
): value is string {
  if (!hasNonEmptyValue(value)) {
    return false
  }

  return value !== comparedValue
}

function parseStructuredToolValue(value: string):
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; value: string } {
  const trimmedValue = value.trim()
  if (trimmedValue === '') {
    return {
      kind: 'text',
      value,
    }
  }

  try {
    return {
      kind: 'json',
      value: JSON.parse(trimmedValue),
    }
  } catch {
    return {
      kind: 'text',
      value,
    }
  }
}

function ToolJsonFallback({ value }: { value: unknown }) {
  return (
    <pre className="copilot-chat__tool-plain-text copilot-chat__tool-plain-text--json-fallback">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function resolveJsonViewComponent(module: unknown): JsonViewComponent {
  if (typeof module === 'function') {
    return module as JsonViewComponent
  }

  if (typeof module === 'object' && module !== null && 'default' in module) {
    const defaultExport = (module as { default?: unknown }).default
    if (typeof defaultExport === 'function') {
      return defaultExport as JsonViewComponent
    }

    if (typeof defaultExport === 'object' && defaultExport !== null && 'default' in defaultExport) {
      const nestedDefaultExport = (defaultExport as { default?: unknown }).default
      if (typeof nestedDefaultExport === 'function') {
        return nestedDefaultExport as JsonViewComponent
      }
    }
  }

  throw new TypeError('Unsupported react18-json-view export shape.')
}

function createRenderedAssistantPlaceholderState(
  assistantPlaceholder: CopilotAssistantPlaceholderState | null,
): RenderedAssistantPlaceholderState {
  return {
    visible: assistantPlaceholder?.shouldRender === true,
    fading: false,
    dismissReason: null,
  }
}

function renderAssistantPlaceholder(state: RenderedAssistantPlaceholderState) {
  return (
    <article
      className={[
        'copilot-chat__message',
        'copilot-chat__message--assistant',
        'copilot-chat__message--placeholder',
        state.fading ? 'copilot-chat__message--placeholder-fading' : '',
      ].filter((className) => className !== '').join(' ')}
      data-testid="chat-assistant-placeholder"
      data-dismiss-reason={state.dismissReason ?? 'pending'}
      aria-live="polite"
    >
      <div className="copilot-chat__assistant-placeholder" data-testid="chat-assistant-placeholder-content">
        <span
          className="copilot-chat__assistant-placeholder-spinner"
          data-testid="chat-assistant-placeholder-spinner"
          aria-hidden="true"
        />
        <span className="copilot-chat__assistant-placeholder-text">助手正在准备响应…</span>
      </div>
    </article>
  )
}
