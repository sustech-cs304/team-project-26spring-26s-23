import { createMcpRegistryApiFailure } from './ipc'
import type {
  McpDeleteServerResult,
  McpRefreshCatalogRequest,
  McpRefreshCatalogResult,
  McpRegistryLoadRequest,
  McpRegistryLoadResult,
  McpSaveServerResult,
  McpSetServerEnabledRequest,
  McpSetServerEnabledResult,
  McpTestConnectionRequest,
  McpTestConnectionResult,
} from './ipc'
import type { McpRegistryStore, McpRegistryStoreSnapshot } from './store'
import type {
  McpErrorSummary,
  McpRefreshCatalogServerResult,
  McpRegistrySubscriptionEvent,
  McpServerDraft,
  McpServerRecord,
  McpServerStateSummary,
  McpServerValidationError,
  McpTransportConfig,
} from './types'

const MCP_REGISTRY_VALIDATION_ERROR_CODE = 'validation_failed'
const MCP_REGISTRY_NOT_FOUND_ERROR_CODE = 'not_found'
const MCP_REGISTRY_INVALID_REQUEST_ERROR_CODE = 'invalid_request'
const MCP_REGISTRY_P1_LIMITATION_ERROR_CODE = 'p1_management_only'
const MCP_REGISTRY_DISABLED_ERROR_CODE = 'disabled'

export interface McpRegistryService {
  loadRegistry(request?: McpRegistryLoadRequest): Promise<McpRegistryLoadResult>
  saveServer(draft: McpServerDraft): Promise<McpSaveServerResult>
  deleteServer(serverId: string): Promise<McpDeleteServerResult>
  setServerEnabled(request: McpSetServerEnabledRequest): Promise<McpSetServerEnabledResult>
  testConnection(request: McpTestConnectionRequest): Promise<McpTestConnectionResult>
  refreshCatalog(request?: McpRefreshCatalogRequest): Promise<McpRefreshCatalogResult>
}

export interface CreateMcpRegistryServiceOptions {
  store: McpRegistryStore
  now?: () => string
  publishEvent?: (event: McpRegistrySubscriptionEvent) => void | Promise<void>
  appendLog?: (
    level: 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown> | null,
  ) => void | Promise<void>
}

export function createMcpRegistryService(
  options: CreateMcpRegistryServiceOptions,
): McpRegistryService {
  const now = options.now ?? (() => new Date().toISOString())

  return {
    async loadRegistry(request) {
      const snapshot = await options.store.load()
      return buildLoadResult(snapshot, request?.includeDisabled ?? true)
    },
    async saveServer(draft) {
      const snapshot = await options.store.load()
      const existing = snapshot.servers.find((server) => server.serverId === draft.serverId)
      const normalized = normalizeDraft(draft, existing, now())

      if (!normalized.ok) {
        return createMcpRegistryApiFailure(
          'MCP server draft failed validation.',
          MCP_REGISTRY_VALIDATION_ERROR_CODE,
          normalized.validationErrors,
        )
      }

      const nextServers = upsertServer(snapshot.servers, normalized.server)
      const stored = await options.store.saveServers(nextServers)
      await publishSnapshotEvent(stored, options.publishEvent)

      return {
        ok: true,
        registryRevision: stored.registryRevision,
        snapshotRevision: stored.snapshotRevision,
        server: normalized.server,
        state: createServerStateSummary(normalized.server),
        validationErrors: [],
      }
    },
    async deleteServer(serverId) {
      const snapshot = await options.store.load()
      if (!snapshot.servers.some((server) => server.serverId === serverId)) {
        return createMcpRegistryApiFailure(
          `MCP server "${serverId}" was not found.`,
          MCP_REGISTRY_NOT_FOUND_ERROR_CODE,
        )
      }

      const stored = await options.store.saveServers(snapshot.servers.filter((server) => server.serverId !== serverId))
      await publishSnapshotEvent(stored, options.publishEvent)

      return {
        ok: true,
        registryRevision: stored.registryRevision,
        snapshotRevision: stored.snapshotRevision,
        serverId,
        deleted: true,
      }
    },
    async setServerEnabled(request) {
      const snapshot = await options.store.load()
      const existing = snapshot.servers.find((server) => server.serverId === request.serverId)
      if (existing === undefined) {
        return createMcpRegistryApiFailure(
          `MCP server "${request.serverId}" was not found.`,
          MCP_REGISTRY_NOT_FOUND_ERROR_CODE,
        )
      }

      const updatedServer: McpServerRecord = {
        ...cloneServerRecord(existing),
        enabled: request.enabled,
        updatedAt: now(),
      }
      const stored = await options.store.saveServers(upsertServer(snapshot.servers, updatedServer))
      await publishSnapshotEvent(stored, options.publishEvent)

      return {
        ok: true,
        registryRevision: stored.registryRevision,
        snapshotRevision: stored.snapshotRevision,
        server: updatedServer,
        state: createServerStateSummary(updatedServer),
      }
    },
    async testConnection(request) {
      const startedAt = Date.now()
      const resolved = await resolveConnectionTestTarget(request, options.store, now())
      if (!resolved.ok) {
        return resolved.failure
      }

      const durationMs = Math.max(0, Date.now() - startedAt)
      return {
        ok: true,
        success: false,
        transportKind: resolved.server.transportKind,
        toolCount: 0,
        durationMs,
        error: createP1LimitationError(now()),
        warnings: ['P1 已接通管理平面持久化；真实传输连接测试将在 P2 接入。'],
      }
    },
    async refreshCatalog(request) {
      const snapshot = await options.store.load()
      const targetServers = resolveRefreshTargets(snapshot, request)
      if (!targetServers.ok) {
        return targetServers.failure
      }

      const results = targetServers.servers.map((server) => createRefreshCatalogServerResult(server, now()))
      const event: McpRegistrySubscriptionEvent = {
        kind: 'catalog',
        registryRevision: snapshot.registryRevision,
        snapshotRevision: snapshot.snapshotRevision,
        refreshedServerIds: results.map((result) => result.serverId),
        serverId: request?.serverId ?? null,
      }
      await options.publishEvent?.(event)

      return {
        ok: true,
        registryRevision: snapshot.registryRevision,
        snapshotRevision: snapshot.snapshotRevision,
        refreshedServerIds: results.map((result) => result.serverId),
        results,
      }
    },
  }
}

function buildLoadResult(
  snapshot: McpRegistryStoreSnapshot,
  includeDisabled: boolean,
): McpRegistryLoadResult {
  const visibleServers = includeDisabled
    ? snapshot.servers
    : snapshot.servers.filter((server) => server.enabled)

  return {
    ok: true,
    registryRevision: snapshot.registryRevision,
    snapshotRevision: snapshot.snapshotRevision,
    servers: visibleServers.map(cloneServerRecord),
    states: visibleServers.map(createServerStateSummary),
  }
}

function upsertServer(servers: readonly McpServerRecord[], nextServer: McpServerRecord): McpServerRecord[] {
  const existingIndex = servers.findIndex((server) => server.serverId === nextServer.serverId)
  if (existingIndex === -1) {
    return [...servers.map(cloneServerRecord), cloneServerRecord(nextServer)]
  }

  return servers.map((server, index) => index === existingIndex ? cloneServerRecord(nextServer) : cloneServerRecord(server))
}

async function resolveConnectionTestTarget(
  request: McpTestConnectionRequest,
  store: McpRegistryStore,
  timestamp: string,
): Promise<
  | { ok: true, server: McpServerRecord }
  | { ok: false, failure: McpTestConnectionResult }
> {
  if (request.draft !== undefined) {
    const normalized = normalizeDraft(request.draft, null, timestamp)
    if (!normalized.ok) {
      return {
        ok: false,
        failure: createMcpRegistryApiFailure(
          'MCP server draft failed validation.',
          MCP_REGISTRY_VALIDATION_ERROR_CODE,
          normalized.validationErrors,
        ),
      }
    }

    return {
      ok: true,
      server: normalized.server,
    }
  }

  if (typeof request.serverId === 'string' && request.serverId.trim() !== '') {
    const snapshot = await store.load()
    const storedServer = snapshot.servers.find((server) => server.serverId === request.serverId)
    if (storedServer === undefined) {
      return {
        ok: false,
        failure: createMcpRegistryApiFailure(
          `MCP server "${request.serverId}" was not found.`,
          MCP_REGISTRY_NOT_FOUND_ERROR_CODE,
        ),
      }
    }

    return {
      ok: true,
      server: cloneServerRecord(storedServer),
    }
  }

  return {
    ok: false,
    failure: createMcpRegistryApiFailure(
      'Either serverId or draft must be provided for MCP connection testing.',
      MCP_REGISTRY_INVALID_REQUEST_ERROR_CODE,
    ),
  }
}

function resolveRefreshTargets(
  snapshot: McpRegistryStoreSnapshot,
  request?: McpRefreshCatalogRequest,
):
  | { ok: true, servers: McpServerRecord[] }
  | { ok: false, failure: McpRefreshCatalogResult } {
  if (typeof request?.serverId === 'string' && request.serverId.trim() !== '') {
    const server = snapshot.servers.find((entry) => entry.serverId === request.serverId)
    if (server === undefined) {
      return {
        ok: false,
        failure: createMcpRegistryApiFailure(
          `MCP server "${request.serverId}" was not found.`,
          MCP_REGISTRY_NOT_FOUND_ERROR_CODE,
        ),
      }
    }

    return {
      ok: true,
      servers: [cloneServerRecord(server)],
    }
  }

  return {
    ok: true,
    servers: snapshot.servers.filter((server) => server.enabled).map(cloneServerRecord),
  }
}

function createRefreshCatalogServerResult(
  server: McpServerRecord,
  timestamp: string,
): McpRefreshCatalogServerResult {
  if (!server.enabled) {
    return {
      serverId: server.serverId,
      toolCount: 0,
      connectionState: 'disabled',
      error: {
        code: MCP_REGISTRY_DISABLED_ERROR_CODE,
        message: 'The server is disabled. Enable it before refreshing the catalog.',
        retryable: false,
        observedAt: timestamp,
      },
    }
  }

  return {
    serverId: server.serverId,
    toolCount: 0,
    connectionState: 'idle',
    error: createP1LimitationError(timestamp),
  }
}

function createServerStateSummary(server: McpServerRecord): McpServerStateSummary {
  return {
    serverId: server.serverId,
    enabled: server.enabled,
    connectionState: server.enabled ? 'idle' : 'disabled',
    toolCount: 0,
    lastHandshakeAt: null,
    lastCatalogSyncAt: null,
    lastError: null,
    reconnectAttempt: 0,
    transportState: server.transportKind === 'stdio'
      ? {
          kind: 'stdio',
          processStatus: 'stopped',
          pid: null,
          lastExitCode: null,
          lastExitSignal: null,
        }
      : {
          kind: 'http-sse',
          endpointStatus: 'offline',
          lastHttpStatus: null,
          sseOnline: false,
        },
  }
}

async function publishSnapshotEvent(
  snapshot: McpRegistryStoreSnapshot,
  publishEvent?: (event: McpRegistrySubscriptionEvent) => void | Promise<void>,
): Promise<void> {
  if (publishEvent === undefined) {
    return
  }

  await publishEvent({
    kind: 'snapshot',
    registryRevision: snapshot.registryRevision,
    snapshotRevision: snapshot.snapshotRevision,
    servers: snapshot.servers.map(cloneServerRecord),
    states: snapshot.servers.map(createServerStateSummary),
  })
}

function normalizeDraft(
  draft: McpServerDraft,
  existing: McpServerRecord | null | undefined,
  timestamp: string,
):
  | { ok: true, server: McpServerRecord }
  | { ok: false, validationErrors: McpServerValidationError[] } {
  const validationErrors: McpServerValidationError[] = []
  const serverId = normalizeRequiredString(draft.serverId, 'serverId', validationErrors)
  const displayName = normalizeRequiredString(draft.displayName, 'displayName', validationErrors)
  const description = normalizeOptionalString(draft.description)
  const reservedSensitiveFields = normalizeOptionalStringArray(
    draft.reservedSensitiveFields,
    'reservedSensitiveFields',
    validationErrors,
  )

  const transportKind = draft.transportConfig.kind
  if (draft.transportKind !== transportKind) {
    validationErrors.push({
      fieldPath: 'transportKind',
      message: 'transportKind must match transportConfig.kind.',
      code: 'transport_kind_mismatch',
    })
  }

  const transportConfig = normalizeDraftTransportConfig(draft.transportConfig, validationErrors)

  if (serverId === null || displayName === null || transportConfig === null || validationErrors.length > 0) {
    return {
      ok: false,
      validationErrors,
    }
  }

  return {
    ok: true,
    server: {
      serverId,
      displayName,
      enabled: draft.enabled,
      transportKind,
      description,
      transportConfig,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...(reservedSensitiveFields === undefined ? {} : { reservedSensitiveFields }),
    },
  }
}

function normalizeDraftTransportConfig(
  transportConfig: McpTransportConfig,
  validationErrors: McpServerValidationError[],
): McpTransportConfig | null {
  if (transportConfig.kind === 'stdio') {
    const command = normalizeRequiredString(transportConfig.command, 'transportConfig.command', validationErrors)
    const args = normalizeOptionalStringArray(transportConfig.args, 'transportConfig.args', validationErrors) ?? []
    const cwd = normalizeOptionalString(transportConfig.cwd)
    const env = normalizeStringRecord(transportConfig.env, 'transportConfig.env', validationErrors)

    if (command === null || env === null) {
      return null
    }

    return {
      kind: 'stdio',
      command,
      args,
      cwd,
      ...(env === undefined ? {} : { env }),
    }
  }

  const baseUrl = normalizeRequiredString(transportConfig.baseUrl, 'transportConfig.baseUrl', validationErrors)
  if (baseUrl !== null && !isHttpUrl(baseUrl)) {
    validationErrors.push({
      fieldPath: 'transportConfig.baseUrl',
      message: 'transportConfig.baseUrl must be an http or https URL.',
      code: 'invalid_url',
    })
  }

  const headers = normalizeStringRecord(transportConfig.headers, 'transportConfig.headers', validationErrors)
  const env = normalizeStringRecord(transportConfig.env, 'transportConfig.env', validationErrors)
  const ssePathOverride = normalizeOptionalString(transportConfig.ssePathOverride)

  if (baseUrl === null || headers === null || env === null || !isHttpUrl(baseUrl)) {
    return null
  }

  return {
    kind: 'http-sse',
    baseUrl,
    ...(headers === undefined ? {} : { headers }),
    ...(env === undefined ? {} : { env }),
    ssePathOverride,
  }
}

function normalizeRequiredString(
  value: unknown,
  fieldPath: string,
  validationErrors: McpServerValidationError[],
): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    validationErrors.push({
      fieldPath,
      message: `${fieldPath} is required.`,
      code: 'required',
    })
    return null
  }

  return value.trim()
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function normalizeOptionalStringArray(
  value: unknown,
  fieldPath: string,
  validationErrors: McpServerValidationError[],
): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    validationErrors.push({
      fieldPath,
      message: `${fieldPath} must be an array of strings.`,
      code: 'invalid_type',
    })
    return undefined
  }

  const normalized: string[] = []
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string') {
      validationErrors.push({
        fieldPath: `${fieldPath}[${index}]`,
        message: `${fieldPath}[${index}] must be a string.`,
        code: 'invalid_type',
      })
      continue
    }

    const trimmed = entry.trim()
    if (trimmed !== '') {
      normalized.push(trimmed)
    }
  }

  return normalized
}

function normalizeStringRecord(
  value: unknown,
  fieldPath: string,
  validationErrors: McpServerValidationError[],
): Record<string, string> | undefined | null {
  if (value === undefined) {
    return undefined
  }

  if (!isPlainRecord(value)) {
    validationErrors.push({
      fieldPath,
      message: `${fieldPath} must be an object of string values.`,
      code: 'invalid_type',
    })
    return null
  }

  const normalized: Record<string, string> = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const normalizedKey = entryKey.trim()
    if (normalizedKey === '') {
      validationErrors.push({
        fieldPath,
        message: `${fieldPath} contains an empty key.`,
        code: 'empty_key',
      })
      continue
    }

    if (typeof entryValue !== 'string') {
      validationErrors.push({
        fieldPath: `${fieldPath}.${normalizedKey}`,
        message: `${fieldPath}.${normalizedKey} must be a string.`,
        code: 'invalid_type',
      })
      continue
    }

    normalized[normalizedKey] = entryValue
  }

  return normalized
}

function createP1LimitationError(observedAt: string): McpErrorSummary {
  return {
    code: MCP_REGISTRY_P1_LIMITATION_ERROR_CODE,
    message: 'P1 currently persists MCP registry management state only. Live connectors, transport handshakes, and catalog sync will arrive in P2.',
    retryable: false,
    observedAt,
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function cloneServerRecord(server: McpServerRecord): McpServerRecord {
  if (server.transportConfig.kind === 'stdio') {
    return {
      ...server,
      transportConfig: {
        ...server.transportConfig,
        args: [...server.transportConfig.args],
        ...(server.transportConfig.env === undefined ? {} : { env: { ...server.transportConfig.env } }),
      },
      ...(server.reservedSensitiveFields === undefined
        ? {}
        : { reservedSensitiveFields: [...server.reservedSensitiveFields] }),
    }
  }

  return {
    ...server,
    transportConfig: {
      ...server.transportConfig,
      ...(server.transportConfig.headers === undefined ? {} : { headers: { ...server.transportConfig.headers } }),
      ...(server.transportConfig.env === undefined ? {} : { env: { ...server.transportConfig.env } }),
    },
    ...(server.reservedSensitiveFields === undefined
      ? {}
      : { reservedSensitiveFields: [...server.reservedSensitiveFields] }),
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
