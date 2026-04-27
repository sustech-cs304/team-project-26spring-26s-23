import { PLATFORM_TOKEN_LABELS, TOOL_TOKEN_LABELS } from './constants'

export function normalizeText(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim()
  return normalizedValue ? normalizedValue : null
}

export function containsCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/u.test(value)
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

export function firstNonEmptyString(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalizedValue = normalizeText(value)
    if (normalizedValue !== null) {
      return normalizedValue
    }
  }

  return null
}

export function readRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

export function readStringRecordField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? normalizeText(value) : null
}

export function readNestedIdentity(value: unknown): {
  key: string | null
  title: string | null
} | null {
  const record = readRecord(value)
  if (record === null) {
    return null
  }

  const key = firstNonEmptyString([
    readStringRecordField(record, 'id'),
    readStringRecordField(record, 'key'),
    readStringRecordField(record, 'serverId'),
    readStringRecordField(record, 'providerId'),
  ])
  const title = firstNonEmptyString([
    readStringRecordField(record, 'title'),
    readStringRecordField(record, 'name'),
    readStringRecordField(record, 'label'),
    readStringRecordField(record, 'serverName'),
    readStringRecordField(record, 'providerName'),
  ])

  if (key === null && title === null) {
    return null
  }

  return {
    key,
    title,
  }
}

export function normalizeGroupKey(value: string | null | undefined): string | null {
  const normalizedValue = normalizeText(value)
  if (normalizedValue === null) {
    return null
  }

  const normalizedKey = normalizedValue
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')

  return normalizedKey === '' ? null : normalizedKey
}

export function formatPlatformLabel(value: string): string {
  const normalizedValue = normalizeText(value)
  if (normalizedValue === null) {
    return '其他工具'
  }

  const tokens = normalizedValue
    .split(/[.:/_-]+/)
    .map((token) => token.trim())
    .filter((token) => token !== '')
  if (tokens.length === 0) {
    return normalizedValue
  }

  return tokens.map((token) => formatPlatformToken(token)).join(' ')
}

export function formatPlatformToken(token: string): string {
  const lowerToken = token.toLowerCase()
  if (PLATFORM_TOKEN_LABELS[lowerToken] !== undefined) {
    return PLATFORM_TOKEN_LABELS[lowerToken]
  }

  if (/^[A-Z0-9]+$/u.test(token)) {
    return token
  }

  return `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`
}

export function formatExplicitPlatformTitle(value: string | null | undefined): string | null {
  const normalizedValue = normalizeText(value)
  if (normalizedValue === null) {
    return null
  }

  if (containsCjk(normalizedValue) || /\s/u.test(normalizedValue) || /[A-Z]/u.test(normalizedValue)) {
    return normalizedValue
  }

  return formatPlatformLabel(normalizedValue)
}

export function isBuiltinToolKind(kind: string): boolean {
  return normalizeText(kind)?.toLowerCase() === 'builtin'
}

export function extractToolNamespace(toolId: string): string | null {
  const normalizedToolId = normalizeText(toolId)
  if (normalizedToolId === null) {
    return null
  }

  const [namespace] = normalizedToolId.split(/[.:/]+/)
  return namespace ? namespace.toLowerCase() : null
}

export function buildIdBasedToolName(toolId: string): string | null {
  const normalizedToolId = normalizeText(toolId)
  if (normalizedToolId === null) {
    return null
  }

  const tokens = normalizedToolId
    .split(/[.:/_-]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== '')
  if (tokens.length === 0) {
    return null
  }

  const translatedTokens = tokens
    .map((token) => TOOL_TOKEN_LABELS[token])
    .filter((token): token is string => token !== undefined)
  if (translatedTokens.length === 0) {
    return null
  }

  if (tokens[0] === 'blackboard') {
    const coreTokens = translatedTokens.filter((token) => token !== 'Blackboard').slice(-3)
    return coreTokens.length > 0 ? truncateText(coreTokens.join(''), 18) : 'Blackboard 工具'
  }

  if (tokens[0] === 'tis') {
    const coreTokens = translatedTokens.filter((token) => token !== 'TIS').slice(-3)
    return coreTokens.length > 0 ? truncateText(coreTokens.join(''), 18) : 'TIS 工具'
  }

  const coreTokens = translatedTokens.filter((token) => token !== '工具').slice(-3)
  if (coreTokens.length > 0) {
    return truncateText(coreTokens.join(''), 18)
  }

  return truncateText(translatedTokens.join(''), 18)
}

export function stripOpaqueMcpSuffix(segments: string[]): string[] {
  if (segments.length === 0) {
    return segments
  }

  const lastSegment = segments[segments.length - 1]?.trim() ?? ''
  if (/^[0-9a-f]{6,}$/iu.test(lastSegment)) {
    return segments.slice(0, -1)
  }

  return segments
}

export function formatMcpRemoteToolLabel(value: string | null | undefined): string | null {
  const normalizedValue = normalizeText(value)
  if (normalizedValue === null) {
    return null
  }

  return formatPlatformLabel(normalizedValue)
}
