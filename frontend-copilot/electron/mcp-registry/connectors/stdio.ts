import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'

import type { McpServerRecord } from '../types'
import {
  MCP_INITIALIZE_METHOD,
  MCP_INITIALIZED_NOTIFICATION_METHOD,
  MCP_TOOLS_LIST_METHOD,
  JsonRpcContentLengthParser,
  McpConnectorError,
  type JsonRpcResponsePayload,
  type McpConnectorContext,
  type McpConnectorOperationResult,
  type McpRemoteToolSummary,
  type McpServerConnector,
  cloneRemoteTools,
  cloneStateSummary,
  createConnectorFailure,
  createConnectorState,
  createConnectorSuccess,
  createInitializeParams,
  createJsonRpcNotification,
  createJsonRpcRequest,
  createMcpErrorSummary,
  delay,
  encodeJsonRpcContentLengthMessage,
  isJsonRpcResponseForId,
  normalizeConnectorError,
  normalizeToolsListResult,
  unwrapJsonRpcResponse,
  withTimeout,
} from './protocol'

const STDIO_CONNECT_TIMEOUT_MS = 5_000
const STDIO_REQUEST_TIMEOUT_MESSAGE = 'Timed out while waiting for the MCP stdio server response.'

export interface CreateStdioMcpServerConnectorOptions {
  server: McpServerRecord
  context: McpConnectorContext
}

export function createStdioMcpServerConnector(
  options: CreateStdioMcpServerConnectorOptions,
): McpServerConnector {
  if (options.server.transportConfig.kind !== 'stdio') {
    throw new Error('createStdioMcpServerConnector requires a stdio transport config.')
  }

  const server = options.server
  const transportConfig = options.server.transportConfig
  const context = options.context
  let child: ChildProcessWithoutNullStreams | null = null
  let parser = new JsonRpcContentLengthParser()
  let nextRequestId = 1
  let sessionReady = false
  let tools: McpRemoteToolSummary[] = []
  let lastExitCode: number | null = null
  let lastExitSignal: string | null = null
  let lastStderrLine: string | null = null
  let state = createConnectorState(server, server.enabled ? 'idle' : 'disabled', 0, context.now)
  const pending = new Map<number, {
    resolve: (value: JsonRpcResponsePayload) => void
    reject: (error: unknown) => void
  }>()

  return {
    start,
    refreshCatalog,
    stop,
    getState() {
      return cloneStateSummary(state)
    },
    getTools() {
      return cloneRemoteTools(tools)
    },
  }

  async function start(): Promise<McpConnectorOperationResult> {
    sessionReady = false
    await disposeChild()
    parser = new JsonRpcContentLengthParser()
    lastStderrLine = null
    state = createConnectorState(server, 'connecting', tools.length, context.now, {
      transportState: {
        kind: 'stdio',
        processStatus: 'starting',
        pid: null,
        lastExitCode,
        lastExitSignal,
      },
      lastHandshakeAt: state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
      lastError: null,
    })
    await emitState()

    try {
      const spawned = spawn(transportConfig.command, transportConfig.args, {
        cwd: transportConfig.cwd ?? undefined,
        env: {
          ...process.env,
          ...(transportConfig.env ?? {}),
        },
        stdio: 'pipe',
        windowsHide: true,
      })
      child = spawned
      bindChild(spawned)
      state = createConnectorState(server, 'connecting', tools.length, context.now, {
        transportState: {
          kind: 'stdio',
          processStatus: 'running',
          pid: spawned.pid ?? null,
          lastExitCode,
          lastExitSignal,
        },
        lastHandshakeAt: state.lastHandshakeAt ?? null,
        lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
        lastError: null,
      })
      await emitState()

      await performHandshake()
      const nextTools = await requestToolsList()
      sessionReady = true
      tools = cloneRemoteTools(nextTools)
      const success = createConnectorSuccess(server, nextTools, context.now, {
        kind: 'stdio',
        processStatus: 'running',
        pid: spawned.pid ?? null,
        lastExitCode,
        lastExitSignal,
      }, {
        lastHandshakeAt: context.now(),
        lastCatalogSyncAt: context.now(),
      })
      state = cloneStateSummary(success.state)
      await emitState()
      return success
    } catch (error) {
      return await applyFailure(error)
    }
  }

  async function refreshCatalog(): Promise<McpConnectorOperationResult> {
    if (!sessionReady || child === null) {
      return await start()
    }

    try {
      const nextTools = await requestToolsList()
      tools = cloneRemoteTools(nextTools)
      const success = createConnectorSuccess(server, nextTools, context.now, {
        kind: 'stdio',
        processStatus: 'running',
        pid: child.pid ?? null,
        lastExitCode,
        lastExitSignal,
      }, {
        lastHandshakeAt: state.lastHandshakeAt ?? context.now(),
        lastCatalogSyncAt: context.now(),
      })
      state = cloneStateSummary(success.state)
      await emitState()
      return success
    } catch (error) {
      return await applyFailure(error)
    }
  }

  async function stop(): Promise<void> {
    sessionReady = false
    await disposeChild()
    state = createConnectorState(server, 'idle', 0, context.now, {
      transportState: {
        kind: 'stdio',
        processStatus: 'stopped',
        pid: null,
        lastExitCode,
        lastExitSignal,
      },
      lastHandshakeAt: state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
      lastError: null,
    })
    await emitState()
  }

  function bindChild(spawned: ChildProcessWithoutNullStreams): void {
    spawned.stdout.on('data', (chunk: Buffer | string) => {
      if (spawned !== child) {
        return
      }

      try {
        const messages = parser.push(chunk)
        for (const message of messages) {
          for (const [requestId, pendingRequest] of pending.entries()) {
            if (!isJsonRpcResponseForId(message, requestId)) {
              continue
            }

            pending.delete(requestId)
            pendingRequest.resolve(message)
            break
          }
        }
      } catch (error) {
        rejectPending(error)
        if (sessionReady) {
          void applyUnexpectedDisconnect(error)
        }
      }
    })

    spawned.stderr.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      const normalized = text.trim()
      if (normalized !== '') {
        const lines = normalized.split(/\r?\n/g)
        lastStderrLine = lines[lines.length - 1] ?? normalized
      }
    })

    spawned.on('exit', (code, signal) => {
      if (spawned !== child) {
        lastExitCode = code ?? null
        lastExitSignal = signal ?? null
        return
      }

      lastExitCode = code ?? null
      lastExitSignal = signal ?? null
      child = null
      rejectPending(new McpConnectorError(createProcessExitSummary(code, signal)))
      const wasReady = sessionReady
      sessionReady = false
      if (wasReady) {
        void applyUnexpectedDisconnect(createProcessExitSummary(code, signal))
      }
    })

    spawned.on('error', (error) => {
      if (spawned !== child) {
        return
      }

      rejectPending(error)
      if (sessionReady) {
        void applyUnexpectedDisconnect(error)
      }
    })
  }

  async function performHandshake(): Promise<void> {
    const initializeResponse = await sendRequest(MCP_INITIALIZE_METHOD, createInitializeParams())
    unwrapJsonRpcResponse(initializeResponse, context.now)
    await sendNotification(MCP_INITIALIZED_NOTIFICATION_METHOD, {})
  }

  async function requestToolsList(): Promise<McpRemoteToolSummary[]> {
    const response = await sendRequest(MCP_TOOLS_LIST_METHOD, {})
    const result = unwrapJsonRpcResponse(response, context.now)
    return normalizeToolsListResult(result)
  }

  async function sendRequest(method: string, params?: unknown): Promise<JsonRpcResponsePayload> {
    const activeChild = child
    if (activeChild === null || activeChild.stdin.destroyed) {
      throw new McpConnectorError(createMcpErrorSummary(
        'connection_closed',
        'The MCP stdio process is not available.',
        true,
        context.now,
      ))
    }

    const requestId = nextRequestId
    nextRequestId += 1

    const responsePromise = new Promise<JsonRpcResponsePayload>((resolve, reject) => {
      pending.set(requestId, { resolve, reject })
      activeChild.stdin.write(encodeJsonRpcContentLengthMessage(createJsonRpcRequest(requestId, method, params)), (error) => {
        if (error === undefined || error === null) {
          return
        }

        const pendingRequest = pending.get(requestId)
        if (pendingRequest === undefined) {
          return
        }

        pending.delete(requestId)
        pendingRequest.reject(error)
      })
    })

    return await withTimeout(
      responsePromise,
      context.timeoutMs > 0 ? context.timeoutMs : STDIO_CONNECT_TIMEOUT_MS,
      context.now,
      STDIO_REQUEST_TIMEOUT_MESSAGE,
    )
  }

  async function sendNotification(method: string, params?: unknown): Promise<void> {
    const activeChild = child
    if (activeChild === null || activeChild.stdin.destroyed) {
      throw new McpConnectorError(createMcpErrorSummary(
        'connection_closed',
        'The MCP stdio process is not available.',
        true,
        context.now,
      ))
    }

    await new Promise<void>((resolve, reject) => {
      activeChild.stdin.write(encodeJsonRpcContentLengthMessage(createJsonRpcNotification(method, params)), (error) => {
        if (error === undefined || error === null) {
          resolve()
          return
        }

        reject(error)
      })
    })
  }

  async function applyFailure(error: unknown): Promise<McpConnectorOperationResult> {
    const summary = normalizeConnectorError(error, context.now, 'stdio_connection_failed')
    await disposeChild()
    sessionReady = false
    const failure = createConnectorFailure(server, summary, context.now, {
      kind: 'stdio',
      processStatus: lastExitCode === null && lastExitSignal === null ? 'stopped' : 'exited',
      pid: null,
      lastExitCode,
      lastExitSignal,
    }, {
      previousTools: tools,
      lastHandshakeAt: state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
      warnings: lastStderrLine === null ? [] : [lastStderrLine],
    })
    state = cloneStateSummary(failure.state)
    await emitState()
    return failure
  }

  async function applyUnexpectedDisconnect(error: unknown): Promise<void> {
    const summary = normalizeConnectorError(error, context.now, 'stdio_disconnected')
    const failure = createConnectorFailure(server, summary, context.now, {
      kind: 'stdio',
      processStatus: 'exited',
      pid: null,
      lastExitCode,
      lastExitSignal,
    }, {
      previousTools: tools,
      lastHandshakeAt: state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
    })
    state = cloneStateSummary(failure.state)
    await emitState()
  }

  async function disposeChild(): Promise<void> {
    const activeChild = child
    if (activeChild === null) {
      return
    }

    child = null
    rejectPending(new McpConnectorError(createMcpErrorSummary(
      'connection_closed',
      'The MCP stdio connection was closed.',
      true,
      context.now,
    )))

    if (!activeChild.killed) {
      activeChild.kill()
    }

    await Promise.race([
      once(activeChild, 'exit').then(() => undefined).catch(() => undefined),
      delay(150),
    ])
  }

  function rejectPending(error: unknown): void {
    for (const [requestId, pendingRequest] of pending.entries()) {
      pending.delete(requestId)
      pendingRequest.reject(error)
    }
  }

  function createProcessExitSummary(code: number | null, signal: NodeJS.Signals | null) {
    const detailParts = [
      code === null ? null : `exit code ${code}`,
      signal === null ? null : `signal ${signal}`,
      lastStderrLine,
    ].filter((value): value is string => value !== null)

    const suffix = detailParts.length === 0 ? '' : ` (${detailParts.join(', ')})`
    return createMcpErrorSummary(
      'process_exited',
      `The MCP stdio process exited unexpectedly${suffix}.`,
      true,
      context.now,
      {
        exitCode: code,
        exitSignal: signal,
      },
    )
  }

  async function emitState(): Promise<void> {
    await context.onStateChange?.(cloneStateSummary(state))
  }
}
