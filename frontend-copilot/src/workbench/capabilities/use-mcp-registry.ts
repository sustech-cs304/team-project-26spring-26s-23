import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  McpRegistrySubscriptionEvent,
  McpServerRecord,
  McpServerStateSummary,
  McpServerValidationError,
} from '../../../electron/mcp-registry/types'
import type { McpRegistryClient } from './mcp-registry-client'
import { createWindowMcpRegistryClient } from './mcp-registry-client'
import {
  buildMcpRegistryServerViewModels,
  formatMcpRefreshCatalogMessage,
  formatMcpTestConnectionMessage,
  parseMcpRegistryEditorValue,
  resolveMcpEditorSeed,
  type McpRegistryServerViewModel,
  type McpServerEditorMode,
} from './mcp-registry-view-model'

interface McpRegistryState {
  loadStatus: 'loading' | 'ready' | 'error'
  loadError: string | null
  registryRevision: number
  snapshotRevision: number
  servers: McpServerRecord[]
  states: McpServerStateSummary[]
  operationMessages: Record<string, string | null>
  busyServerIds: Record<string, boolean>
}

export type McpRegistryEditorSaveResult =
  | { ok: true }
  | { ok: false, errorMessage: string, validationErrors: McpServerValidationError[] }

export interface UseMcpRegistryResult {
  loadStatus: McpRegistryState['loadStatus']
  rawServers: readonly McpServerRecord[]
  servers: readonly McpRegistryServerViewModel[]
  statusMessage: string | null
  getEditorSeed: (mode: McpServerEditorMode) => string
  saveEditorDraft: (mode: McpServerEditorMode, value: string) => Promise<McpRegistryEditorSaveResult>
  toggleServerEnabled: (serverId: string) => Promise<void>
  deleteServer: (serverId: string) => Promise<void>
  testServerConnection: (serverId: string) => Promise<void>
  refreshServerCatalog: (serverId: string) => Promise<void>
}

const INITIAL_STATE: McpRegistryState = {
  loadStatus: 'loading',
  loadError: null,
  registryRevision: 0,
  snapshotRevision: 0,
  servers: [],
  states: [],
  operationMessages: {},
  busyServerIds: {},
}

export function useMcpRegistry(client?: McpRegistryClient): UseMcpRegistryResult {
  const resolvedClient = useMemo(() => client ?? createWindowMcpRegistryClient(), [client])
  const [registryState, setRegistryState] = useState<McpRegistryState>(INITIAL_STATE)

  useEffect(() => {
    let cancelled = false

    setRegistryState((previous) => ({ ...previous, loadStatus: 'loading', loadError: null }))

    void resolvedClient.loadRegistry({ includeDisabled: true }).then((result) => {
      if (cancelled) {
        return
      }

      setRegistryState((previous) => result.ok
        ? {
            ...previous,
            loadStatus: 'ready',
            loadError: null,
            registryRevision: result.registryRevision,
            snapshotRevision: result.snapshotRevision,
            servers: result.servers.map(cloneServerRecord),
            states: result.states.map(cloneStateSummary),
          }
        : { ...previous, loadStatus: 'error', loadError: result.error })
    })

    const unsubscribe = resolvedClient.subscribe((event) => {
      if (!cancelled) {
        setRegistryState((previous) => applyRegistrySubscriptionEvent(previous, event))
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [resolvedClient])

  const setServerBusy = useCallback((serverId: string, busy: boolean) => {
    setRegistryState((previous) => ({
      ...previous,
      busyServerIds: { ...previous.busyServerIds, [serverId]: busy },
    }))
  }, [])

  const setOperationMessage = useCallback((serverId: string, message: string | null) => {
    setRegistryState((previous) => ({
      ...previous,
      operationMessages: { ...previous.operationMessages, [serverId]: message },
    }))
  }, [])

  const saveEditorDraft = useCallback(async (
    mode: McpServerEditorMode,
    value: string,
  ): Promise<McpRegistryEditorSaveResult> => {
    const parsed = parseMcpRegistryEditorValue(mode, value)
    if (!parsed.ok) {
      return { ok: false, errorMessage: 'MCP 配置草稿校验失败。', validationErrors: parsed.validationErrors }
    }

    const existingServerIds = new Set(registryState.servers.map((server) => server.serverId))
    const nextServerIds = new Set(parsed.drafts.map((draft) => draft.serverId))

    for (const draft of parsed.drafts) {
      const saveResult = await resolvedClient.saveServer(draft)
      if (!saveResult.ok) {
        return {
          ok: false,
          errorMessage: saveResult.error,
          validationErrors: saveResult.validationErrors ?? [],
        }
      }

      setRegistryState((previous) => applySavedServer(previous, saveResult.server, saveResult.state, {
        registryRevision: saveResult.registryRevision,
        snapshotRevision: saveResult.snapshotRevision,
      }))
      setOperationMessage(draft.serverId, null)
    }

    if (mode === 'edit') {
      for (const existingServerId of existingServerIds) {
        if (nextServerIds.has(existingServerId)) {
          continue
        }

        const deleteResult = await resolvedClient.deleteServer(existingServerId)
        if (!deleteResult.ok) {
          return { ok: false, errorMessage: deleteResult.error, validationErrors: [] }
        }

        setRegistryState((previous) => removeServer({
          ...previous,
          registryRevision: deleteResult.registryRevision,
          snapshotRevision: deleteResult.snapshotRevision,
        }, existingServerId))
      }
    }

    return { ok: true }
  }, [registryState.servers, resolvedClient, setOperationMessage])

  const toggleServerEnabled = useCallback(async (serverId: string) => {
    const server = registryState.servers.find((entry) => entry.serverId === serverId)
    if (server === undefined) {
      return
    }

    setServerBusy(serverId, true)
    try {
      const result = await resolvedClient.setServerEnabled({ serverId, enabled: !server.enabled })
      if (!result.ok) {
        setOperationMessage(serverId, result.error)
        return
      }

      setRegistryState((previous) => applySavedServer(previous, result.server, result.state, {
        registryRevision: result.registryRevision,
        snapshotRevision: result.snapshotRevision,
      }))
      setOperationMessage(serverId, null)
    } finally {
      setServerBusy(serverId, false)
    }
  }, [registryState.servers, resolvedClient, setOperationMessage, setServerBusy])

  const deleteServer = useCallback(async (serverId: string) => {
    setServerBusy(serverId, true)
    try {
      const result = await resolvedClient.deleteServer(serverId)
      if (!result.ok) {
        setOperationMessage(serverId, result.error)
        return
      }

      setRegistryState((previous) => removeServer({
        ...previous,
        registryRevision: result.registryRevision,
        snapshotRevision: result.snapshotRevision,
      }, serverId))
    } finally {
      setServerBusy(serverId, false)
    }
  }, [resolvedClient, setOperationMessage, setServerBusy])

  const testServerConnection = useCallback(async (serverId: string) => {
    setServerBusy(serverId, true)
    try {
      const result = await resolvedClient.testConnection({ serverId })
      setOperationMessage(serverId, formatMcpTestConnectionMessage(result))
    } finally {
      setServerBusy(serverId, false)
    }
  }, [resolvedClient, setOperationMessage, setServerBusy])

  const refreshServerCatalog = useCallback(async (serverId: string) => {
    setServerBusy(serverId, true)
    try {
      const result = await resolvedClient.refreshCatalog({ serverId })
      setOperationMessage(serverId, formatMcpRefreshCatalogMessage(result, serverId))
    } finally {
      setServerBusy(serverId, false)
    }
  }, [resolvedClient, setOperationMessage, setServerBusy])

  const busyServerIds = useMemo(
    () => new Set(Object.entries(registryState.busyServerIds).filter(([, busy]) => busy).map(([serverId]) => serverId)),
    [registryState.busyServerIds],
  )

  const servers = useMemo(
    () => buildMcpRegistryServerViewModels(
      registryState.servers,
      registryState.states,
      registryState.operationMessages,
      busyServerIds,
    ),
    [busyServerIds, registryState.operationMessages, registryState.servers, registryState.states],
  )

  return {
    loadStatus: registryState.loadStatus,
    rawServers: registryState.servers,
    servers,
    statusMessage: resolveStatusMessage(registryState),
    getEditorSeed(mode) {
      return resolveMcpEditorSeed(mode, registryState.servers)
    },
    saveEditorDraft,
    toggleServerEnabled,
    deleteServer,
    testServerConnection,
    refreshServerCatalog,
  }
}

function resolveStatusMessage(registryState: McpRegistryState): string | null {
  if (registryState.loadStatus === 'loading') {
    return '正在加载 MCP 服务器列表…'
  }

  if (registryState.loadStatus === 'error') {
    return registryState.loadError
  }

  return registryState.servers.length === 0 ? '尚未配置 MCP 服务器。' : null
}

function applyRegistrySubscriptionEvent(previous: McpRegistryState, event: McpRegistrySubscriptionEvent): McpRegistryState {
  if (event.kind === 'snapshot') {
    return {
      ...previous,
      loadStatus: 'ready',
      loadError: null,
      registryRevision: event.registryRevision,
      snapshotRevision: event.snapshotRevision,
      servers: event.servers.map(cloneServerRecord),
      states: event.states.map(cloneStateSummary),
    }
  }

  if (event.kind === 'server-state') {
    return {
      ...previous,
      registryRevision: event.registryRevision,
      snapshotRevision: event.snapshotRevision,
      states: upsertStateSummary(previous.states, event.state),
    }
  }

  if (event.kind === 'server-removed') {
    return removeServer({
      ...previous,
      registryRevision: event.registryRevision,
      snapshotRevision: event.snapshotRevision,
    }, event.serverId)
  }

  return { ...previous, registryRevision: event.registryRevision, snapshotRevision: event.snapshotRevision }
}

function applySavedServer(
  previous: McpRegistryState,
  server: McpServerRecord,
  state: McpServerStateSummary | null,
  revisions: { registryRevision: number, snapshotRevision: number },
): McpRegistryState {
  return {
    ...previous,
    loadStatus: 'ready',
    loadError: null,
    registryRevision: revisions.registryRevision,
    snapshotRevision: revisions.snapshotRevision,
    servers: upsertServerRecord(previous.servers, server),
    states: state === null ? previous.states : upsertStateSummary(previous.states, state),
  }
}

function removeServer(previous: McpRegistryState, serverId: string): McpRegistryState {
  const operationMessages = { ...previous.operationMessages }
  const busyServerIds = { ...previous.busyServerIds }
  delete operationMessages[serverId]
  delete busyServerIds[serverId]

  return {
    ...previous,
    servers: previous.servers.filter((server) => server.serverId !== serverId),
    states: previous.states.filter((state) => state.serverId !== serverId),
    operationMessages,
    busyServerIds,
  }
}

function upsertServerRecord(servers: readonly McpServerRecord[], nextServer: McpServerRecord): McpServerRecord[] {
  const existingIndex = servers.findIndex((server) => server.serverId === nextServer.serverId)
  if (existingIndex === -1) {
    return [...servers.map(cloneServerRecord), cloneServerRecord(nextServer)]
  }

  return servers.map((server, index) => index === existingIndex ? cloneServerRecord(nextServer) : cloneServerRecord(server))
}

function upsertStateSummary(states: readonly McpServerStateSummary[], nextState: McpServerStateSummary): McpServerStateSummary[] {
  const existingIndex = states.findIndex((state) => state.serverId === nextState.serverId)
  if (existingIndex === -1) {
    return [...states.map(cloneStateSummary), cloneStateSummary(nextState)]
  }

  return states.map((state, index) => index === existingIndex ? cloneStateSummary(nextState) : cloneStateSummary(state))
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
      ...(server.reservedSensitiveFields === undefined ? {} : { reservedSensitiveFields: [...server.reservedSensitiveFields] }),
    }
  }

  return {
    ...server,
    transportConfig: {
      ...server.transportConfig,
      ...(server.transportConfig.headers === undefined ? {} : { headers: { ...server.transportConfig.headers } }),
      ...(server.transportConfig.env === undefined ? {} : { env: { ...server.transportConfig.env } }),
    },
    ...(server.reservedSensitiveFields === undefined ? {} : { reservedSensitiveFields: [...server.reservedSensitiveFields] }),
  }
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
