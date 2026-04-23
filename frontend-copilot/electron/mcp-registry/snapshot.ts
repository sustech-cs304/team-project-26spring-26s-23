import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { HostedRuntimePaths } from '../runtime/runtime-paths'
import { createDesktopCapabilityBridgePaths } from '../capability-bridge/paths'
import type { McpRemoteToolSummary } from './connectors/protocol'
import {
  MCP_CAPABILITY_SNAPSHOT_BRIDGE_KEY,
  MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID,
  MCP_CAPABILITY_SNAPSHOT_FILE_NAME,
  MCP_SNAPSHOT_VERSION,
  MCP_TOOL_ID_PREFIX,
  type McpCapabilitySnapshot,
  type McpConnectionState,
  type McpErrorSummary,
  type McpServerRecord,
  type McpServerStateSummary,
  type McpSnapshotCatalogRefreshSummary,
  type McpSnapshotGroupSummary,
  type McpSnapshotServerSummary,
  type McpSnapshotToolSummary,
  type McpToolAvailability,
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

export interface CreateMcpCapabilitySnapshotInput {
  registryRevision: number
  snapshotRevision: number
  generatedAt: string
  servers: readonly McpServerRecord[]
  states: readonly McpServerStateSummary[]
  toolsByServerId: ReadonlyMap<string, readonly McpRemoteToolSummary[]>
}

export interface McpCapabilitySnapshotSink {
  write(snapshot: McpCapabilitySnapshot): Promise<void>
}

export interface CreateMcpCapabilitySnapshotSinkOptions {
  runtimePaths: Pick<HostedRuntimePaths, 'stateDir' | 'runtimeRootDir' | 'databaseDir'>
}

interface PersistedBridgeStateDocument {
  version: 1
  values: {
    tool: Record<string, Record<string, Record<string, unknown>>>
    run: Record<string, Record<string, Record<string, Record<string, unknown>>>>
  }
}

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

export function createMcpCapabilitySnapshot(input: CreateMcpCapabilitySnapshotInput): McpCapabilitySnapshot {
  const stateByServerId = new Map(input.states.map((state) => [state.serverId, state]))
  const servers = input.servers.map((server) => {
    const state = stateByServerId.get(server.serverId) ?? createFallbackState(server)
    const tools = server.enabled ? [...(input.toolsByServerId.get(server.serverId) ?? [])] : []
    return buildServerSummary(server, state, tools)
  })
  const groupById = new Map<string, McpSnapshotGroupSummary>()
  const tools = input.servers.flatMap((server) => {
    if (!server.enabled) {
      return []
    }

    const state = stateByServerId.get(server.serverId) ?? createFallbackState(server)
    const remoteTools = [...(input.toolsByServerId.get(server.serverId) ?? [])]
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    const groupId = buildMcpServerGroupId(server.serverId)
    const group = getOrCreateGroup(groupById, groupId, server.displayName)
    const availability = resolveToolAvailability(state.connectionState, remoteTools.length)

    return remoteTools.map((remoteTool) => {
      const toolId = buildMcpToolId(server.serverId, remoteTool.name)
      group.toolIds.push(toolId)
      return buildToolSummary({
        server,
        remoteTool,
        toolId,
        availability,
        groupId,
        groupLabel: group.displayName,
      })
    })
  })

  return {
    version: MCP_SNAPSHOT_VERSION,
    registryRevision: normalizeNonNegativeInteger(input.registryRevision),
    snapshotRevision: normalizeNonNegativeInteger(input.snapshotRevision),
    generatedAt: input.generatedAt,
    servers,
    tools,
    groups: Array.from(groupById.values()),
  }
}

export function createMcpCapabilitySnapshotFilePath(
  hostedPaths: Pick<HostedRuntimePaths, 'stateDir'>,
): string {
  return path.join(hostedPaths.stateDir, MCP_CAPABILITY_SNAPSHOT_FILE_NAME)
}

export function createMcpCapabilitySnapshotSink(
  options: CreateMcpCapabilitySnapshotSinkOptions,
): McpCapabilitySnapshotSink {
  return {
    async write(snapshot) {
      await Promise.all([
        writeSnapshotFile(createMcpCapabilitySnapshotFilePath(options.runtimePaths), snapshot),
        writeSnapshotToCapabilityBridgeState(options.runtimePaths, snapshot),
      ])
    },
  }
}

export function collectMcpSnapshotRedactionViolations(snapshot: unknown): string[] {
  return collectForbiddenPaths(snapshot, '')
}

export function isMcpCapabilitySnapshotRedacted(snapshot: McpCapabilitySnapshot): boolean {
  return collectMcpSnapshotRedactionViolations(snapshot).length === 0
}

function buildServerSummary(
  server: McpServerRecord,
  state: McpServerStateSummary,
  tools: readonly McpRemoteToolSummary[],
): McpSnapshotServerSummary {
  return {
    serverId: server.serverId,
    displayName: server.displayName,
    transportKind: server.transportKind,
    connectionState: server.enabled ? state.connectionState : 'disabled',
    toolCount: server.enabled ? tools.length : 0,
    lastHandshakeAt: state.lastHandshakeAt ?? null,
    lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
    lastError: cloneNullableError(state.lastError ?? null),
    lastSuccessfulCatalogRefresh: buildLastSuccessfulCatalogRefresh(state, tools),
  }
}

function buildToolSummary(input: {
  server: McpServerRecord
  remoteTool: McpRemoteToolSummary
  toolId: string
  availability: McpToolAvailability
  groupId: string
  groupLabel: string
}): McpSnapshotToolSummary {
  return {
    toolId: input.toolId,
    serverId: input.server.serverId,
    remoteToolName: input.remoteTool.name,
    displayName: resolveToolDisplayName(input.server, input.remoteTool),
    description: normalizeDisplayText(input.remoteTool.description),
    inputSchema: cloneRecord(input.remoteTool.inputSchema),
    sourceKind: 'mcp',
    availability: input.availability,
    groupId: input.groupId,
    groupLabel: input.groupLabel,
  }
}

function buildLastSuccessfulCatalogRefresh(
  state: McpServerStateSummary,
  tools: readonly McpRemoteToolSummary[],
): McpSnapshotCatalogRefreshSummary | null {
  const refreshedAt = normalizeDisplayText(state.lastCatalogSyncAt)
  if (refreshedAt === null || tools.length === 0) {
    return null
  }

  return {
    refreshedAt,
    toolCount: tools.length,
  }
}

function resolveToolDisplayName(
  server: McpServerRecord,
  remoteTool: McpRemoteToolSummary,
): string {
  const explicitDisplayName = normalizeDisplayText(remoteTool.displayName)
  if (explicitDisplayName !== null) {
    return explicitDisplayName
  }

  const serverDisplayName = normalizeDisplayText(server.displayName)
  const toolLabel = humanizeMcpToolName(remoteTool.name)
  return serverDisplayName === null ? toolLabel : `${serverDisplayName} / ${toolLabel}`
}

function humanizeMcpToolName(value: string): string {
  const normalized = normalizeDisplayText(value.replace(/[._-]+/g, ' '))
  return normalized ?? value
}

function resolveToolAvailability(
  connectionState: McpConnectionState,
  toolCount: number,
): McpToolAvailability {
  if (toolCount <= 0) {
    return 'unavailable'
  }

  return connectionState === 'connected' ? 'available' : 'degraded'
}

function buildMcpServerGroupId(serverId: string): string {
  return `${MCP_TOOL_ID_PREFIX}.server.${normalizeMcpToolSegment(serverId)}`
}

function getOrCreateGroup(
  groupById: Map<string, McpSnapshotGroupSummary>,
  groupId: string,
  displayName: string,
): McpSnapshotGroupSummary {
  const existing = groupById.get(groupId)
  if (existing !== undefined) {
    return existing
  }

  const group: McpSnapshotGroupSummary = {
    groupId,
    displayName,
    sourceKind: 'mcp',
    toolIds: [],
  }
  groupById.set(groupId, group)
  return group
}

async function writeSnapshotFile(
  snapshotFile: string,
  snapshot: McpCapabilitySnapshot,
): Promise<void> {
  await mkdir(path.dirname(snapshotFile), { recursive: true })
  await writeFile(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
}

async function writeSnapshotToCapabilityBridgeState(
  runtimePaths: Pick<HostedRuntimePaths, 'stateDir' | 'runtimeRootDir' | 'databaseDir'>,
  snapshot: McpCapabilitySnapshot,
): Promise<void> {
  const bridgePaths = createDesktopCapabilityBridgePaths(runtimePaths)
  const document = await readCapabilityBridgeStateDocument(bridgePaths.stateFile)
  document.values.tool[MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID] ??= {}
  document.values.tool[MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID][MCP_CAPABILITY_SNAPSHOT_BRIDGE_KEY] = cloneRecord(snapshot as unknown as Record<string, unknown>)
  await mkdir(path.dirname(bridgePaths.stateFile), { recursive: true })
  await writeFile(bridgePaths.stateFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

async function readCapabilityBridgeStateDocument(stateFile: string): Promise<PersistedBridgeStateDocument> {
  try {
    const parsed = JSON.parse(await readFile(stateFile, 'utf8')) as unknown
    return normalizeCapabilityBridgeStateDocument(parsed)
  } catch (error) {
    if (isMissingFileError(error)) {
      return createEmptyBridgeStateDocument()
    }

    throw error
  }
}

function normalizeCapabilityBridgeStateDocument(value: unknown): PersistedBridgeStateDocument {
  if (!isPlainRecord(value) || !isPlainRecord(value.values)) {
    return createEmptyBridgeStateDocument()
  }

  return {
    version: 1,
    values: {
      tool: normalizeToolStateBuckets(value.values.tool),
      run: normalizeRunStateBuckets(value.values.run),
    },
  }
}

function createEmptyBridgeStateDocument(): PersistedBridgeStateDocument {
  return {
    version: 1,
    values: {
      tool: {},
      run: {},
    },
  }
}

function normalizeToolStateBuckets(value: unknown): Record<string, Record<string, Record<string, unknown>>> {
  if (!isPlainRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).map(([toolId, bucket]) => [toolId, normalizeRecordBucket(bucket)]),
  )
}

function normalizeRunStateBuckets(
  value: unknown,
): Record<string, Record<string, Record<string, Record<string, unknown>>>> {
  if (!isPlainRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).map(([toolId, runBuckets]) => {
      if (!isPlainRecord(runBuckets)) {
        return [toolId, {}]
      }

      return [toolId, Object.fromEntries(
        Object.entries(runBuckets).map(([runId, bucket]) => [runId, normalizeRecordBucket(bucket)]),
      )]
    }),
  )
}

function normalizeRecordBucket(value: unknown): Record<string, Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, recordValue]) => {
      return [key, isPlainRecord(recordValue) ? cloneRecord(recordValue) : {}]
    }),
  )
}

function createFallbackState(server: McpServerRecord): McpServerStateSummary {
  return {
    serverId: server.serverId,
    enabled: server.enabled,
    connectionState: server.enabled ? 'idle' : 'disabled',
    toolCount: 0,
    lastHandshakeAt: null,
    lastCatalogSyncAt: null,
    lastError: null,
    reconnectAttempt: 0,
    transportState: null,
  }
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

  const normalizedPath = path.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (normalizedPath.endsWith('inputschema')) {
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

function normalizeDisplayText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function normalizeNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function cloneNullableError(error: McpErrorSummary | null): McpErrorSummary | null {
  if (error === null) {
    return null
  }

  return {
    ...error,
    details: error.details === undefined || error.details === null
      ? null
      : cloneRecord(error.details),
  }
}

function cloneRecord<TValue extends Record<string, unknown>>(value: TValue): TValue {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as TValue
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}
