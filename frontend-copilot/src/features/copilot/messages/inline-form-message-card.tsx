import { useCallback, useEffect, useRef, useState } from 'react'

import {
  buildInlineFormSubmissionPayload,
  buildInlineFormSubmissionSummary,
  formatInlineFormValue,
  validateInlineFormValues,
  type CopilotInlineFormDraftValues,
} from '../inline-form'
import type { CopilotInlineFormMessageItem } from '../run-segment-view-model'
import type { RuntimeInlineFormFieldOption } from '../thread-run-contract'

interface InlineFormMessageCardProps {
  turn: CopilotInlineFormMessageItem
  index: number
  onSubmitInlineForm: ((input: {
    toolCallId: string
    formId: string
    summary: string
    structuredPayload: Record<string, unknown>
    values: Record<string, string | number | boolean>
  }) => Promise<void>) | null
}

export function InlineFormMessageCard({
  turn,
  index,
  onSubmitInlineForm,
}: InlineFormMessageCardProps) {
  const latestTurnRef = useRef(turn)
  latestTurnRef.current = turn
  const formResetKey = buildInlineFormResetKey(turn)
  const [draftValues, setDraftValues] = useState<CopilotInlineFormDraftValues>(() => buildInlineFormDraftValues(turn.formValues))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const currentTurn = latestTurnRef.current
    setDraftValues(buildInlineFormDraftValues(currentTurn.formValues))
    setErrors({})
    setSubmitError(null)
    setSubmitting(false)
  }, [formResetKey])

  const readOnly = turn.formState !== 'pending'
  const helperDescription = turn.description !== null && turn.description !== turn.content
    ? turn.description
    : null
  const statusText = turn.formState === 'submitted'
    ? '已提交'
    : turn.formState === 'expired'
      ? '已过期'
      : '填写后继续'

  const handleSubmit = useCallback(async () => {
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
  }, [turn, draftValues, onSubmitInlineForm])

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

function buildInlineFormDraftValues(
  formValues: Record<string, string | number | boolean>,
): CopilotInlineFormDraftValues {
  const initialValues: CopilotInlineFormDraftValues = {}
  for (const [key, value] of Object.entries(formValues)) {
    initialValues[key] = typeof value === 'boolean' ? value : String(value)
  }
  return initialValues
}

function buildInlineFormResetKey(turn: CopilotInlineFormMessageItem): string {
  return [turn.id, turn.toolCallId, turn.formId, turn.formState].join('\u0000')
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
