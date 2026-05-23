import { describe, expect, it } from 'vitest'

import {
  asRecord,
  normalizeBoolean,
  normalizeBooleanStringGroup,
  normalizeNonEmptyString,
  normalizeString,
  normalizeStringGroup,
} from './normalize'

describe('normalizeString', () => {
  it('returns trimmed string when input is a string', () => {
    expect(normalizeString('  hello  ', 'fallback')).toBe('hello')
  })

  it('returns fallback when input is not a string', () => {
    expect(normalizeString(undefined, 'fallback')).toBe('fallback')
    expect(normalizeString(null, 'fallback')).toBe('fallback')
    expect(normalizeString(123, 'fallback')).toBe('fallback')
    expect(normalizeString(true, 'fallback')).toBe('fallback')
    expect(normalizeString({}, 'fallback')).toBe('fallback')
  })

  it('returns empty string when input is empty string', () => {
    expect(normalizeString('', 'fallback')).toBe('')
  })

  it('returns whitespace-only string trimmed to empty', () => {
    expect(normalizeString('   ', 'fallback')).toBe('')
  })
})

describe('normalizeNonEmptyString', () => {
  it('returns trimmed string when non-empty', () => {
    expect(normalizeNonEmptyString('  hello  ', 'fallback')).toBe('hello')
  })

  it('returns fallback when input is empty after trimming', () => {
    expect(normalizeNonEmptyString('   ', 'fallback')).toBe('fallback')
    expect(normalizeNonEmptyString('', 'fallback')).toBe('fallback')
  })

  it('returns fallback when input is not a string', () => {
    expect(normalizeNonEmptyString(undefined, 'fallback')).toBe('fallback')
    expect(normalizeNonEmptyString(null, 'fallback')).toBe('fallback')
    expect(normalizeNonEmptyString(42, 'fallback')).toBe('fallback')
    expect(normalizeNonEmptyString(false, 'fallback')).toBe('fallback')
    expect(normalizeNonEmptyString([], 'fallback')).toBe('fallback')
  })
})

describe('normalizeBoolean', () => {
  it('returns the boolean value when input is boolean', () => {
    expect(normalizeBoolean(true, false)).toBe(true)
    expect(normalizeBoolean(false, true)).toBe(false)
  })

  it('returns fallback when input is not a boolean', () => {
    expect(normalizeBoolean(undefined, true)).toBe(true)
    expect(normalizeBoolean(null, false)).toBe(false)
    expect(normalizeBoolean('true', true)).toBe(true)
    expect(normalizeBoolean(1, false)).toBe(false)
    expect(normalizeBoolean({}, true)).toBe(true)
  })
})

describe('asRecord', () => {
  it('returns the object when input is a non-null object', () => {
    const obj = { key: 'value' }
    expect(asRecord(obj)).toBe(obj)
  })

  it('returns empty object when input is null', () => {
    expect(asRecord(null)).toEqual({})
  })

  it('returns empty object when input is undefined', () => {
    expect(asRecord(undefined)).toEqual({})
  })

  it('returns empty object when input is a primitive', () => {
    expect(asRecord('string')).toEqual({})
    expect(asRecord(42)).toEqual({})
    expect(asRecord(true)).toEqual({})
  })

  it('returns empty object when input is an array', () => {
    const arr = [1, 2, 3]
    const result = asRecord(arr)
    expect(result).toBe(arr)
  })
})

describe('normalizeStringGroup', () => {
  const defaults = { name: 'default-name', language: 'en' }

  it('normalizes each key using normalizeNonEmptyString against defaults', () => {
    const result = normalizeStringGroup({ name: '  Custom  ', language: '' }, defaults)
    expect(result).toEqual({ name: 'Custom', language: 'en' })
  })

  it('uses defaults when input is not a record', () => {
    expect(normalizeStringGroup(undefined, defaults)).toEqual(defaults)
    expect(normalizeStringGroup(null, defaults)).toEqual(defaults)
    expect(normalizeStringGroup('invalid', defaults)).toEqual(defaults)
  })

  it('falls back when keys are missing', () => {
    const result = normalizeStringGroup({}, defaults)
    expect(result).toEqual(defaults)
  })

  it('falls back to default for whitespace-only or empty values', () => {
    const result = normalizeStringGroup({ name: '  ', language: 'zh' }, defaults)
    expect(result).toEqual({ name: 'default-name', language: 'zh' })
  })
})

describe('normalizeBooleanStringGroup', () => {
  const defaults = {
    enabled: true,
    name: 'default-name',
    visible: false,
    title: 'default-title',
  } as const

  it('normalizes boolean fields as booleans', () => {
    const result = normalizeBooleanStringGroup({ enabled: false, name: 'Custom', visible: true, title: 'T' }, defaults)
    expect(result).toEqual({ enabled: false, name: 'Custom', visible: true, title: 'T' })
  })

  it('uses defaults when input is not a record', () => {
    expect(normalizeBooleanStringGroup(undefined, defaults)).toEqual(defaults)
    expect(normalizeBooleanStringGroup(null, defaults)).toEqual(defaults)
  })

  it('falls back for missing boolean fields', () => {
    const result = normalizeBooleanStringGroup({ name: 'X' }, defaults)
    expect(result).toEqual({ enabled: true, name: 'X', visible: false, title: 'default-title' })
  })

  it('falls back for invalid boolean fields', () => {
    const result = normalizeBooleanStringGroup({ enabled: 'not-bool', name: 'X' }, defaults)
    expect(result).toEqual({ enabled: true, name: 'X', visible: false, title: 'default-title' })
  })

  it('handles string fields with empty fallback via normalizeNonEmptyString', () => {
    const result = normalizeBooleanStringGroup({ name: '' }, defaults)
    expect(result).toEqual({ ...defaults, name: 'default-name' })
  })
})
