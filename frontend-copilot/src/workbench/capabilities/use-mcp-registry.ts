import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  formatMcpSaveServerMessage,
  formatMcpTestConnectionMessage,
  parseMcpRegistryEditorValue,
  resolveMcpEditorSeed,
  type McpBusyOperation,
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
  busyOperations: Record<string, McpBusyOperation | null>
}

export type McpRegistryEditorSaveResult =
  | { ok: true }
  | { ok: false, errorMessage: string, validationErrors: McpServerValidationError[] }

export interface UseMcpRegistryResult {
  loadStatus: McpRegistryState['loadStatus']
  snapshotRevision: number
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
  busyOperations: {},
}

export function useMcpRegistry(client?: McpRegistryClient): UseMcpRegistryResult {
  const resolvedClient = useMemo(() => client ?? createWindowMcpRegistryClient(), [client])
  const [registryState, setRegistryState] = useState<McpRegistryState>(INITIAL_STATE)

  useMcpRegistryLoad(resolvedClient, setRegistryState)

  const setBusyOperation = useCallback((serverId: string, operation: McpBusyOperation | null) => {
    setRegistryState((previous) => ({
      ...previous,
      busyOperations: {
        ...previous.busyOperations,
        [serverId]: operation,
      },
    }))
  }, [])

  const setOperationMessage = useCallback((serverId: string, message: string | null) => {
    setRegistryState((previous) => ({
      ...previous,
      operationMessages: { ...previous.operationMessages, [serverId]: message },
    }))
  }, [])

  const saveEditorDraft = useMcpRegistrySaveDraft(
    resolvedClient,
    registryState.servers,
    setRegistryState,
    { setBusyOperation, setOperationMessage },
  )

  const toggleServerEnabled = useCallback(async (serverId: string) => {
    const server = registryState.servers.find((entry) => entry.serverId === serverId)
    if (server === undefined) {
      return
    }

    setBusyOperation(serverId, 'toggling')
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
      setOperationMessage(serverId, formatMcpSaveServerMessage(result.server, result.state))
    } finally {
      setBusyOperation(serverId, null)
    }
  }, [registryState.servers, resolvedClient, setBusyOperation, setOperationMessage])

  const deleteServer = useCallback(async (serverId: string) => {
    setBusyOperation(serverId, 'deleting')
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
      setBusyOperation(serverId, null)
    }
  }, [resolvedClient, setBusyOperation, setOperationMessage])

  const testServerConnection = useCallback(async (serverId: string) => {
    setBusyOperation(serverId, 'testing')
    try {
      const result = await resolvedClient.testConnection({ serverId })
      setOperationMessage(serverId, formatMcpTestConnectionMessage(result))
    } finally {
      setBusyOperation(serverId, null)
    }
  }, [resolvedClient, setBusyOperation, setOperationMessage])

  const refreshServerCatalog = useCallback(async (serverId: string) => {
    setBusyOperation(serverId, 'refreshing')
    try {
      const result = await resolvedClient.refreshCatalog({ serverId })
      setOperationMessage(serverId, formatMcpRefreshCatalogMessage(result, serverId))
    } finally {
      setBusyOperation(serverId, null)
    }
  }, [resolvedClient, setBusyOperation, setOperationMessage])

  const servers = useMemo(
    () => buildMcpRegistryServerViewModels(
      registryState.servers,
      registryState.states,
      registryState.operationMessages,
      registryState.busyOperations,
    ),
    [registryState.busyOperations, registryState.operationMessages, registryState.servers, registryState.states],
  )

  return {
    loadStatus: registryState.loadStatus,
    snapshotRevision: registryState.snapshotRevision,
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

function useMcpRegistryLoad(
  resolvedClient: McpRegistryClient,
  setRegistryState: React.Dispatch<React.SetStateAction<McpRegistryState>>,
) {
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
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
      mountedRef.current = false
      unsubscribe()
    }
  }, [resolvedClient, setRegistryState])
}

interface McpRegistryOpSetters {
  setBusyOperation: (serverId: string, operation: McpBusyOperation | null) => void
  setOperationMessage: (serverId: string, message: string | null) => void
}

function useMcpRegistrySaveDraft(
  resolvedClient: McpRegistryClient,
  servers: readonly McpServerRecord[],
  setRegistryState: React.Dispatch<React.SetStateAction<McpRegistryState>>,
  opSetters: McpRegistryOpSetters,
) {
  const { setBusyOperation, setOperationMessage } = opSetters

  return useCallback(async (
    mode: McpServerEditorMode,
    value: string,
  ): Promise<McpRegistryEditorSaveResult> => {
    const parsed = parseMcpRegistryEditorValue(mode, value)
    if (!parsed.ok) {
      return { ok: false, errorMessage: 'MCP 配置草稿校验失败。', validationErrors: parsed.validationErrors }
    }

    const existingServerIds = new Set(servers.map((server) => server.serverId))
    const nextServerIds = new Set(parsed.drafts.map((draft) => draft.serverId))

    for (const draft of parsed.drafts) {
      setBusyOperation(draft.serverId, 'saving')
      try {
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
        setOperationMessage(draft.serverId, formatMcpSaveServerMessage(saveResult.server, saveResult.state))
      } finally {
        setBusyOperation(draft.serverId, null)
      }
    }

    if (mode === 'edit') {
      for (const existingServerId of existingServerIds) {
        if (nextServerIds.has(existingServerId)) {
          continue
        }

        setBusyOperation(existingServerId, 'deleting')
        try {
          const deleteResult = await resolvedClient.deleteServer(existingServerId)
          if (!deleteResult.ok) {
            return { ok: false, errorMessage: deleteResult.error, validationErrors: [] }
          }

          setRegistryState((previous) => removeServer({
            ...previous,
            registryRevision: deleteResult.registryRevision,
            snapshotRevision: deleteResult.snapshotRevision,
          }, existingServerId))
        } finally {
          setBusyOperation(existingServerId, null)
        }
      }
    }

    return { ok: true }
  }, [servers, resolvedClient, setRegistryState, setBusyOperation, setOperationMessage])
}

function resolveStatusMessage(registryState: McpRegistryState): string | null {
  if (registryState.loadStatus === 'loading') {
    return '正在加载服务器列表…'
  }

  if (registryState.loadStatus === 'error') {
    return registryState.loadError
  }

  return null
}

function applyRegistrySubscriptionEvent(previous: McpRegistryState, event: McpRegistrySubscriptionEvent): McpRegistryState {
  if (event.kind === 'snapshot') {
    return pruneRegistryState({
      ...previous,
      loadStatus: 'ready',
      loadError: null,
      registryRevision: event.registryRevision,
      snapshotRevision: event.snapshotRevision,
      servers: event.servers.map(cloneServerRecord),
      states: event.states.map(cloneStateSummary),
    })
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

  return {
    ...previous,
    registryRevision: event.registryRevision,
    snapshotRevision: event.snapshotRevision,
  }
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
  const busyOperations = { ...previous.busyOperations }
  delete operationMessages[serverId]
  delete busyOperations[serverId]

  return {
    ...previous,
    servers: previous.servers.filter((server) => server.serverId !== serverId),
    states: previous.states.filter((state) => state.serverId !== serverId),
    operationMessages,
    busyOperations,
  }
}

function pruneRegistryState(previous: McpRegistryState): McpRegistryState {
  const knownServerIds = new Set(previous.servers.map((server) => server.serverId))
  return {
    ...previous,
    operationMessages: Object.fromEntries(
      Object.entries(previous.operationMessages).filter(([serverId]) => knownServerIds.has(serverId)),
    ),
    busyOperations: Object.fromEntries(
      Object.entries(previous.busyOperations).filter(([serverId]) => knownServerIds.has(serverId)),
    ),
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
