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
import type { ManagedRuntimeService } from '../managed-runtime/ManagedRuntimeService'
import type { McpRegistryStore, McpRegistryStoreSnapshot } from './store'
import {
  createMcpCapabilitySnapshot,
  buildMcpToolId,
  type McpCapabilitySnapshotSink,
} from './snapshot'
import type {
  McpRefreshCatalogServerResult,
  McpRegistrySubscriptionEvent,
  McpServerDraft,
  McpServerRecord,
  McpServerStateSummary,
  McpToolCallFailure,
  McpToolCallRequest,
  McpToolCallResult,
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
  warmupEnabledServersOnStartup(): Promise<void>
  executeTool(request: McpToolCallRequest): Promise<McpToolCallResult>
}

export interface CreateMcpRegistryServiceOptions {
  store: McpRegistryStore
  managedRuntimeService?: ManagedRuntimeService
  connectorHub?: McpConnectorHub
  snapshotSink?: McpCapabilitySnapshotSink
  now?: () => string
  publishEvent?: (event: McpRegistrySubscriptionEvent) => void | Promise<void>
  appendLog?: (
    level: 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown> | null,
  ) => void | Promise<void>
}

interface ServiceContext {
  options: CreateMcpRegistryServiceOptions
  now: () => string
  resolvedCommandMetadata: Map<string, {
    requestedCommand: string
    resolutionKind: 'raw' | 'managed'
    managedFamily?: 'node' | 'uv'
  }>
  connectorHub: McpConnectorHub
  runtimeSnapshotRevision: number | null
}

export function createMcpRegistryService(
  options: CreateMcpRegistryServiceOptions,
): McpRegistryService {
  const ctx: ServiceContext = {
    options,
    now: options.now ?? (() => new Date().toISOString()),
    resolvedCommandMetadata: new Map(),
    connectorHub: options.connectorHub ?? createMcpConnectorHub({
      now: options.now ?? (() => new Date().toISOString()),
      publishEvent: options.publishEvent,
      getResolvedCommand(server) {
        return ctx.resolvedCommandMetadata.get(server.serverId) ?? null
      },
    }),
    runtimeSnapshotRevision: null,
  }

  return {
    loadRegistry: (request) => serviceLoadRegistry(ctx, request),
    saveServer: (draft) => serviceSaveServer(ctx, draft),
    deleteServer: (serverId) => serviceDeleteServer(ctx, serverId),
    setServerEnabled: (request) => serviceSetServerEnabled(ctx, request),
    testConnection: (request) => serviceTestConnection(ctx, request),
    refreshCatalog: (request) => serviceRefreshCatalog(ctx, request),
    warmupEnabledServersOnStartup: () => serviceWarmup(ctx),
    executeTool: (request) => serviceExecuteTool(ctx, request),
  }
}

async function servicePersistSnapshotArtifacts(
  ctx: ServiceContext,
  snapshot: McpRegistryStoreSnapshot,
  snapshotRevision: number,
): Promise<McpRegistryStoreSnapshot> {
  let persistedSnapshot = overrideSnapshotRevision(snapshot, snapshotRevision)

  if (snapshot.snapshotRevision !== snapshotRevision) {
    try {
      persistedSnapshot = await ctx.options.store.saveSnapshotRevision(snapshotRevision)
    } catch (error) {
      await ctx.options.appendLog?.('error', '[mcp-registry] Failed to persist the MCP snapshot revision.', {
        registryRevision: snapshot.registryRevision,
        snapshotRevision,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (ctx.options.snapshotSink !== undefined) {
    try {
      const states = ctx.connectorHub.getAllStates(persistedSnapshot.servers)
      const capabilitySnapshot = createMcpCapabilitySnapshot({
        registryRevision: persistedSnapshot.registryRevision,
        snapshotRevision,
        generatedAt: ctx.now(),
        servers: persistedSnapshot.servers,
        states,
        toolsByServerId: new Map(
          persistedSnapshot.servers.map((server) => [
            server.serverId,
            ctx.connectorHub.getTools(server.serverId),
          ]),
        ),
      })
      await ctx.options.snapshotSink.write(capabilitySnapshot)
    } catch (error) {
      await ctx.options.appendLog?.('error', '[mcp-registry] Failed to persist the MCP capability snapshot.', {
        registryRevision: snapshot.registryRevision,
        snapshotRevision,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return persistedSnapshot
}

async function serviceLoadRegistry(
  ctx: ServiceContext,
  request?: McpRegistryLoadRequest,
): Promise<McpRegistryLoadResult> {
  const snapshot = await ctx.options.store.load()
  const revisions = serviceResolveRuntimeRevisions(ctx, snapshot)
  await ctx.connectorHub.reconcile(await serviceResolveManagedServers(ctx, snapshot.servers), revisions)
  const persistedSnapshot = await servicePersistSnapshotArtifacts(ctx, snapshot, revisions.snapshotRevision)
  return buildLoadResult(persistedSnapshot, request?.includeDisabled ?? true, ctx.connectorHub, revisions)
}

async function serviceSaveServer(
  ctx: ServiceContext,
  draft: McpServerDraft,
): Promise<McpSaveServerResult> {
  const snapshot = await ctx.options.store.load()
  const existing = snapshot.servers.find((server) => server.serverId === draft.serverId)
  const normalized = normalizeDraft(draft, existing, ctx.now())

  if (!normalized.ok) {
    return createMcpRegistryApiFailure(
      'MCP server draft failed validation.',
      MCP_REGISTRY_VALIDATION_ERROR_CODE,
      normalized.validationErrors,
    )
  }

  const currentRevisions = serviceResolveRuntimeRevisions(ctx, snapshot)
  const nextServers = upsertServer(snapshot.servers, normalized.server)
  const stored = await ctx.options.store.saveServers(nextServers, {
    snapshotRevision: currentRevisions.snapshotRevision,
  })

  const synchronization = normalized.server.enabled
    ? await serviceSynchronizeSavedEnabledServer(ctx, stored, normalized.server.serverId, currentRevisions.snapshotRevision)
    : await serviceSynchronizeDisabledServer(ctx, stored, { server: normalized.server, baseSnapshotRevision: currentRevisions.snapshotRevision, shouldBumpSnapshot: existing?.enabled === true })

  return {
    ok: true,
    registryRevision: stored.registryRevision,
    snapshotRevision: synchronization.snapshotRevision,
    server: normalized.server,
    state: synchronization.state,
    validationErrors: [],
  }
}

async function serviceDeleteServer(
  ctx: ServiceContext,
  serverId: string,
): Promise<McpDeleteServerResult> {
  const snapshot = await ctx.options.store.load()
  const existing = snapshot.servers.find((server) => server.serverId === serverId)
  if (existing === undefined) {
    return createMcpRegistryApiFailure(
      `MCP server "${serverId}" was not found.`,
      MCP_REGISTRY_NOT_FOUND_ERROR_CODE,
    )
  }

  const currentRevisions = serviceResolveRuntimeRevisions(ctx, snapshot)
  const stored = await ctx.options.store.saveServers(
    snapshot.servers.filter((server) => server.serverId !== serverId),
    { snapshotRevision: currentRevisions.snapshotRevision },
  )
  await ctx.connectorHub.removeServer(serverId, {
    registryRevision: stored.registryRevision,
    snapshotRevision: currentRevisions.snapshotRevision,
  })

  const nextSnapshotRevision = existing.enabled
    ? serviceBumpRuntimeSnapshotRevision(ctx, currentRevisions.snapshotRevision)
    : currentRevisions.snapshotRevision
  ctx.runtimeSnapshotRevision = nextSnapshotRevision
  const persistedSnapshot = await servicePersistSnapshotArtifacts(ctx, stored, nextSnapshotRevision)
  await publishSnapshotEvent(persistedSnapshot, ctx.connectorHub, ctx.options.publishEvent, nextSnapshotRevision)

  return {
    ok: true,
    registryRevision: stored.registryRevision,
    snapshotRevision: nextSnapshotRevision,
    serverId,
    deleted: true,
  }
}

async function serviceSetServerEnabled(
  ctx: ServiceContext,
  request: McpSetServerEnabledRequest,
): Promise<McpSetServerEnabledResult> {
  const snapshot = await ctx.options.store.load()
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
    updatedAt: ctx.now(),
  }
  const currentRevisions = serviceResolveRuntimeRevisions(ctx, snapshot)
  const stored = await ctx.options.store.saveServers(
    upsertServer(snapshot.servers, updatedServer),
    { snapshotRevision: currentRevisions.snapshotRevision },
  )

  const synchronization = request.enabled
    ? await serviceSynchronizeSavedEnabledServer(ctx, stored, updatedServer.serverId, currentRevisions.snapshotRevision)
    : await serviceSynchronizeDisabledServer(ctx, stored, { server: updatedServer, baseSnapshotRevision: currentRevisions.snapshotRevision, shouldBumpSnapshot: existing.enabled })

  return {
    ok: true,
    registryRevision: stored.registryRevision,
    snapshotRevision: synchronization.snapshotRevision,
    server: updatedServer,
    state: synchronization.state,
  }
}

async function serviceTestConnection(
  ctx: ServiceContext,
  request: McpTestConnectionRequest,
): Promise<McpTestConnectionResult> {
  const startedAt = Date.now()
  const resolved = await resolveConnectionTestTarget(request, ctx.options.store, ctx.now())
  if (!resolved.ok) {
    return resolved.failure
  }

  const result = await ctx.connectorHub.testConnection(await serviceResolveManagedTransportConfig(ctx, resolved.server))
  if (!result.success) {
    await ctx.options.appendLog?.('warn', '[mcp-registry] MCP testConnection failed.', {
      serverId: resolved.server.serverId,
      transportKind: result.transportKind,
      phase: result.phase,
      errorCode: result.error?.code ?? null,
      retryable: result.error?.retryable ?? null,
      diagnosticSummary: result.diagnosticSummary,
      stderrSummary: typeof result.error?.details?.stderrSummary === 'string'
        ? result.error.details.stderrSummary
        : null,
    })
  } else if (typeof request.serverId === 'string' && request.serverId.trim() !== '') {
    await serviceSynchronizeConnectedServerAfterSuccessfulTest(ctx, request.serverId)
  }

  return {
    ok: true,
    success: result.success,
    transportKind: result.transportKind,
    toolCount: result.toolCount,
    durationMs: Math.max(result.durationMs, Date.now() - startedAt),
    phase: result.phase,
    diagnosticSummary: result.diagnosticSummary,
    error: result.error,
    warnings: result.warnings,
  }
}

async function serviceRefreshCatalog(
  ctx: ServiceContext,
  request?: McpRefreshCatalogRequest,
): Promise<McpRefreshCatalogResult> {
  const snapshot = await ctx.options.store.load()
  const currentRevisions = serviceResolveRuntimeRevisions(ctx, snapshot)
  await ctx.connectorHub.reconcile(await serviceResolveManagedServers(ctx, snapshot.servers), currentRevisions)

  const resolvedTargets = resolveRefreshTargets(snapshot, request)
  if (!resolvedTargets.ok) {
    return resolvedTargets.failure
  }

  const disabledResults = resolvedTargets.servers
    .filter((server) => !server.enabled)
    .map((server) => createDisabledRefreshCatalogServerResult(server, ctx.now()))
  const enabledServers = resolvedTargets.servers.filter((server) => server.enabled)
  const refreshed = enabledServers.length === 0
    ? []
    : await ctx.connectorHub.refreshCatalog(
        enabledServers.map((server) => server.serverId),
        currentRevisions,
      )

  const hasSuccessfulRefresh = refreshed.some((entry) => entry.success)
  const nextSnapshotRevision = hasSuccessfulRefresh
    ? serviceBumpRuntimeSnapshotRevision(ctx, currentRevisions.snapshotRevision)
    : currentRevisions.snapshotRevision
  ctx.runtimeSnapshotRevision = nextSnapshotRevision

  const results: McpRefreshCatalogServerResult[] = [
    ...refreshed.map((entry) => ({
      serverId: entry.serverId,
      toolCount: entry.toolCount,
      connectionState: entry.state.connectionState,
      error: entry.error,
    })),
    ...disabledResults,
  ].sort((left, right) => left.serverId.localeCompare(right.serverId, 'en'))

  await ctx.options.publishEvent?.({
    kind: 'catalog',
    registryRevision: snapshot.registryRevision,
    snapshotRevision: nextSnapshotRevision,
    refreshedServerIds: results.map((entry) => entry.serverId),
    serverId: request?.serverId ?? null,
  })
  const persistedSnapshot = await servicePersistSnapshotArtifacts(ctx, snapshot, nextSnapshotRevision)
  await publishSnapshotEvent(persistedSnapshot, ctx.connectorHub, ctx.options.publishEvent, nextSnapshotRevision)

  return {
    ok: true,
    registryRevision: snapshot.registryRevision,
    snapshotRevision: nextSnapshotRevision,
    refreshedServerIds: results.map((entry) => entry.serverId),
    results,
  }
}

async function serviceWarmup(ctx: ServiceContext): Promise<void> {
  const snapshot = await ctx.options.store.load()
  const currentRevisions = serviceResolveRuntimeRevisions(ctx, snapshot)
  await ctx.connectorHub.reconcile(await serviceResolveManagedServers(ctx, snapshot.servers), currentRevisions)

  const enabledServers = snapshot.servers.filter((server) => server.enabled)
  if (enabledServers.length === 0) {
    const persistedSnapshot = await servicePersistSnapshotArtifacts(ctx, snapshot, currentRevisions.snapshotRevision)
    await publishSnapshotEvent(persistedSnapshot, ctx.connectorHub, ctx.options.publishEvent, currentRevisions.snapshotRevision)
    return
  }

  const refreshed = await ctx.connectorHub.refreshCatalog(
    enabledServers.map((server) => server.serverId),
    currentRevisions,
  )
  const nextSnapshotRevision = refreshed.length > 0
    ? serviceBumpRuntimeSnapshotRevision(ctx, currentRevisions.snapshotRevision)
    : currentRevisions.snapshotRevision

  ctx.runtimeSnapshotRevision = nextSnapshotRevision

  await ctx.options.publishEvent?.({
    kind: 'catalog',
    registryRevision: snapshot.registryRevision,
    snapshotRevision: nextSnapshotRevision,
    refreshedServerIds: refreshed.map((entry) => entry.serverId),
    serverId: null,
  })

  const persistedSnapshot = await servicePersistSnapshotArtifacts(ctx, snapshot, nextSnapshotRevision)
  await publishSnapshotEvent(persistedSnapshot, ctx.connectorHub, ctx.options.publishEvent, nextSnapshotRevision)

  await ctx.options.appendLog?.(
    refreshed.some((entry) => entry.success) ? 'info' : 'warn',
    refreshed.some((entry) => entry.success)
      ? '[mcp-registry] Warmed enabled MCP servers during application startup.'
      : '[mcp-registry] Completed MCP startup warmup without a successful catalog sync.',
    {
      registryRevision: snapshot.registryRevision,
      snapshotRevision: nextSnapshotRevision,
      enabledServerCount: enabledServers.length,
      refreshedServerIds: refreshed.map((entry) => entry.serverId),
      successfulServerIds: refreshed.filter((entry) => entry.success).map((entry) => entry.serverId),
      failedServerIds: refreshed.filter((entry) => !entry.success).map((entry) => entry.serverId),
    },
  )
}

async function serviceExecuteTool(
  ctx: ServiceContext,
  request: McpToolCallRequest,
): Promise<McpToolCallResult> {
  const snapshot = await ctx.options.store.load()
  const currentRevisions = serviceResolveRuntimeRevisions(ctx, snapshot)
  await ctx.connectorHub.reconcile(await serviceResolveManagedServers(ctx, snapshot.servers), currentRevisions)

  const resolved = resolveToolCallTarget(
    snapshot,
    ctx.connectorHub,
    request,
    { currentSnapshotRevision: currentRevisions.snapshotRevision, now: ctx.now },
  )
  if (!resolved.ok) {
    return resolved.failure
  }

  return await ctx.connectorHub.callTool(resolved.request)
}

async function serviceSynchronizeConnectedServerAfterSuccessfulTest(
  ctx: ServiceContext,
  serverId: string,
): Promise<void> {
  const snapshot = await ctx.options.store.load()
  const currentRevisions = serviceResolveRuntimeRevisions(ctx, snapshot)
  const targetServer = snapshot.servers.find((server) => server.serverId === serverId)

  if (targetServer === undefined || !targetServer.enabled) {
    return
  }

  await ctx.connectorHub.reconcile(await serviceResolveManagedServers(ctx, snapshot.servers), currentRevisions)

  const reconciledState = ctx.connectorHub.getState(serverId)
  const canReuseManagedCatalog = reconciledState?.connectionState === 'connected'
    && reconciledState.lastCatalogSyncAt !== null

  const refreshedTarget = canReuseManagedCatalog
    ? null
    : (await ctx.connectorHub.refreshCatalog([serverId], currentRevisions)).find((entry) => entry.serverId === serverId) ?? null
  const connectedState = ctx.connectorHub.getState(serverId)
  const shouldPublishSnapshot = refreshedTarget?.success === true
    || connectedState?.connectionState === 'connected'
    || connectedState?.connectionState === 'degraded'

  if (!shouldPublishSnapshot) {
    return
  }

  const nextSnapshotRevision = serviceBumpRuntimeSnapshotRevision(ctx, currentRevisions.snapshotRevision)
  ctx.runtimeSnapshotRevision = nextSnapshotRevision

  await ctx.options.publishEvent?.({
    kind: 'catalog',
    registryRevision: snapshot.registryRevision,
    snapshotRevision: nextSnapshotRevision,
    refreshedServerIds: [serverId],
    serverId,
  })

  const persistedSnapshot = await servicePersistSnapshotArtifacts(ctx, snapshot, nextSnapshotRevision)
  await publishSnapshotEvent(persistedSnapshot, ctx.connectorHub, ctx.options.publishEvent, nextSnapshotRevision)
}

async function serviceSynchronizeSavedEnabledServer(
  ctx: ServiceContext,
  snapshot: McpRegistryStoreSnapshot,
  serverId: string,
  baseSnapshotRevision: number,
): Promise<{ state: McpServerStateSummary, snapshotRevision: number }> {
  const revisions = {
    registryRevision: snapshot.registryRevision,
    snapshotRevision: baseSnapshotRevision,
  }
  const reconcileResult = await ctx.connectorHub.reconcile(await serviceResolveManagedServers(ctx, snapshot.servers), revisions)
  const state = reconcileResult.states.find((entry) => entry.serverId === serverId)
    ?? ctx.connectorHub.getState(serverId)
    ?? createDefaultServerState(
      snapshot.servers.find((server) => server.serverId === serverId)
        ?? createPlaceholderServerRecord(serverId, ctx.now()),
    )

  const connected = state.connectionState === 'connected' || state.connectionState === 'degraded'
  const hasHydratedCatalog = state.lastCatalogSyncAt !== null && ctx.connectorHub.getTools(serverId).length > 0

  const refreshedTarget = connected && !hasHydratedCatalog
    ? (await ctx.connectorHub.refreshCatalog([serverId], revisions)).find((entry) => entry.serverId === serverId) ?? null
    : null
  const finalState = ctx.connectorHub.getState(serverId) ?? state
  const finalStateConnected = finalState.connectionState === 'connected' || finalState.connectionState === 'degraded'
  const shouldPublishCatalog = finalStateConnected || refreshedTarget?.success === true
  const shouldBumpSnapshot = shouldPublishCatalog || finalState.connectionState === 'disabled' || finalState.connectionState === 'error'
  const nextSnapshotRevision = shouldBumpSnapshot
    ? serviceBumpRuntimeSnapshotRevision(ctx, baseSnapshotRevision)
    : baseSnapshotRevision

  ctx.runtimeSnapshotRevision = nextSnapshotRevision

  if (shouldPublishCatalog) {
    await ctx.options.publishEvent?.({
      kind: 'catalog',
      registryRevision: snapshot.registryRevision,
      snapshotRevision: nextSnapshotRevision,
      refreshedServerIds: [serverId],
      serverId,
    })
  }

  const persistedSnapshot = await servicePersistSnapshotArtifacts(ctx, snapshot, nextSnapshotRevision)
  await publishSnapshotEvent(persistedSnapshot, ctx.connectorHub, ctx.options.publishEvent, nextSnapshotRevision)

  return {
    state: finalState,
    snapshotRevision: nextSnapshotRevision,
  }
}

async function serviceSynchronizeDisabledServer(
  ctx: ServiceContext,
  snapshot: McpRegistryStoreSnapshot,
  options: { server: McpServerRecord, baseSnapshotRevision: number, shouldBumpSnapshot: boolean },
): Promise<{ state: McpServerStateSummary, snapshotRevision: number }> {
  const state = await ctx.connectorHub.setServerDisabled(options.server, {
    registryRevision: snapshot.registryRevision,
    snapshotRevision: options.baseSnapshotRevision,
  })
  const nextSnapshotRevision = options.shouldBumpSnapshot
    ? serviceBumpRuntimeSnapshotRevision(ctx, options.baseSnapshotRevision)
    : options.baseSnapshotRevision

  ctx.runtimeSnapshotRevision = nextSnapshotRevision
  const persistedSnapshot = await servicePersistSnapshotArtifacts(ctx, snapshot, nextSnapshotRevision)
  await publishSnapshotEvent(persistedSnapshot, ctx.connectorHub, ctx.options.publishEvent, nextSnapshotRevision)

  return {
    state,
    snapshotRevision: nextSnapshotRevision,
  }
}

function serviceResolveRuntimeRevisions(
  ctx: ServiceContext,
  snapshot: McpRegistryStoreSnapshot,
): McpConnectorHubRevisionState {
  ctx.runtimeSnapshotRevision = ctx.runtimeSnapshotRevision === null
    ? snapshot.snapshotRevision
    : Math.max(ctx.runtimeSnapshotRevision, snapshot.snapshotRevision)

  return {
    registryRevision: snapshot.registryRevision,
    snapshotRevision: ctx.runtimeSnapshotRevision,
  }
}

function serviceBumpRuntimeSnapshotRevision(ctx: ServiceContext, baseRevision: number): number {
  return Math.max(ctx.runtimeSnapshotRevision ?? 0, baseRevision) + 1
}

async function serviceResolveManagedTransportConfig(
  ctx: ServiceContext,
  server: McpServerRecord,
): Promise<McpServerRecord> {
  if (server.transportConfig.kind !== 'stdio' || ctx.options.managedRuntimeService === undefined) {
    ctx.resolvedCommandMetadata.set(server.serverId, {
      requestedCommand: server.transportConfig.kind === 'stdio' ? server.transportConfig.command : '',
      resolutionKind: 'raw',
    })
    return cloneServerRecord(server)
  }

  const resolution = await ctx.options.managedRuntimeService.resolveLauncher(server.transportConfig.command)
  if (!resolution.ok) {
    ctx.resolvedCommandMetadata.set(server.serverId, {
      requestedCommand: server.transportConfig.command,
      resolutionKind: 'raw',
    })
    if (resolution.reason !== 'managed_runtime_unavailable') {
      return cloneServerRecord(server)
    }

    return createManagedUnavailableServer(server, resolution.message ?? 'Managed runtime is unavailable.', ctx.now, {
      requestedCommand: server.transportConfig.command,
      normalizedCommand: resolution.normalizedCommand ?? null,
      managedFamily: resolution.family ?? null,
      managedRuntimeStatus: resolution.status ?? null,
      detail: resolution.detail ?? null,
    })
  }

  ctx.resolvedCommandMetadata.set(server.serverId, {
    requestedCommand: server.transportConfig.command,
    resolutionKind: 'managed',
    managedFamily: resolution.family,
  })

  const nextArgs = resolution.windowsCommandChain === null
    ? [...server.transportConfig.args]
    : [...resolution.windowsCommandChain.argsPrefix, ...server.transportConfig.args]
  const nextCommand = resolution.windowsCommandChain?.command ?? resolution.executablePath

  return {
    ...cloneServerRecord(server),
    transportConfig: {
      ...server.transportConfig,
      command: nextCommand,
      args: nextArgs,
    },
  }
}

async function serviceResolveManagedServers(
  ctx: ServiceContext,
  servers: readonly McpServerRecord[],
): Promise<McpServerRecord[]> {
  return await Promise.all(servers.map(async (server) => await serviceResolveManagedTransportConfig(ctx, server)))
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

function createManagedUnavailableServer(
  server: McpServerRecord,
  message: string,
  now: () => string,
  details: Record<string, unknown>,
): McpServerRecord {
  if (server.transportConfig.kind !== 'stdio') {
    return cloneServerRecord(server)
  }

  return {
    ...cloneServerRecord(server),
    transportConfig: {
      ...server.transportConfig,
      command: '__managed_runtime_unavailable__',
      args: [],
      env: {
        ...(server.transportConfig.env ?? {}),
        CANDUE_MANAGED_RUNTIME_ERROR: JSON.stringify({
          message,
          observedAt: now(),
          details,
        }),
      },
    },
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

interface ResolveServerNotReadyOptions {
  requestedServer: McpServerRecord | undefined
  requestedState: McpServerStateSummary | null
  requestedConnectorToolCount: number
  currentSnapshotRevision: number
  now: () => string
}

function resolveServerNotReady(
  request: McpToolCallRequest,
  options: ResolveServerNotReadyOptions,
): { ok: false, failure: McpToolCallFailure } | null {
  const { requestedServer, requestedState, requestedConnectorToolCount, currentSnapshotRevision, now } = options
  if (
    requestedServer !== undefined
    && (!requestedServer.enabled || (requestedState !== null && requestedState.connectionState !== 'connected' && requestedState.connectionState !== 'degraded'))
  ) {
    return {
      ok: false,
      failure: createToolCallFailure(request, {
        code: 'server_not_ready',
        message: 'The MCP server is not ready to execute tools.',
        retryable: true,
        details: {
          requestedServerId: requestedServer.serverId,
          requestedRemoteToolName: typeof request.remoteToolName === 'string' ? request.remoteToolName.trim() : '',
          connectionState: requestedState?.connectionState ?? 'disabled',
          connectorToolCount: requestedConnectorToolCount,
          requestedSnapshotRevision: request.snapshotRevision ?? null,
          snapshotRevision: currentSnapshotRevision,
        },
        now,
      }),
    }
  }

  return null
}

interface RequestedTargetContext {
  requestedServerId: string
  requestedRemoteToolName: string
  requestedServer: McpServerRecord | undefined
  requestedState: McpServerStateSummary | null
  requestedConnectorToolCount: number
}

function tryResolveByRequestedTool(
  request: McpToolCallRequest,
  connectorHub: McpConnectorHub,
  ctx: RequestedTargetContext,
  currentSnapshotRevision: number,
): { ok: true, request: McpToolCallRequest } | null {
  if (ctx.requestedServerId === '' || ctx.requestedRemoteToolName === '') {
    return null
  }

  const hasRequestedTool = connectorHub
    .getTools(ctx.requestedServerId)
    .some((tool) => tool.name === ctx.requestedRemoteToolName)

  if (ctx.requestedServer !== undefined && hasRequestedTool) {
    return {
      ok: true,
      request: {
        ...request,
        serverId: ctx.requestedServer.serverId,
        remoteToolName: ctx.requestedRemoteToolName,
        snapshotRevision: currentSnapshotRevision,
      },
    }
  }

  if (
    ctx.requestedServer !== undefined
    && ctx.requestedConnectorToolCount === 0
    && ctx.requestedServer.enabled
    && (ctx.requestedState === null
      || ctx.requestedState.connectionState === 'connected'
      || ctx.requestedState.connectionState === 'degraded')
  ) {
    return {
      ok: true,
      request: {
        ...request,
        serverId: ctx.requestedServer.serverId,
        remoteToolName: ctx.requestedRemoteToolName,
        snapshotRevision: currentSnapshotRevision,
      },
    }
  }

  return null
}

interface ResolveToolCallTargetOptions {
  currentSnapshotRevision: number
  now: () => string
}

function resolveToolCallTarget(
  snapshot: McpRegistryStoreSnapshot,
  connectorHub: McpConnectorHub,
  request: McpToolCallRequest,
  options: ResolveToolCallTargetOptions,
):
  | { ok: true, request: McpToolCallRequest }
  | { ok: false, failure: McpToolCallFailure } {
  const { currentSnapshotRevision, now } = options
  const requestedServerId = typeof request.serverId === 'string' ? request.serverId.trim() : ''
  const requestedRemoteToolName = typeof request.remoteToolName === 'string' ? request.remoteToolName.trim() : ''
  const requestedServer = requestedServerId === ''
    ? undefined
    : snapshot.servers.find((server) => server.serverId === requestedServerId)
  const requestedState = requestedServer === undefined
    ? null
    : connectorHub.getState(requestedServer.serverId)
  const requestedConnectorToolCount = requestedServer === undefined
    ? 0
    : connectorHub.getTools(requestedServer.serverId).length

  const matchingTarget = findMatchingToolTarget(snapshot, connectorHub, request.toolId)
  if (matchingTarget !== undefined) {
    return {
      ok: true,
      request: {
        ...request,
        serverId: matchingTarget.server.serverId,
        remoteToolName: matchingTarget.tool.name,
        snapshotRevision: request.snapshotRevision ?? currentSnapshotRevision,
      },
    }
  }

  const targetContext: RequestedTargetContext = {
    requestedServerId,
    requestedRemoteToolName,
    requestedServer,
    requestedState,
    requestedConnectorToolCount,
  }

  const requestedResult = tryResolveByRequestedTool(request, connectorHub, targetContext, currentSnapshotRevision)
  if (requestedResult !== null) {
    return requestedResult
  }

  const notReadyResult = resolveServerNotReady(request, {
    requestedServer,
    requestedState,
    requestedConnectorToolCount,
    currentSnapshotRevision,
    now,
  })
  if (notReadyResult !== null) {
    return notReadyResult
  }

  const isDirectoryDrift = request.snapshotRevision !== undefined
    && request.snapshotRevision !== null
    && request.snapshotRevision !== currentSnapshotRevision

  return {
    ok: false,
    failure: createToolCallFailure(
      request,
      {
        code: isDirectoryDrift ? 'directory_drift' : 'tool_not_found',
        message: isDirectoryDrift
          ? 'The requested MCP tool no longer exists in the current snapshot.'
          : `The MCP tool '${request.toolId}' was not found.`,
        retryable: false,
        details: {
          requestedServerId,
          requestedRemoteToolName,
          connectorToolCount: requestedConnectorToolCount,
          requestedSnapshotRevision: request.snapshotRevision ?? null,
          snapshotRevision: currentSnapshotRevision,
        },
        now,
      },
    ),
  }
}

function findMatchingToolTarget(
  snapshot: McpRegistryStoreSnapshot,
  connectorHub: McpConnectorHub,
  toolId: string,
): { server: McpServerRecord, tool: { name: string } } | undefined {
  return snapshot.servers.flatMap((server) => connectorHub.getTools(server.serverId).map((tool) => ({
    server,
    tool,
    toolId: buildMcpToolId(server.serverId, tool.name),
  }))).find((entry) => entry.toolId === toolId)
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

function createPlaceholderServerRecord(serverId: string, timestamp: string): McpServerRecord {
  return {
    serverId,
    displayName: serverId,
    enabled: true,
    transportKind: 'stdio',
    transportConfig: {
      kind: 'stdio',
      command: 'unknown',
      args: [],
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    description: null,
  }
}

interface CreateToolCallFailureOptions {
  code: string
  message: string
  retryable: boolean
  details?: Record<string, unknown> | null
  now: () => string
}

function createToolCallFailure(
  request: McpToolCallRequest,
  options: CreateToolCallFailureOptions,
): McpToolCallFailure {
  return {
    ok: false,
    toolId: request.toolId,
    serverId: request.serverId,
    remoteToolName: request.remoteToolName,
    snapshotRevision: request.snapshotRevision ?? null,
    error: {
      code: options.code,
      message: options.message,
      retryable: options.retryable,
      observedAt: options.now(),
      details: options.details ?? null,
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
  return createConnectorState(server, server.enabled ? 'idle' : 'disabled', 0, {})
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

function overrideSnapshotRevision(
  snapshot: McpRegistryStoreSnapshot,
  snapshotRevision: number,
): McpRegistryStoreSnapshot {
  return {
    ...snapshot,
    snapshotRevision,
    servers: snapshot.servers.map(cloneServerRecord),
  }
}
