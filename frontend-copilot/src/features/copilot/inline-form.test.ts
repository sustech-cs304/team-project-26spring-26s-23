import { describe, expect, it } from 'vitest'

import type { RuntimeInlineFormField, RuntimeInlineFormRequest } from './thread-run-contract'
import {
  CONTROLLED_INLINE_FORM_TOOL_ID,
  INLINE_FORM_AWAITING_INPUT_CODE,
  buildInlineFormSubmissionPayload,
  buildInlineFormSubmissionSummary,
  createDefaultInlineFormValues,
  formatInlineFormValue,
  isControlledInlineFormToolEvent,
  validateInlineFormValues,
} from './inline-form'

function createField(
  overrides: Partial<RuntimeInlineFormField> & { name: string; type: RuntimeInlineFormField['type'] },
): RuntimeInlineFormField {
  return {
    label: overrides.name,
    ...overrides,
  }
}

describe('isControlledInlineFormToolEvent', () => {
  it('returns true when toolId matches and formRequest is defined', () => {
    expect(
      isControlledInlineFormToolEvent({
        toolId: CONTROLLED_INLINE_FORM_TOOL_ID,
        formRequest: { formId: 'f1', title: 'Test', fields: [] },
      }),
    ).toBe(true)
  })

  it('returns false when toolId does not match', () => {
    expect(
      isControlledInlineFormToolEvent({
        toolId: 'some-other-tool',
        formRequest: { formId: 'f1', title: 'Test', fields: [] },
      }),
    ).toBe(false)
  })

  it('returns false when formRequest is undefined', () => {
    expect(
      isControlledInlineFormToolEvent({
        toolId: CONTROLLED_INLINE_FORM_TOOL_ID,
        formRequest: undefined,
      }),
    ).toBe(false)
  })
})

describe('createDefaultInlineFormValues', () => {
  it('creates empty string defaults for text fields', () => {
    const values = createDefaultInlineFormValues([
      createField({ name: 'username', type: 'text' }),
      createField({ name: 'bio', type: 'textarea' }),
    ])

    expect(values).toEqual({ username: '', bio: '' })
  })

  it('creates numeric-field defaults as empty string', () => {
    const values = createDefaultInlineFormValues([
      createField({ name: 'age', type: 'number' }),
    ])

    expect(values).toEqual({ age: '' })
  })

  it('creates false default for checkbox fields', () => {
    const values = createDefaultInlineFormValues([
      createField({ name: 'agree', type: 'checkbox' }),
    ])

    expect(values).toEqual({ agree: false })
  })

  it('creates empty string default for select fields', () => {
    const values = createDefaultInlineFormValues([
      createField({ name: 'city', type: 'select' }),
    ])

    expect(values).toEqual({ city: '' })
  })

  it('handles mixed field types', () => {
    const values = createDefaultInlineFormValues([
      createField({ name: 'name', type: 'text' }),
      createField({ name: 'agree', type: 'checkbox' }),
      createField({ name: 'count', type: 'number' }),
    ])

    expect(values).toEqual({ name: '', agree: false, count: '' })
  })

  it('returns empty object for empty fields array', () => {
    expect(createDefaultInlineFormValues([])).toEqual({})
  })
})

describe('validateInlineFormValues', () => {
  describe('checkbox fields', () => {
    it('accepts checked checkbox', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'agree', type: 'checkbox', required: true })],
        values: { agree: true },
      })

      expect(result.isValid).toBe(true)
      expect(result.errors).toEqual({})
      expect(result.values).toEqual({ agree: true })
    })

    it('rejects unchecked required checkbox', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'agree', type: 'checkbox', required: true })],
        values: { agree: false },
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.agree).toBe('请确认此项。')
    })

    it('accepts unchecked optional checkbox', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'agree', type: 'checkbox', required: false })],
        values: { agree: false },
      })

      expect(result.isValid).toBe(true)
      expect(result.values.agree).toBe(false)
    })

    it('normalizes non-boolean values to false', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'agree', type: 'checkbox' })],
        values: { agree: 'true' },
      })

      expect(result.values.agree).toBe(false)
    })

    it('accepts missing required checkbox value (treated as falsy) - check required', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'agree', type: 'checkbox', required: true })],
        values: {},
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.agree).toBe('请确认此项。')
    })
  })

  describe('number fields', () => {
    it('parses numeric string correctly', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'count', type: 'number' })],
        values: { count: '42' },
      })

      expect(result.isValid).toBe(true)
      expect(result.values.count).toBe(42)
    })

    it('rejects non-numeric input', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'count', type: 'number' })],
        values: { count: 'abc' },
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.count).toBe('请输入有效数字。')
      expect(result.values.count).toBe('abc')
    })

    it('rejects empty required number field', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'count', type: 'number', required: true })],
        values: { count: '' },
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.count).toBe('此项为必填。')
    })

    it('accepts empty optional number field', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'count', type: 'number' })],
        values: { count: '' },
      })

      expect(result.isValid).toBe(true)
      expect(result.values.count).toBe('')
    })

    it('parses float value', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'price', type: 'number' })],
        values: { price: '12.5' },
      })

      expect(result.isValid).toBe(true)
      expect(result.values.price).toBe(12.5)
    })

    it('accepts zero', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'count', type: 'number' })],
        values: { count: '0' },
      })

      expect(result.isValid).toBe(true)
      expect(result.values.count).toBe(0)
    })

    it('trims whitespace from numeric input', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'count', type: 'number' })],
        values: { count: '  99  ' },
      })

      expect(result.isValid).toBe(true)
      expect(result.values.count).toBe(99)
    })
  })

  describe('text/textarea fields', () => {
    it('accepts non-empty text', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'username', type: 'text' })],
        values: { username: 'john' },
      })

      expect(result.isValid).toBe(true)
      expect(result.values.username).toBe('john')
    })

    it('rejects empty required text field', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'username', type: 'text', required: true })],
        values: { username: '' },
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.username).toBe('此项为必填。')
    })

    it('rejects whitespace-only required text field', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'username', type: 'text', required: true })],
        values: { username: '   ' },
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.username).toBe('此项为必填。')
    })

    it('trims text value', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'username', type: 'text' })],
        values: { username: '  john  ' },
      })

      expect(result.values.username).toBe('john')
    })

    it('handles textarea same as text', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'bio', type: 'textarea', required: true })],
        values: { bio: 'about me' },
      })

      expect(result.isValid).toBe(true)
      expect(result.values.bio).toBe('about me')
    })

    it('handles non-string draft value as empty', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'username', type: 'text' })],
        values: { username: true },
      })

      expect(result.isValid).toBe(true)
      expect(result.values.username).toBe('')
    })
  })

  describe('select fields', () => {
    it('accepts valid option value', () => {
      const result = validateInlineFormValues({
        fields: [
          createField({
            name: 'city',
            type: 'select',
            options: [
              { value: 'sz', label: '深圳' },
              { value: 'bj', label: '北京' },
            ],
          }),
        ],
        values: { city: 'sz' },
      })

      expect(result.isValid).toBe(true)
      expect(result.values.city).toBe('sz')
    })

    it('rejects option value not in field options', () => {
      const result = validateInlineFormValues({
        fields: [
          createField({
            name: 'city',
            type: 'select',
            required: true,
            options: [
              { value: 'sz', label: '深圳' },
            ],
          }),
        ],
        values: { city: 'sh' },
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.city).toBe('请选择有效选项。')
    })

    it('rejects both missing and wrong value (required)', () => {
      const result = validateInlineFormValues({
        fields: [
          createField({
            name: 'city',
            type: 'select',
            required: true,
            options: [{ value: 'sz', label: '深圳' }],
          }),
        ],
        values: { city: '' },
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.city).toBe('此项为必填。')
      expect(result.values.city).toBe('')
    })

    it('accepts empty optional select', () => {
      const result = validateInlineFormValues({
        fields: [
          createField({
            name: 'city',
            type: 'select',
            options: [{ value: 'sz', label: '深圳' }],
          }),
        ],
        values: { city: '' },
      })

      expect(result.isValid).toBe(true)
      expect(result.values.city).toBe('')
    })

    it('accepts empty string when options is missing', () => {
      const result = validateInlineFormValues({
        fields: [createField({ name: 'city', type: 'select' })],
        values: { city: 'anything' },
      })

      expect(result.isValid).toBe(true)
    })

    it('accepts empty string when options is not an array', () => {
      const result = validateInlineFormValues({
        fields: [
          createField({
            name: 'city',
            type: 'select',
            options: undefined,
          }),
        ],
        values: { city: 'anything' },
      })

      expect(result.isValid).toBe(true)
    })
  })

  describe('combined fields', () => {
    it('validates multiple fields simultaneously', () => {
      const result = validateInlineFormValues({
        fields: [
          createField({ name: 'username', type: 'text', required: true }),
          createField({ name: 'count', type: 'number', required: true }),
          createField({ name: 'agree', type: 'checkbox', required: true }),
        ],
        values: { username: '', count: '', agree: false },
      })

      expect(result.isValid).toBe(false)
      expect(result.errors).toEqual({
        username: '此项为必填。',
        count: '此项为必填。',
        agree: '请确认此项。',
      })
    })

    it('returns valid when all fields pass', () => {
      const result = validateInlineFormValues({
        fields: [
          createField({ name: 'username', type: 'text', required: true }),
          createField({ name: 'count', type: 'number', required: true }),
          createField({ name: 'agree', type: 'checkbox', required: true }),
        ],
        values: { username: 'jane', count: '7', agree: true },
      })

      expect(result.isValid).toBe(true)
      expect(result.values).toEqual({ username: 'jane', count: 7, agree: true })
    })
  })
})

describe('buildInlineFormSubmissionSummary', () => {
  it('builds summary with title and field values', () => {
    const request: Pick<RuntimeInlineFormRequest, 'title' | 'fields'> = {
      title: '用户信息',
      fields: [
        createField({ name: 'username', type: 'text', label: '用户名' }),
        createField({ name: 'count', type: 'number', label: '数量' }),
      ],
    }

    const summary = buildInlineFormSubmissionSummary({
      request,
      values: { username: 'jane', count: 7 },
    })

    expect(summary).toBe('已提交表单：用户信息\n用户名: jane\n数量: 7')
  })

  it('handles boolean value in summary', () => {
    const request: Pick<RuntimeInlineFormRequest, 'title' | 'fields'> = {
      title: '确认',
      fields: [createField({ name: 'agree', type: 'checkbox', label: '同意' })],
    }

    const summary = buildInlineFormSubmissionSummary({
      request,
      values: { agree: true },
    })

    expect(summary).toBe('已提交表单：确认\n同意: 是')
  })

  it('handles undefined value in summary', () => {
    const request: Pick<RuntimeInlineFormRequest, 'title' | 'fields'> = {
      title: 'Info',
      fields: [createField({ name: 'extra', type: 'text', label: 'Extra' })],
    }

    const summary = buildInlineFormSubmissionSummary({
      request,
      values: {},
    })

    expect(summary).toBe('已提交表单：Info\nExtra: ')
  })
})

describe('buildInlineFormSubmissionPayload', () => {
  it('builds payload with cloned values', () => {
    const payload = buildInlineFormSubmissionPayload({
      toolId: 'tool-1',
      toolCallId: 'call-1',
      formId: 'form-1',
      values: { username: 'jane', count: 7 },
    })

    expect(payload).toEqual({
      type: 'inline_form_submission',
      toolId: 'tool-1',
      toolCallId: 'call-1',
      formId: 'form-1',
      values: { username: 'jane', count: 7 },
    })
  })

  it('spreads values to avoid mutation', () => {
    const values = { username: 'jane' }
    const payload = buildInlineFormSubmissionPayload({
      toolId: 't',
      toolCallId: 'c',
      formId: 'f',
      values,
    })

    expect(payload.values).toEqual(values)
    expect(payload.values).not.toBe(values)
  })
})

describe('formatInlineFormValue', () => {
  it('formats true as 是', () => {
    expect(formatInlineFormValue(true)).toBe('是')
  })

  it('formats false as 否', () => {
    expect(formatInlineFormValue(false)).toBe('否')
  })

  it('formats undefined as empty string', () => {
    expect(formatInlineFormValue(undefined)).toBe('')
  })

  it('formats number as string', () => {
    expect(formatInlineFormValue(42)).toBe('42')
  })

  it('formats string as-is', () => {
    expect(formatInlineFormValue('hello')).toBe('hello')
  })
})

describe('INLINE_FORM_AWAITING_INPUT_CODE', () => {
  it('is the expected constant value', () => {
    expect(INLINE_FORM_AWAITING_INPUT_CODE).toBe('awaiting_user_input')
  })
})
