import type { UnifiedConfigTheme } from './domain-schema'

export function normalizeThemeMode(value: unknown): UnifiedConfigTheme {
  return value === 'dark' ? 'dark' : 'light'
}

export function parseThemeModePatchValue(value: unknown): UnifiedConfigTheme {
  if (value === 'light' || value === 'dark') {
    return value
  }

  throw new Error('Expected "light" or "dark".')
}

export function normalizeBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true
}

export function parseBooleanPatchValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  throw new Error('Expected a boolean.')
}

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()
  return normalizedValue === '' ? null : normalizedValue
}

export function parseOptionalStringPatchValue(value: unknown): string | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw new Error('Expected a string or null.')
  }

  const normalizedValue = value.trim()
  return normalizedValue === '' ? null : normalizedValue
}
