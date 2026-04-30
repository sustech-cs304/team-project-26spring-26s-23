import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'

import type { McpConnectionPhase, McpServerRecord, McpToolCallResult } from '../types'
import {
  MCP_INITIALIZE_METHOD,
  MCP_INITIALIZED_NOTIFICATION_METHOD,
  MCP_TOOLS_CALL_METHOD,
  MCP_TOOLS_LIST_METHOD,
  JsonRpcMessageLineParser,
  McpConnectorError,
  type JsonRpcResponsePayload,
  type McpConnectorContext,
  type McpConnectorOperationResult,
  type McpConnectorToolCallRequest,
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
  encodeJsonRpcMessageLine,
  isJsonRpcResponseForId,
  normalizeConnectorError,
  normalizeToolsCallResult,
  normalizeToolsListResult,
  unwrapJsonRpcResponse,
  withTimeout,
} from './protocol'

const STDIO_CONNECT_TIMEOUT_MS = 5_000
const STDIO_TOOL_CALL_TIMEOUT_MS = 20_000
const STDIO_REQUEST_TIMEOUT_MESSAGE = 'Timed out while waiting for the MCP stdio server response.'
const STDERR_SUMMARY_MAX_LINES = 3

export interface CreateStdioMcpServerConnectorOptions {
  server: McpServerRecord
  context: McpConnectorContext
  resolvedCommand?: {
    requestedCommand: string
    resolutionKind: 'raw' | 'managed'
    managedFamily?: 'node' | 'uv'
  }
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
  const resolvedCommand = options.resolvedCommand ?? {
    requestedCommand: transportConfig.command,
    resolutionKind: 'raw' as const,
  }
  let child: ChildProcessWithoutNullStreams | null = null
  let parser = new JsonRpcMessageLineParser()
  let nextRequestId = 1
  let sessionReady = false
  let tools: McpRemoteToolSummary[] = []
  let lastExitCode: number | null = null
  let lastExitSignal: string | null = null
  let currentPhase: McpConnectionPhase | null = null
  const stderrLines: string[] = []
  let state = createConnectorState(server, server.enabled ? 'idle' : 'disabled', 0, context.now)
  let requestQueue = Promise.resolve()
  const pending = new Map<number, {
    resolve: (value: JsonRpcResponsePayload) => void
    reject: (error: unknown) => void
  }>()

  return {
    start,
    refreshCatalog,
    callTool,
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
    parser = new JsonRpcMessageLineParser()
    currentPhase = 'spawn'
    stderrLines.splice(0)
    state = createConnectorState(server, 'connecting', tools.length, context.now, {
      transportState: {
        kind: 'stdio',
        processStatus: 'starting',
        pid: null,
        lastExitCode,
        lastExitSignal,
        },
      lastPhase: currentPhase,
      lastHandshakeAt: state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
      lastError: null,
    })
    await emitState()

    const managedRuntimeFailure = readManagedRuntimeFailure()
    if (managedRuntimeFailure !== null) {
      return await applyFailure(new McpConnectorError(managedRuntimeFailure))
    }

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
      const spawnReady = bindChild(spawned)
      await spawnReady
      state = createConnectorState(server, 'connecting', tools.length, context.now, {
        transportState: {
          kind: 'stdio',
          processStatus: 'running',
          pid: spawned.pid ?? null,
          lastExitCode,
          lastExitSignal,
        },
        lastPhase: currentPhase,
        lastHandshakeAt: state.lastHandshakeAt ?? null,
        lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
        lastError: null,
      })
      await emitState()

      await performHandshake()
      const nextTools = await requestToolsList(true)
      sessionReady = true
      tools = cloneRemoteTools(nextTools)
      currentPhase = null
      const success = createConnectorSuccess(server, nextTools, context.now, {
        kind: 'stdio',
        processStatus: 'running',
        pid: spawned.pid ?? null,
        lastExitCode,
        lastExitSignal,
      }, {
        lastPhase: null,
        lastHandshakeAt: context.now(),
        lastCatalogSyncAt: context.now(),
        warnings: getWarnings(),
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
      const nextTools = await requestToolsList(false)
      tools = cloneRemoteTools(nextTools)
      const success = createConnectorSuccess(server, nextTools, context.now, {
        kind: 'stdio',
        processStatus: 'running',
        pid: child.pid ?? null,
        lastExitCode,
        lastExitSignal,
      }, {
        lastPhase: null,
        lastHandshakeAt: state.lastHandshakeAt ?? context.now(),
        lastCatalogSyncAt: context.now(),
        warnings: getWarnings(),
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
    currentPhase = null
    state = createConnectorState(server, 'idle', 0, context.now, {
      transportState: {
        kind: 'stdio',
        processStatus: 'stopped',
        pid: null,
        lastExitCode,
        lastExitSignal,
      },
      lastPhase: null,
      lastHandshakeAt: state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
      lastError: null,
    })
    await emitState()
  }

  function bindChild(spawned: ChildProcessWithoutNullStreams): Promise<void> {
    const spawnReady = new Promise<void>((resolve, reject) => {
      spawned.once('spawn', () => {
        if (spawned !== child) {
          return
        }

        resolve()
      })

      spawned.once('error', (error) => {
        if (spawned !== child) {
          return
        }

        reject(error)
      })
    })

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
        recordStderr(normalized)
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

    return spawnReady
  }

  async function performHandshake(): Promise<void> {
    await updatePhase('initialize')
    const initializeResponse = await sendRequest(MCP_INITIALIZE_METHOD, createInitializeParams())
    unwrapJsonRpcResponse(initializeResponse, context.now)
    await updatePhase('initialized')
    await sendNotification(MCP_INITIALIZED_NOTIFICATION_METHOD, {})
  }

  async function requestToolsList(updatePhaseState: boolean): Promise<McpRemoteToolSummary[]> {
    return await withSerializedPhase('tools/list', async () => {
      if (updatePhaseState) {
        await updatePhase('tools/list')
      }

      const response = await sendRequest(MCP_TOOLS_LIST_METHOD, {})
      const result = unwrapJsonRpcResponse(response, context.now)
      return normalizeToolsListResult(result)
    })
  }

  async function callTool(request: McpConnectorToolCallRequest): Promise<McpToolCallResult> {
    if (!sessionReady || child === null) {
      return {
        ok: false,
        toolId: request.toolId,
        serverId: request.serverId,
        remoteToolName: request.remoteToolName,
        snapshotRevision: request.snapshotRevision ?? null,
        error: createMcpErrorSummary(
          'temporarily_unavailable',
          'The MCP stdio server is not ready to execute tools.',
          true,
          context.now,
        ),
      }
    }

    if (!tools.some((tool) => tool.name === request.remoteToolName)) {
      return {
        ok: false,
        toolId: request.toolId,
        serverId: request.serverId,
        remoteToolName: request.remoteToolName,
        snapshotRevision: request.snapshotRevision ?? null,
        error: createMcpErrorSummary(
          'directory_drift',
          'The requested MCP tool no longer exists in the current server catalog.',
          false,
          context.now,
        ),
      }
    }

    try {
      const response = await withSerializedPhase('tools/call', async () => {
        return await sendRequest(MCP_TOOLS_CALL_METHOD, {
          name: request.remoteToolName,
          arguments: request.arguments,
        }, {
          timeoutMs: Math.max(context.timeoutMs, STDIO_TOOL_CALL_TIMEOUT_MS),
        })
      })
      const result = unwrapJsonRpcResponse(response, context.now)
      return normalizeToolsCallResult({
        result,
        request,
        server,
        now: context.now,
      })
    } catch (error) {
      return {
        ok: false,
        toolId: request.toolId,
        serverId: request.serverId,
        remoteToolName: request.remoteToolName,
        snapshotRevision: request.snapshotRevision ?? null,
        error: normalizeConnectorError(error, context.now, 'stdio_tool_call_failed'),
      }
    }
  }

  async function sendRequest(
    method: string,
    params?: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<JsonRpcResponsePayload> {
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
    const timeoutMs = options.timeoutMs ?? (context.timeoutMs > 0 ? context.timeoutMs : STDIO_CONNECT_TIMEOUT_MS)

    const responsePromise = new Promise<JsonRpcResponsePayload>((resolve, reject) => {
      pending.set(requestId, { resolve, reject })
      activeChild.stdin.write(encodeJsonRpcMessageLine(createJsonRpcRequest(requestId, method, params)), (error) => {
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
      timeoutMs,
      context.now,
      createPhaseTimeoutMessage(currentPhase),
    )
  }

  async function withSerializedPhase<T>(phase: McpConnectionPhase, work: () => Promise<T>): Promise<T> {
    const next = requestQueue.catch(() => undefined).then(async () => {
      const previousPhase = currentPhase
      currentPhase = phase
      try {
        const result = await work()
        currentPhase = previousPhase
        return result
      } catch (error) {
        currentPhase = phase
        throw error
      }
    })

    requestQueue = next.then(() => undefined, () => undefined)
    return await next
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
      activeChild.stdin.write(encodeJsonRpcMessageLine(createJsonRpcNotification(method, params)), (error) => {
        if (error === undefined || error === null) {
          resolve()
          return
        }

        reject(error)
      })
    })
  }

  async function applyFailure(error: unknown): Promise<McpConnectorOperationResult> {
    const summary = enrichFailureSummary(normalizeConnectorError(error, context.now, 'stdio_connection_failed'))
    await disposeChild()
    sessionReady = false
    const failure = createConnectorFailure(server, summary, context.now, {
      kind: 'stdio',
      processStatus: lastExitCode === null && lastExitSignal === null ? 'stopped' : 'exited',
      pid: null,
      lastExitCode,
      lastExitSignal,
    }, {
      lastPhase: currentPhase,
      previousTools: tools,
      lastHandshakeAt: state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
      warnings: getWarnings(),
    })
    state = cloneStateSummary(failure.state)
    await emitState()
    return failure
  }

  async function applyUnexpectedDisconnect(error: unknown): Promise<void> {
    const summary = enrichFailureSummary(normalizeConnectorError(error, context.now, 'stdio_disconnected'))
    const failure = createConnectorFailure(server, summary, context.now, {
      kind: 'stdio',
      processStatus: 'exited',
      pid: null,
      lastExitCode,
      lastExitSignal,
    }, {
      lastPhase: currentPhase,
      previousTools: tools,
      lastHandshakeAt: state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
      warnings: getWarnings(),
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
    const stderrSummary = getStderrSummary()
    const detailParts = [
      code === null ? null : `exit code ${code}`,
      signal === null ? null : `signal ${signal}`,
      stderrSummary,
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
        phase: currentPhase,
        stderrSummary,
      },
    )
  }

  async function emitState(): Promise<void> {
    await context.onStateChange?.(cloneStateSummary(state))
  }

  async function updatePhase(phase: McpConnectionPhase): Promise<void> {
    currentPhase = phase
    state = createConnectorState(server, 'connecting', tools.length, context.now, {
      transportState: child === null
        ? {
            kind: 'stdio',
            processStatus: 'starting',
            pid: null,
            lastExitCode,
            lastExitSignal,
          }
        : {
            kind: 'stdio',
            processStatus: 'running',
            pid: child.pid ?? null,
            lastExitCode,
            lastExitSignal,
          },
      lastPhase: phase,
      lastHandshakeAt: state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: state.lastCatalogSyncAt ?? null,
      lastError: null,
    })
    await emitState()
  }

  function recordStderr(text: string): void {
    for (const line of text.split(/\r?\n/gu)) {
      const normalized = line.trim()
      if (normalized === '') {
        continue
      }

      stderrLines.push(normalized)
      while (stderrLines.length > STDERR_SUMMARY_MAX_LINES) {
        stderrLines.shift()
      }
    }
  }

  function getStderrSummary(): string | null {
    return stderrLines.length === 0 ? null : stderrLines.join(' | ')
  }

  function getWarnings(): string[] {
    const stderrSummary = getStderrSummary()
    return stderrSummary === null ? [] : [stderrSummary]
  }

  function enrichFailureSummary(summary: ReturnType<typeof normalizeConnectorError>): ReturnType<typeof normalizeConnectorError> {
    const phase = currentPhase
    const stderrSummary = getStderrSummary()
    const diagnosticSummary = buildDiagnosticSummary(phase, stderrSummary)
    const nextDetails = {
      ...(summary.details ?? {}),
      phase,
      requestedCommand: resolvedCommand.requestedCommand,
      resolutionKind: resolvedCommand.resolutionKind,
      managedFamily: resolvedCommand.managedFamily ?? null,
      command: transportConfig.command,
      args: [...transportConfig.args],
      cwd: transportConfig.cwd ?? null,
      stderrSummary,
      diagnosticSummary,
    }

    return {
      ...summary,
      message: createPhaseAwareMessage(summary, phase),
      details: nextDetails,
    }
  }

  function readManagedRuntimeFailure() {
    const rawFailure = transportConfig.env?.CANDUE_MANAGED_RUNTIME_ERROR
    if (typeof rawFailure !== 'string' || rawFailure.trim() === '') {
      return null
    }

    try {
      const parsed = JSON.parse(rawFailure) as {
        message?: unknown
        observedAt?: unknown
        details?: unknown
      }
      return createMcpErrorSummary(
        'managed_runtime_unavailable',
        typeof parsed.message === 'string' && parsed.message.trim() !== ''
          ? parsed.message
          : 'The managed runtime required by this MCP launcher is unavailable.',
        false,
        () => typeof parsed.observedAt === 'string' && parsed.observedAt.trim() !== ''
          ? parsed.observedAt
          : context.now(),
        isRecord(parsed.details) ? parsed.details : null,
      )
    } catch {
      return createMcpErrorSummary(
        'managed_runtime_unavailable',
        'The managed runtime required by this MCP launcher is unavailable.',
        false,
        context.now,
      )
    }
  }

  function buildDiagnosticSummary(phase: McpConnectionPhase | null, stderrSummary: string | null): string {
    const parts = [
      phase === null ? null : `phase=${phase}`,
      `requestedCommand=${resolvedCommand.requestedCommand}`,
      `resolution=${resolvedCommand.resolutionKind}`,
      resolvedCommand.managedFamily ? `managedFamily=${resolvedCommand.managedFamily}` : null,
      `command=${transportConfig.command}`,
      transportConfig.args.length === 0 ? null : `args=${transportConfig.args.join(' ')}`,
      transportConfig.cwd ? `cwd=${transportConfig.cwd}` : null,
      stderrSummary === null ? null : `stderr=${stderrSummary}`,
    ].filter((value): value is string => value !== null)

    return parts.join('; ')
  }

  function createPhaseAwareMessage(
    summary: ReturnType<typeof normalizeConnectorError>,
    phase: McpConnectionPhase | null,
  ): string {
    if (phase === null) {
      return summary.message
    }

    if (summary.code === 'timeout') {
      return createPhaseTimeoutMessage(phase)
    }

    if (summary.code === 'protocol_parse_failed') {
      return `The MCP stdio server returned unrecognized stdout output during ${phase}.`
    }

    if (summary.code === 'mcp_remote_error') {
      return `The MCP stdio server returned an error during ${phase}: ${summary.message}`
    }

    return summary.message
  }
}

function createPhaseTimeoutMessage(phase: McpConnectionPhase | null): string {
  if (phase === null) {
    return STDIO_REQUEST_TIMEOUT_MESSAGE
  }

  return `Timed out while waiting for the MCP stdio server response during ${phase}.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
