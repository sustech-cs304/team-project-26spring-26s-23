import { describe, expect, it } from 'vitest'
import {
  normalizeBoolean,
  normalizeBooleanWithDefault,
  normalizeOptionalString,
  normalizeThemeMode,
  parseBooleanPatchValue,
  parseOptionalStringPatchValue,
  parseThemeModePatchValue,
} from './field-behavior'

describe('normalizeThemeMode', () => {
  it('returns "dark" for "dark"', () => {
    expect(normalizeThemeMode('dark')).toBe('dark')
  })

  it('returns "light" for "light"', () => {
    expect(normalizeThemeMode('light')).toBe('light')
  })

  it('returns "light" for any other string', () => {
    expect(normalizeThemeMode('system')).toBe('light')
    expect(normalizeThemeMode('')).toBe('light')
    expect(normalizeThemeMode('auto')).toBe('light')
  })

  it('returns "light" for non-string values', () => {
    expect(normalizeThemeMode(null)).toBe('light')
    expect(normalizeThemeMode(undefined)).toBe('light')
    expect(normalizeThemeMode(42)).toBe('light')
    expect(normalizeThemeMode(true)).toBe('light')
    expect(normalizeThemeMode({})).toBe('light')
    expect(normalizeThemeMode([])).toBe('light')
  })
})

describe('parseThemeModePatchValue', () => {
  it('returns "dark" for "dark"', () => {
    expect(parseThemeModePatchValue('dark')).toBe('dark')
  })

  it('returns "light" for "light"', () => {
    expect(parseThemeModePatchValue('light')).toBe('light')
  })

  it('throws for any other string', () => {
    expect(() => parseThemeModePatchValue('system')).toThrow('Expected "light" or "dark".')
    expect(() => parseThemeModePatchValue('')).toThrow('Expected "light" or "dark".')
    expect(() => parseThemeModePatchValue('DARK')).toThrow('Expected "light" or "dark".')
  })

  it('throws for non-string values', () => {
    expect(() => parseThemeModePatchValue(null)).toThrow('Expected "light" or "dark".')
    expect(() => parseThemeModePatchValue(undefined)).toThrow('Expected "light" or "dark".')
    expect(() => parseThemeModePatchValue(42)).toThrow('Expected "light" or "dark".')
    expect(() => parseThemeModePatchValue(true)).toThrow('Expected "light" or "dark".')
    expect(() => parseThemeModePatchValue({})).toThrow('Expected "light" or "dark".')
  })
})

describe('normalizeBoolean', () => {
  it('returns true for true', () => {
    expect(normalizeBoolean(true)).toBe(true)
  })

  it('returns false for false', () => {
    expect(normalizeBoolean(false)).toBe(false)
  })

  it('returns true (default) for non-boolean values', () => {
    expect(normalizeBoolean(null)).toBe(true)
    expect(normalizeBoolean(undefined)).toBe(true)
    expect(normalizeBoolean('true')).toBe(true)
    expect(normalizeBoolean(0)).toBe(true)
    expect(normalizeBoolean(1)).toBe(true)
    expect(normalizeBoolean('')).toBe(true)
    expect(normalizeBoolean({})).toBe(true)
  })
})

describe('normalizeBooleanWithDefault', () => {
  it('returns the boolean value when given a boolean', () => {
    expect(normalizeBooleanWithDefault(true, false)).toBe(true)
    expect(normalizeBooleanWithDefault(false, true)).toBe(false)
  })

  it('returns the default when given non-boolean', () => {
    expect(normalizeBooleanWithDefault(null, false)).toBe(false)
    expect(normalizeBooleanWithDefault(undefined, false)).toBe(false)
    expect(normalizeBooleanWithDefault('yes', false)).toBe(false)
    expect(normalizeBooleanWithDefault(1, false)).toBe(false)
    expect(normalizeBooleanWithDefault(null, true)).toBe(true)
    expect(normalizeBooleanWithDefault(undefined, true)).toBe(true)
  })
})

describe('parseBooleanPatchValue', () => {
  it('returns true for true', () => {
    expect(parseBooleanPatchValue(true)).toBe(true)
  })

  it('returns false for false', () => {
    expect(parseBooleanPatchValue(false)).toBe(false)
  })

  it('throws for non-boolean values', () => {
    expect(() => parseBooleanPatchValue(null)).toThrow('Expected a boolean.')
    expect(() => parseBooleanPatchValue(undefined)).toThrow('Expected a boolean.')
    expect(() => parseBooleanPatchValue('true')).toThrow('Expected a boolean.')
    expect(() => parseBooleanPatchValue(0)).toThrow('Expected a boolean.')
    expect(() => parseBooleanPatchValue(1)).toThrow('Expected a boolean.')
    expect(() => parseBooleanPatchValue({})).toThrow('Expected a boolean.')
  })
})

describe('normalizeOptionalString', () => {
  it('returns trimmed string for valid strings', () => {
    expect(normalizeOptionalString('hello')).toBe('hello')
    expect(normalizeOptionalString('  hello  ')).toBe('hello')
    expect(normalizeOptionalString('  hello world  ')).toBe('hello world')
  })

  it('returns null for empty or whitespace-only strings', () => {
    expect(normalizeOptionalString('')).toBe(null)
    expect(normalizeOptionalString('   ')).toBe(null)
    expect(normalizeOptionalString('\t')).toBe(null)
    expect(normalizeOptionalString('\n')).toBe(null)
  })

  it('returns null for non-string values', () => {
    expect(normalizeOptionalString(null)).toBe(null)
    expect(normalizeOptionalString(undefined)).toBe(null)
    expect(normalizeOptionalString(42)).toBe(null)
    expect(normalizeOptionalString(true)).toBe(null)
    expect(normalizeOptionalString(false)).toBe(null)
    expect(normalizeOptionalString({})).toBe(null)
    expect(normalizeOptionalString([])).toBe(null)
  })
})

describe('parseOptionalStringPatchValue', () => {
  it('returns null for null', () => {
    expect(parseOptionalStringPatchValue(null)).toBe(null)
  })

  it('returns trimmed string for valid strings', () => {
    expect(parseOptionalStringPatchValue('hello')).toBe('hello')
    expect(parseOptionalStringPatchValue('  hello  ')).toBe('hello')
  })

  it('returns null for empty or whitespace-only strings', () => {
    expect(parseOptionalStringPatchValue('')).toBe(null)
    expect(parseOptionalStringPatchValue('   ')).toBe(null)
  })

  it('throws for non-string and non-null values', () => {
    expect(() => parseOptionalStringPatchValue(undefined)).toThrow('Expected a string or null.')
    expect(() => parseOptionalStringPatchValue(42)).toThrow('Expected a string or null.')
    expect(() => parseOptionalStringPatchValue(true)).toThrow('Expected a string or null.')
    expect(() => parseOptionalStringPatchValue({})).toThrow('Expected a string or null.')
    expect(() => parseOptionalStringPatchValue([])).toThrow('Expected a string or null.')
  })
})
