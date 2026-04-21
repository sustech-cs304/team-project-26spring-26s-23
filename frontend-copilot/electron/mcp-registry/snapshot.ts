import {
  MCP_TOOL_ID_PREFIX,
  type McpCapabilitySnapshot,
} from './types'

const MCP_SNAPSHOT_FORBIDDEN_KEY_SET = new Set([
  'apikey',
  'args',
  'authorization',
  'command',
  'env',
  'headers',
  'localtoken',
  'password',
  'passwords',
  'secret',
  'secrets',
  'token',
  'tokens',
])

export const MCP_SNAPSHOT_FORBIDDEN_FIELD_KEYS = Object.freeze([
  'apiKey',
  'args',
  'authorization',
  'command',
  'env',
  'headers',
  'localToken',
  'password',
  'secret',
  'token',
])

export function normalizeMcpToolSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'unnamed'
}

export function buildMcpToolId(serverId: string, remoteToolName: string): string {
  const normalizedServerId = normalizeMcpToolSegment(serverId)
  const normalizedToolName = normalizeMcpToolSegment(remoteToolName)
  const hash = createDeterministicHash(`${serverId}:${remoteToolName}`)

  return `${MCP_TOOL_ID_PREFIX}.${normalizedServerId}.${normalizedToolName}.${hash}`
}

export function collectMcpSnapshotRedactionViolations(snapshot: unknown): string[] {
  return collectForbiddenPaths(snapshot, '')
}

export function isMcpCapabilitySnapshotRedacted(snapshot: McpCapabilitySnapshot): boolean {
  return collectMcpSnapshotRedactionViolations(snapshot).length === 0
}

function createDeterministicHash(input: string): string {
  let hash = 0

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash + input.charCodeAt(index) * (index + 1)) >>> 0
  }

  return hash.toString(16).padStart(8, '0').slice(-8)
}

function collectForbiddenPaths(value: unknown, path: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectForbiddenPaths(item, `${path}[${index}]`))
  }

  if (!isPlainRecord(value)) {
    return []
  }

  const violations: string[] = []

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key
    if (MCP_SNAPSHOT_FORBIDDEN_KEY_SET.has(normalizeForbiddenKey(key))) {
      violations.push(nextPath)
      continue
    }
    violations.push(...collectForbiddenPaths(nestedValue, nextPath))
  }

  return violations
}

function normalizeForbiddenKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
