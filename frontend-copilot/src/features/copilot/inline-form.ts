import type {
  RuntimeInlineFormField,
  RuntimeInlineFormRequest,
} from './thread-run-contract'

export const CONTROLLED_INLINE_FORM_TOOL_ID = 'tool.request-user-form'
export const INLINE_FORM_AWAITING_INPUT_CODE = 'awaiting_user_input'

export type CopilotInlineFormDraftValue = string | boolean
export type CopilotInlineFormValue = string | number | boolean
export type CopilotInlineFormDraftValues = Record<string, CopilotInlineFormDraftValue>
export type CopilotInlineFormValues = Record<string, CopilotInlineFormValue>

export interface CopilotInlineFormSubmissionPayload {
  type: 'inline_form_submission'
  toolId: string
  toolCallId: string
  formId: string
  values: CopilotInlineFormValues
}

export interface CopilotInlineFormValidationResult {
  isValid: boolean
  errors: Record<string, string>
  values: CopilotInlineFormValues
}

export function isControlledInlineFormToolEvent(input: {
  toolId: string
  formRequest?: RuntimeInlineFormRequest
}): boolean {
  return input.toolId === CONTROLLED_INLINE_FORM_TOOL_ID && input.formRequest !== undefined
}

export function createDefaultInlineFormValues(
  fields: RuntimeInlineFormField[],
): CopilotInlineFormDraftValues {
  return Object.fromEntries(fields.map((field) => [field.name, field.type === 'checkbox' ? false : '']))
}

const FIELD_REQUIRED_MESSAGE = '此项为必填。'

export function validateInlineFormValues(input: {
  fields: RuntimeInlineFormField[]
  values: CopilotInlineFormDraftValues
}): CopilotInlineFormValidationResult {
  const errors: Record<string, string> = {}
  const values: CopilotInlineFormValues = {}

  for (const field of input.fields) {
    const rawValue = input.values[field.name]
    validateInlineFormField(field, rawValue, errors, values)
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    values,
  }
}

function validateInlineFormField(
  field: RuntimeInlineFormField,
  rawValue: CopilotInlineFormDraftValue | undefined,
  errors: Record<string, string>,
  values: CopilotInlineFormValues,
): void {
  switch (field.type) {
    case 'checkbox':
      validateCheckboxField(field, rawValue, errors, values)
      break
    case 'number':
      validateNumberField(field, rawValue, errors, values)
      break
    case 'select':
    case 'text':
    case 'textarea':
      validateTextLikeField(field, rawValue, errors, values)
      break
  }
}

function validateCheckboxField(
  field: RuntimeInlineFormField,
  rawValue: CopilotInlineFormDraftValue | undefined,
  errors: Record<string, string>,
  values: CopilotInlineFormValues,
): void {
  const value = rawValue === true
  if (field.required === true && !value) {
    errors[field.name] = '请确认此项。'
  }
  values[field.name] = value
}

function validateNumberField(
  field: RuntimeInlineFormField,
  rawValue: CopilotInlineFormDraftValue | undefined,
  errors: Record<string, string>,
  values: CopilotInlineFormValues,
): void {
  const normalized = typeof rawValue === 'string' ? rawValue.trim() : ''
  if (normalized === '') {
    if (field.required === true) {
      errors[field.name] = FIELD_REQUIRED_MESSAGE
    }
    values[field.name] = ''
    return
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    errors[field.name] = '请输入有效数字。'
    values[field.name] = normalized
    return
  }

  values[field.name] = parsed
}

function validateTextLikeField(
  field: RuntimeInlineFormField,
  rawValue: CopilotInlineFormDraftValue | undefined,
  errors: Record<string, string>,
  values: CopilotInlineFormValues,
): void {
  const normalized = typeof rawValue === 'string' ? rawValue.trim() : ''
  if (field.required === true && normalized === '') {
    errors[field.name] = FIELD_REQUIRED_MESSAGE
  }
  if (
    field.type === 'select'
    && normalized !== ''
    && Array.isArray(field.options)
    && !field.options.some((option) => option.value === normalized)
  ) {
    errors[field.name] = '请选择有效选项。'
  }
  values[field.name] = normalized
}

export function buildInlineFormSubmissionSummary(input: {
  request: Pick<RuntimeInlineFormRequest, 'title' | 'fields'>
  values: CopilotInlineFormValues
}): string {
  const lines = input.request.fields.map((field) => `${field.label}: ${formatInlineFormValue(input.values[field.name])}`)
  return [`已提交表单：${input.request.title}`, ...lines].join('\n')
}

export function buildInlineFormSubmissionPayload(input: {
  toolId: string
  toolCallId: string
  formId: string
  values: CopilotInlineFormValues
}): CopilotInlineFormSubmissionPayload {
  return {
    type: 'inline_form_submission',
    toolId: input.toolId,
    toolCallId: input.toolCallId,
    formId: input.formId,
    values: { ...input.values },
  }
}

export function formatInlineFormValue(value: CopilotInlineFormValue | undefined): string {
  if (typeof value === 'boolean') {
    return value ? '是' : '否'
  }
  if (value === undefined) {
    return ''
  }
  return String(value)
}
