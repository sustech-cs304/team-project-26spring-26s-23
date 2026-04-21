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
import {
  createMcpConnectorHub,
  type McpConnectorHub,
  type McpConnectorHubRevisionState,
} from './connector-hub'
import type { McpRegistryStore, McpRegistryStoreSnapshot } from './store'
import type {
  McpRefreshCatalogServerResult,
  McpRegistrySubscriptionEvent,
  McpServerDraft,
  McpServerRecord,
  McpServerStateSummary,
  McpServerValidationError,
  McpTransportConfig,
} from './types'
import { createConnectorState } from './connectors/protocol'

const MCP_REGISTRY_VALIDATION_ERROR_CODE = 'validation_failed'
const MCP_REGISTRY_NOT_FOUND_ERROR_CODE = 'not_found'
const MCP_REGISTRY_INVALID_REQUEST_ERROR_CODE = 'invalid_request'
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
  connectorHub?: McpConnectorHub
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
  const connectorHub = options.connectorHub ?? createMcpConnectorHub({
    now,
    publishEvent: options.publishEvent,
  })
  let runtimeSnapshotRevision: number | null = null

  return {
    async loadRegistry(request) {
      const snapshot = await options.store.load()
      const revisions = resolveRuntimeRevisions(snapshot)
      await connectorHub.reconcile(snapshot.servers, revisions)
      return buildLoadResult(snapshot, request?.includeDisabled ?? true, connectorHub, revisions)
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

      const currentRevisions = resolveRuntimeRevisions(snapshot)
      const nextServers = upsertServer(snapshot.servers, normalized.server)
      const stored = await options.store.saveServers(nextServers, {
        snapshotRevision: currentRevisions.snapshotRevision,
      })

      let state: McpServerStateSummary | null
      let nextSnapshotRevision = currentRevisions.snapshotRevision

      if (normalized.server.enabled) {
        const reconcileResult = await connectorHub.reconcile(stored.servers, {
          registryRevision: stored.registryRevision,
          snapshotRevision: currentRevisions.snapshotRevision,
        })
        state = reconcileResult.states.find((entry) => entry.serverId === normalized.server.serverId)
          ?? connectorHub.getState(normalized.server.serverId)
          ?? createDefaultServerState(normalized.server)

        if (state.connectionState === 'connected' || state.connectionState === 'degraded') {
          nextSnapshotRevision = bumpRuntimeSnapshotRevision(currentRevisions.snapshotRevision)
        }
      } else {
        state = await connectorHub.setServerDisabled(normalized.server, {
          registryRevision: stored.registryRevision,
          snapshotRevision: currentRevisions.snapshotRevision,
        })

        if (existing?.enabled === true) {
          nextSnapshotRevision = bumpRuntimeSnapshotRevision(currentRevisions.snapshotRevision)
        }
      }

      runtimeSnapshotRevision = nextSnapshotRevision
      await publishSnapshotEvent(
        stored,
        connectorHub,
        options.publishEvent,
        nextSnapshotRevision,
      )

      return {
        ok: true,
        registryRevision: stored.registryRevision,
        snapshotRevision: nextSnapshotRevision,
        server: normalized.server,
        state,
        validationErrors: [],
      }
    },
    async deleteServer(serverId) {
      const snapshot = await options.store.load()
      const existing = snapshot.servers.find((server) => server.serverId === serverId)
      if (existing === undefined) {
        return createMcpRegistryApiFailure(
          `MCP server "${serverId}" was not found.`,
          MCP_REGISTRY_NOT_FOUND_ERROR_CODE,
        )
      }

      const currentRevisions = resolveRuntimeRevisions(snapshot)
      const stored = await options.store.saveServers(
        snapshot.servers.filter((server) => server.serverId !== serverId),
        { snapshotRevision: currentRevisions.snapshotRevision },
      )
      await connectorHub.removeServer(serverId, {
        registryRevision: stored.registryRevision,
        snapshotRevision: currentRevisions.snapshotRevision,
      })

      const nextSnapshotRevision = existing.enabled
        ? bumpRuntimeSnapshotRevision(currentRevisions.snapshotRevision)
        : currentRevisions.snapshotRevision
      runtimeSnapshotRevision = nextSnapshotRevision
      await publishSnapshotEvent(stored, connectorHub, options.publishEvent, nextSnapshotRevision)

      return {
        ok: true,
        registryRevision: stored.registryRevision,
        snapshotRevision: nextSnapshotRevision,
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
      const currentRevisions = resolveRuntimeRevisions(snapshot)
      const stored = await options.store.saveServers(
        upsertServer(snapshot.servers, updatedServer),
        { snapshotRevision: currentRevisions.snapshotRevision },
      )

      let state: McpServerStateSummary
      let nextSnapshotRevision = currentRevisions.snapshotRevision

      if (request.enabled) {
        const reconcileResult = await connectorHub.reconcile(stored.servers, {
          registryRevision: stored.registryRevision,
          snapshotRevision: currentRevisions.snapshotRevision,
        })
        state = reconcileResult.states.find((entry) => entry.serverId === updatedServer.serverId)
          ?? connectorHub.getState(updatedServer.serverId)
          ?? createDefaultServerState(updatedServer)

        if (state.connectionState === 'connected' || state.connectionState === 'degraded') {
          nextSnapshotRevision = bumpRuntimeSnapshotRevision(currentRevisions.snapshotRevision)
        }
      } else {
        state = await connectorHub.setServerDisabled(updatedServer, {
          registryRevision: stored.registryRevision,
          snapshotRevision: currentRevisions.snapshotRevision,
        })
        if (existing.enabled) {
          nextSnapshotRevision = bumpRuntimeSnapshotRevision(currentRevisions.snapshotRevision)
        }
      }

      runtimeSnapshotRevision = nextSnapshotRevision
      await publishSnapshotEvent(stored, connectorHub, options.publishEvent, nextSnapshotRevision)

      return {
        ok: true,
        registryRevision: stored.registryRevision,
        snapshotRevision: nextSnapshotRevision,
        server: updatedServer,
        state,
      }
    },
    async testConnection(request) {
      const startedAt = Date.now()
      const resolved = await resolveConnectionTestTarget(request, options.store, now())
      if (!resolved.ok) {
        return resolved.failure
      }

      const result = await connectorHub.testConnection(resolved.server)
      return {
        ok: true,
        success: result.success,
        transportKind: result.transportKind,
        toolCount: result.toolCount,
        durationMs: Math.max(result.durationMs, Date.now() - startedAt),
        error: result.error,
        warnings: result.warnings,
      }
    },
    async refreshCatalog(request) {
      const snapshot = await options.store.load()
      const currentRevisions = resolveRuntimeRevisions(snapshot)
      await connectorHub.reconcile(snapshot.servers, currentRevisions)

      const resolvedTargets = resolveRefreshTargets(snapshot, request)
      if (!resolvedTargets.ok) {
        return resolvedTargets.failure
      }

      const disabledResults = resolvedTargets.servers
        .filter((server) => !server.enabled)
        .map((server) => createDisabledRefreshCatalogServerResult(server, now()))
      const enabledServers = resolvedTargets.servers.filter((server) => server.enabled)
      const refreshed = enabledServers.length === 0
        ? []
        : await connectorHub.refreshCatalog(
            enabledServers.map((server) => server.serverId),
            currentRevisions,
          )

      const hasSuccessfulRefresh = refreshed.some((entry) => entry.success)
      const nextSnapshotRevision = hasSuccessfulRefresh
        ? bumpRuntimeSnapshotRevision(currentRevisions.snapshotRevision)
        : currentRevisions.snapshotRevision
      runtimeSnapshotRevision = nextSnapshotRevision

      const results: McpRefreshCatalogServerResult[] = [
        ...refreshed.map((entry) => ({
          serverId: entry.serverId,
          toolCount: entry.toolCount,
          connectionState: entry.state.connectionState,
          error: entry.error,
        })),
        ...disabledResults,
      ].sort((left, right) => left.serverId.localeCompare(right.serverId, 'en'))

      await options.publishEvent?.({
        kind: 'catalog',
        registryRevision: snapshot.registryRevision,
        snapshotRevision: nextSnapshotRevision,
        refreshedServerIds: results.map((entry) => entry.serverId),
        serverId: request?.serverId ?? null,
      })
      await publishSnapshotEvent(snapshot, connectorHub, options.publishEvent, nextSnapshotRevision)

      return {
        ok: true,
        registryRevision: snapshot.registryRevision,
        snapshotRevision: nextSnapshotRevision,
        refreshedServerIds: results.map((entry) => entry.serverId),
        results,
      }
    },
  }

  function resolveRuntimeRevisions(snapshot: McpRegistryStoreSnapshot): McpConnectorHubRevisionState {
    runtimeSnapshotRevision = runtimeSnapshotRevision === null
      ? snapshot.snapshotRevision
      : Math.max(runtimeSnapshotRevision, snapshot.snapshotRevision)

    return {
      registryRevision: snapshot.registryRevision,
      snapshotRevision: runtimeSnapshotRevision,
    }
  }

  function bumpRuntimeSnapshotRevision(baseRevision: number): number {
    return Math.max(runtimeSnapshotRevision ?? 0, baseRevision) + 1
  }
}

function buildLoadResult(
  snapshot: McpRegistryStoreSnapshot,
  includeDisabled: boolean,
  connectorHub: McpConnectorHub,
  revisions: McpConnectorHubRevisionState,
): McpRegistryLoadResult {
  const visibleServers = includeDisabled
    ? snapshot.servers
    : snapshot.servers.filter((server) => server.enabled)
  const states = connectorHub.getAllStates(snapshot.servers)
  const stateById = new Map(states.map((state) => [state.serverId, state]))

  return {
    ok: true,
    registryRevision: snapshot.registryRevision,
    snapshotRevision: revisions.snapshotRevision,
    servers: visibleServers.map(cloneServerRecord),
    states: visibleServers.map((server) => {
      const state = stateById.get(server.serverId)
      return state === undefined ? createDefaultServerState(server) : cloneStateSummary(state)
    }),
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
    servers: snapshot.servers.map(cloneServerRecord),
  }
}

function createDisabledRefreshCatalogServerResult(
  server: McpServerRecord,
  timestamp: string,
): McpRefreshCatalogServerResult {
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

async function publishSnapshotEvent(
  snapshot: McpRegistryStoreSnapshot,
  connectorHub: McpConnectorHub,
  publishEvent: ((event: McpRegistrySubscriptionEvent) => void | Promise<void>) | undefined,
  snapshotRevision: number,
): Promise<void> {
  if (publishEvent === undefined) {
    return
  }

  await publishEvent({
    kind: 'snapshot',
    registryRevision: snapshot.registryRevision,
    snapshotRevision,
    servers: snapshot.servers.map(cloneServerRecord),
    states: connectorHub.getAllStates(snapshot.servers).map(cloneStateSummary),
  })
}

function createDefaultServerState(server: McpServerRecord): McpServerStateSummary {
  return createConnectorState(server, server.enabled ? 'idle' : 'disabled', 0, () => new Date().toISOString())
}

function cloneStateSummary(state: McpServerStateSummary): McpServerStateSummary {
  return {
    ...state,
    lastError: state.lastError === undefined || state.lastError === null
      ? state.lastError ?? null
      : {
          ...state.lastError,
          ...(state.lastError.details === undefined || state.lastError.details === null
            ? { details: state.lastError.details ?? null }
            : { details: { ...state.lastError.details } }),
        },
    transportState: state.transportState === undefined || state.transportState === null
      ? state.transportState ?? null
      : { ...state.transportState },
  }
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
