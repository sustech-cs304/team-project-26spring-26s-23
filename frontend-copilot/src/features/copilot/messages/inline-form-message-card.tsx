import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardList } from 'lucide-react'

import {
  buildInlineFormSubmissionPayload,
  buildInlineFormSubmissionSummary,
  formatInlineFormValue,
  validateInlineFormValues,
  type CopilotInlineFormDraftValues,
} from '../inline-form'
import type { CopilotInlineFormMessageItem } from '../run-segment-view-model'
import type { RuntimeInlineFormFieldOption } from '../thread-run-contract'
import { useGSAP, gsap } from '../../../workbench/animation-utils'

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
      <InlineFormHeader turn={turn} statusText={statusText} />
      <div className="copilot-chat__inline-form-panel" data-testid={`chat-message-inline-form-panel-${index}`}>
        <p className="copilot-chat__inline-form-description">{turn.content}</p>
        {helperDescription !== null && <p className="copilot-chat__inline-form-description copilot-chat__inline-form-description--secondary">{helperDescription}</p>}
        {turn.fields.map((field) => (
          <InlineFormField
            key={field.name}
            field={field}
            turnId={turn.id}
            index={index}
            value={draftValues[field.name] ?? (field.type === 'checkbox' ? false : '')}
            submittedValue={formatInlineFormValue(turn.formValues[field.name])}
            readOnly={readOnly}
            error={errors[field.name]}
            onValueChange={(nextValue) => {
              setDraftValues((current) => ({ ...current, [field.name]: nextValue }))
            }}
          />
        ))}
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

function InlineFormHeader({
  turn,
  statusText,
}: {
  turn: CopilotInlineFormMessageItem
  statusText: string
}) {
  return (
    <div className="copilot-chat__inline-form-header">
      <div className="copilot-chat__inline-form-header-copy">
        <span className="copilot-chat__step-icon copilot-chat__step-icon--form" aria-hidden="true">
          <ClipboardList size={14} strokeWidth={2.2} />
        </span>
        <div className="copilot-chat__inline-form-heading-copy">
          <p className="copilot-chat__inline-form-eyebrow">需要你补充信息</p>
          <p className="copilot-chat__inline-form-title">{turn.title}</p>
        </div>
      </div>
      <span className={`copilot-chat__inline-form-status copilot-chat__inline-form-status--${turn.formState}`}>{statusText}</span>
    </div>
  )
}

function InlineFormField({
  field,
  turnId,
  index,
  value,
  submittedValue,
  readOnly,
  error,
  onValueChange,
}: {
  field: CopilotInlineFormMessageItem['fields'][number]
  turnId: string
  index: number
  value: string | number | boolean
  submittedValue: string
  readOnly: boolean
  error: string | undefined
  onValueChange: (value: string | boolean) => void
}) {
  const fieldId = `chat-inline-form-${turnId}-${field.name}`

  return (
    <div
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
      {!readOnly && renderInlineFormControl({ field, fieldId, value, readOnly, onValueChange })}
      {readOnly && (
        <div className="copilot-chat__inline-form-readonly" data-testid={`chat-message-inline-form-value-${field.name}-${index}`}>{submittedValue}</div>
      )}
      {error !== undefined && (
        <span className="copilot-chat__inline-form-error" data-testid={`chat-message-inline-form-error-${field.name}-${index}`}>{error}</span>
      )}
    </div>
  )
}

function renderInlineFormControl({
  field,
  fieldId,
  value,
  readOnly,
  onValueChange,
}: {
  field: CopilotInlineFormMessageItem['fields'][number]
  fieldId: string
  value: string | number | boolean
  readOnly: boolean
  onValueChange: (value: string | boolean) => void
}) {
  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          id={fieldId}
          className="copilot-chat__inline-form-control copilot-chat__inline-form-control--textarea"
          value={typeof value === 'boolean' ? '' : value}
          placeholder={field.placeholder ?? ''}
          readOnly={readOnly}
          onChange={(event) => {
            onValueChange(event.currentTarget.value)
          }}
        />
      )
    case 'number':
      return (
        <input
          id={fieldId}
          className="copilot-chat__inline-form-control"
          type="number"
          value={typeof value === 'boolean' ? '' : value}
          placeholder={field.placeholder ?? ''}
          readOnly={readOnly}
          onChange={(event) => {
            onValueChange(event.currentTarget.value)
          }}
        />
      )
    case 'select':
      return (
        <InlineFormSelectControl
          id={fieldId}
          value={typeof value === 'boolean' || typeof value === 'number' ? String(value) : value}
          disabled={readOnly}
          placeholder="请选择"
          options={field.options ?? []}
          onChange={(nextValue) => {
            onValueChange(nextValue)
          }}
        />
      )
    case 'checkbox':
      return (
        <InlineFormCheckboxControl
          fieldId={fieldId}
          checked={value === true}
          disabled={readOnly}
          placeholder={field.placeholder ?? '确认此项'}
          onChange={(nextChecked) => {
            onValueChange(nextChecked)
          }}
        />
      )
    default:
      return (
        <input
          id={fieldId}
          className="copilot-chat__inline-form-control"
          type="text"
          value={typeof value === 'boolean' ? '' : value}
          placeholder={field.placeholder ?? ''}
          readOnly={readOnly}
          onChange={(event) => {
            onValueChange(event.currentTarget.value)
          }}
        />
      )
  }
}

function InlineFormCheckboxControl({
  fieldId,
  checked,
  disabled,
  placeholder,
  onChange,
}: {
  fieldId: string
  checked: boolean
  disabled: boolean
  placeholder: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className={[
        'copilot-chat__inline-form-checkbox',
        checked ? 'copilot-chat__inline-form-checkbox--checked' : '',
        disabled ? 'copilot-chat__inline-form-checkbox--readonly' : '',
      ].filter((className) => className !== '').join(' ')}
      htmlFor={fieldId}
    >
      <input
        id={fieldId}
        className="copilot-chat__inline-form-checkbox-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.checked)
        }}
      />
      <span className="copilot-chat__inline-form-checkbox-box" aria-hidden="true">
        <span className="copilot-chat__inline-form-checkbox-checkmark" />
      </span>
      <span className="copilot-chat__inline-form-checkbox-body">
        <span className="copilot-chat__inline-form-checkbox-copy">{placeholder}</span>
      </span>
    </label>
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
  const popoverRef = useRef<HTMLDivElement>(null)
  const [renderPopover, setRenderPopover] = useState(false)
  const [open, setOpen] = useState(false)
  const selectedLabel = options.find((option) => option.value === value)?.label ?? null

  useGSAP(() => {
    if (!popoverRef.current) return
    if (open) {
      gsap.from(popoverRef.current, { scale: 0.85, opacity: 0, duration: 0.2, ease: 'back.out(1.7)' })
    } else {
      gsap.to(popoverRef.current, { scale: 0.85, opacity: 0, duration: 0.14, ease: 'power3.in', onComplete: () => setRenderPopover(false) })
    }
  }, { dependencies: [open], revertOnUpdate: true })

  const closePopover = useCallback(() => {
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return
      }
      closePopover()
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePopover()
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [open, closePopover])

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
          if (!open) {
            setRenderPopover(true)
            setOpen(true)
          } else {
            closePopover()
          }
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
      {renderPopover && (
        <div className="copilot-chat__inline-form-select-popover" ref={popoverRef} role="listbox" aria-labelledby={id}>
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
              closePopover()
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
                closePopover()
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
