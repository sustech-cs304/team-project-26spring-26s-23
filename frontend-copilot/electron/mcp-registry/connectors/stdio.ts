import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'

import type { McpConnectionPhase, McpServerRecord, McpServerStateSummary, McpToolCallResult } from '../types'
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

interface StdioPendingRequest {
  resolve: (value: JsonRpcResponsePayload) => void
  reject: (error: unknown) => void
}

interface StdioContext {
  server: McpServerRecord
  transportConfig: Extract<McpServerRecord['transportConfig'], { kind: 'stdio' }>
  context: McpConnectorContext
  resolvedCommand: {
    requestedCommand: string
    resolutionKind: 'raw' | 'managed'
    managedFamily?: 'node' | 'uv'
  }
  child: ChildProcessWithoutNullStreams | null
  parser: JsonRpcMessageLineParser
  nextRequestId: number
  sessionReady: boolean
  tools: McpRemoteToolSummary[]
  lastExitCode: number | null
  lastExitSignal: string | null
  currentPhase: McpConnectionPhase | null
  stderrLines: string[]
  state: McpServerStateSummary
  requestQueue: Promise<void>
  pending: Map<number, StdioPendingRequest>
}

export function createStdioMcpServerConnector(
  options: CreateStdioMcpServerConnectorOptions,
): McpServerConnector {
  if (options.server.transportConfig.kind !== 'stdio') {
    throw new Error('createStdioMcpServerConnector requires a stdio transport config.')
  }

  const ctx: StdioContext = {
    server: options.server,
    transportConfig: options.server.transportConfig as Extract<McpServerRecord['transportConfig'], { kind: 'stdio' }>,
    context: options.context,
    resolvedCommand: options.resolvedCommand ?? {
      requestedCommand: options.server.transportConfig.command,
      resolutionKind: 'raw' as const,
    },
    child: null,
    parser: new JsonRpcMessageLineParser(),
    nextRequestId: 1,
    sessionReady: false,
    tools: [],
    lastExitCode: null,
    lastExitSignal: null,
    currentPhase: null,
    stderrLines: [],
    state: createConnectorState(options.server, options.server.enabled ? 'idle' : 'disabled', 0, {}),
    requestQueue: Promise.resolve(),
    pending: new Map(),
  }

  return {
    start: () => stdioStart(ctx),
    refreshCatalog: () => stdioRefreshCatalog(ctx),
    callTool: (request) => stdioCallTool(ctx, request),
    stop: () => stdioStop(ctx),
    getState: () => cloneStateSummary(ctx.state),
    getTools: () => cloneRemoteTools(ctx.tools),
  }
}

async function stdioStart(ctx: StdioContext): Promise<McpConnectorOperationResult> {
  ctx.sessionReady = false
  await stdioDisposeChild(ctx)
  ctx.parser = new JsonRpcMessageLineParser()
  ctx.currentPhase = 'spawn'
  ctx.stderrLines.splice(0)
  ctx.state = createConnectorState(ctx.server, 'connecting', ctx.tools.length, {
    transportState: {
      kind: 'stdio',
      processStatus: 'starting',
      pid: null,
      lastExitCode: ctx.lastExitCode,
      lastExitSignal: ctx.lastExitSignal,
    },
    lastPhase: ctx.currentPhase,
    lastHandshakeAt: ctx.state.lastHandshakeAt ?? null,
    lastCatalogSyncAt: ctx.state.lastCatalogSyncAt ?? null,
    lastError: null,
  })
  await stdioEmitState(ctx)

  const managedRuntimeFailure = stdioReadManagedRuntimeFailure(ctx)
  if (managedRuntimeFailure !== null) {
    return await stdioApplyFailure(ctx, new McpConnectorError(managedRuntimeFailure))
  }

  try {
    const spawned = spawn(ctx.transportConfig.command, ctx.transportConfig.args, {
      cwd: ctx.transportConfig.cwd ?? undefined,
      env: {
        ...process.env,
        ...(ctx.transportConfig.env ?? {}),
      },
      stdio: 'pipe',
      windowsHide: true,
    })
    ctx.child = spawned
    const spawnReady = stdioBindChild(ctx, spawned)
    await spawnReady
    ctx.state = createConnectorState(ctx.server, 'connecting', ctx.tools.length, {
      transportState: {
        kind: 'stdio',
        processStatus: 'running',
        pid: spawned.pid ?? null,
        lastExitCode: ctx.lastExitCode,
        lastExitSignal: ctx.lastExitSignal,
      },
      lastPhase: ctx.currentPhase,
      lastHandshakeAt: ctx.state.lastHandshakeAt ?? null,
      lastCatalogSyncAt: ctx.state.lastCatalogSyncAt ?? null,
      lastError: null,
    })
    await stdioEmitState(ctx)

    await stdioPerformHandshake(ctx)
    const nextTools = await stdioRequestToolsList(ctx, true)
    ctx.sessionReady = true
    ctx.tools = cloneRemoteTools(nextTools)
    ctx.currentPhase = null
    const success = createConnectorSuccess(ctx.server, nextTools, {
      now: ctx.context.now,
      transportState: {
        kind: 'stdio',
        processStatus: 'running',
        pid: spawned.pid ?? null,
        lastExitCode: ctx.lastExitCode,
        lastExitSignal: ctx.lastExitSignal,
      },
      lastPhase: null,
      lastHandshakeAt: ctx.context.now(),
      lastCatalogSyncAt: ctx.context.now(),
      warnings: stdioGetWarnings(ctx),
    })
    ctx.state = cloneStateSummary(success.state)
    await stdioEmitState(ctx)
    return success
  } catch (error) {
    return await stdioApplyFailure(ctx, error)
  }
}

async function stdioRefreshCatalog(ctx: StdioContext): Promise<McpConnectorOperationResult> {
  if (!ctx.sessionReady || ctx.child === null) {
    return await stdioStart(ctx)
  }

  try {
    const nextTools = await stdioRequestToolsList(ctx, false)
    ctx.tools = cloneRemoteTools(nextTools)
    const success = createConnectorSuccess(ctx.server, nextTools, {
      now: ctx.context.now,
      transportState: {
        kind: 'stdio',
        processStatus: 'running',
        pid: ctx.child?.pid ?? null,
        lastExitCode: ctx.lastExitCode,
        lastExitSignal: ctx.lastExitSignal,
      },
      lastPhase: null,
      lastHandshakeAt: ctx.state.lastHandshakeAt ?? ctx.context.now(),
      lastCatalogSyncAt: ctx.context.now(),
      warnings: stdioGetWarnings(ctx),
    })
    ctx.state = cloneStateSummary(success.state)
    await stdioEmitState(ctx)
    return success
  } catch (error) {
    return await stdioApplyFailure(ctx, error)
  }
}

async function stdioStop(ctx: StdioContext): Promise<void> {
  ctx.sessionReady = false
  await stdioDisposeChild(ctx)
  ctx.currentPhase = null
  ctx.state = createConnectorState(ctx.server, 'idle', 0, {
    transportState: {
      kind: 'stdio',
      processStatus: 'stopped',
      pid: null,
      lastExitCode: ctx.lastExitCode,
      lastExitSignal: ctx.lastExitSignal,
    },
    lastPhase: null,
    lastHandshakeAt: ctx.state.lastHandshakeAt ?? null,
    lastCatalogSyncAt: ctx.state.lastCatalogSyncAt ?? null,
    lastError: null,
  })
  await stdioEmitState(ctx)
}

function stdioBindChild(
  ctx: StdioContext,
  spawned: ChildProcessWithoutNullStreams,
): Promise<void> {
  const spawnReady = new Promise<void>((resolve, reject) => {
    spawned.once('spawn', () => {
      if (spawned !== ctx.child) {
        return
      }
      resolve()
    })

    spawned.once('error', (error) => {
      if (spawned !== ctx.child) {
        return
      }
      reject(error)
    })
  })

  spawned.stdout.on('data', (chunk: Buffer | string) => {
    if (spawned !== ctx.child) {
      return
    }

    try {
      const messages = ctx.parser.push(chunk)
      for (const message of messages) {
        for (const [requestId, pendingRequest] of ctx.pending.entries()) {
          if (!isJsonRpcResponseForId(message, requestId)) {
            continue
          }

          ctx.pending.delete(requestId)
          pendingRequest.resolve(message)
          break
        }
      }
    } catch (error) {
      stdioRejectPending(ctx, error)
      if (ctx.sessionReady) {
        void stdioApplyUnexpectedDisconnect(ctx, error)
      }
    }
  })

  spawned.stderr.on('data', (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const normalized = text.trim()
    if (normalized !== '') {
      stdioRecordStderr(ctx, normalized)
    }
  })

  spawned.on('exit', (code, signal) => {
    if (spawned !== ctx.child) {
      ctx.lastExitCode = code ?? null
      ctx.lastExitSignal = signal ?? null
      return
    }

    ctx.lastExitCode = code ?? null
    ctx.lastExitSignal = signal ?? null
    ctx.child = null
    stdioRejectPending(ctx, new McpConnectorError(
      stdioCreateProcessExitSummary(ctx, code, signal),
    ))
    const wasReady = ctx.sessionReady
    ctx.sessionReady = false
    if (wasReady) {
      void stdioApplyUnexpectedDisconnect(
        ctx,
        stdioCreateProcessExitSummary(ctx, code, signal),
      )
    }
  })

  spawned.on('error', (error) => {
    if (spawned !== ctx.child) {
      return
    }

    stdioRejectPending(ctx, error)
    if (ctx.sessionReady) {
      void stdioApplyUnexpectedDisconnect(ctx, error)
    }
  })

  return spawnReady
}

async function stdioPerformHandshake(ctx: StdioContext): Promise<void> {
  await stdioUpdatePhase(ctx, 'initialize')
  const initializeResponse = await stdioSendRequest(ctx, MCP_INITIALIZE_METHOD, createInitializeParams())
  unwrapJsonRpcResponse(initializeResponse, ctx.context.now)
  await stdioUpdatePhase(ctx, 'initialized')
  await stdioSendNotification(ctx, MCP_INITIALIZED_NOTIFICATION_METHOD, {})
}

async function stdioRequestToolsList(
  ctx: StdioContext,
  updatePhaseState: boolean,
): Promise<McpRemoteToolSummary[]> {
  return await stdioWithSerializedPhase(ctx, 'tools/list', async () => {
    if (updatePhaseState) {
      await stdioUpdatePhase(ctx, 'tools/list')
    }

    const response = await stdioSendRequest(ctx, MCP_TOOLS_LIST_METHOD, {})
    const result = unwrapJsonRpcResponse(response, ctx.context.now)
    return normalizeToolsListResult(result)
  })
}

async function stdioCallTool(
  ctx: StdioContext,
  request: McpConnectorToolCallRequest,
): Promise<McpToolCallResult> {
  if (!ctx.sessionReady || ctx.child === null) {
    return {
      ok: false,
      toolId: request.toolId,
      serverId: request.serverId,
      remoteToolName: request.remoteToolName,
      snapshotRevision: request.snapshotRevision ?? null,
      error: createMcpErrorSummary(
        'temporarily_unavailable',
        'The MCP stdio server is not ready to execute tools.',
        { retryable: true, now: ctx.context.now },
      ),
    }
  }

  if (!ctx.tools.some((tool) => tool.name === request.remoteToolName)) {
    return {
      ok: false,
      toolId: request.toolId,
      serverId: request.serverId,
      remoteToolName: request.remoteToolName,
      snapshotRevision: request.snapshotRevision ?? null,
      error: createMcpErrorSummary(
        'directory_drift',
        'The requested MCP tool no longer exists in the current server catalog.',
        { retryable: false, now: ctx.context.now },
      ),
    }
  }

  try {
    const response = await stdioWithSerializedPhase(ctx, 'tools/call', async () => {
      return await stdioSendRequest(ctx, MCP_TOOLS_CALL_METHOD, {
        name: request.remoteToolName,
        arguments: request.arguments,
      }, {
        timeoutMs: Math.max(ctx.context.timeoutMs, STDIO_TOOL_CALL_TIMEOUT_MS),
      })
    })
    const result = unwrapJsonRpcResponse(response, ctx.context.now)
    return normalizeToolsCallResult({
      result,
      request,
      server: ctx.server,
      now: ctx.context.now,
    })
  } catch (error) {
    return {
      ok: false,
      toolId: request.toolId,
      serverId: request.serverId,
      remoteToolName: request.remoteToolName,
      snapshotRevision: request.snapshotRevision ?? null,
      error: normalizeConnectorError(error, ctx.context.now, 'stdio_tool_call_failed'),
    }
  }
}

async function stdioSendRequest(
  ctx: StdioContext,
  method: string,
  params?: unknown,
  options: { timeoutMs?: number } = {},
): Promise<JsonRpcResponsePayload> {
  const activeChild = ctx.child
  if (activeChild === null || activeChild.stdin.destroyed) {
    throw new McpConnectorError(createMcpErrorSummary(
      'connection_closed',
      'The MCP stdio process is not available.',
      { retryable: true, now: ctx.context.now },
    ))
  }

  const requestId = ctx.nextRequestId
  ctx.nextRequestId += 1
  const timeoutMs = options.timeoutMs ?? (ctx.context.timeoutMs > 0 ? ctx.context.timeoutMs : STDIO_CONNECT_TIMEOUT_MS)

  const responsePromise = new Promise<JsonRpcResponsePayload>((resolve, reject) => {
    ctx.pending.set(requestId, { resolve, reject })
    activeChild.stdin.write(encodeJsonRpcMessageLine(createJsonRpcRequest(requestId, method, params)), (error) => {
      if (error === undefined || error === null) {
        return
      }

      const pendingRequest = ctx.pending.get(requestId)
      if (pendingRequest === undefined) {
        return
      }

      ctx.pending.delete(requestId)
      pendingRequest.reject(error)
    })
  })

  return await withTimeout(
    responsePromise,
    timeoutMs,
    ctx.context.now,
    createPhaseTimeoutMessage(ctx.currentPhase),
  )
}

async function stdioWithSerializedPhase<T>(
  ctx: StdioContext,
  phase: McpConnectionPhase,
  work: () => Promise<T>,
): Promise<T> {
  const next = ctx.requestQueue.catch(() => undefined).then(async () => {
    const previousPhase = ctx.currentPhase
    ctx.currentPhase = phase
    try {
      const result = await work()
      ctx.currentPhase = previousPhase
      return result
    } catch (error) {
      ctx.currentPhase = phase
      throw error
    }
  })

  ctx.requestQueue = next.then(() => undefined, () => undefined)
  return await next
}

async function stdioSendNotification(
  ctx: StdioContext,
  method: string,
  params?: unknown,
): Promise<void> {
  const activeChild = ctx.child
  if (activeChild === null || activeChild.stdin.destroyed) {
    throw new McpConnectorError(createMcpErrorSummary(
      'connection_closed',
      'The MCP stdio process is not available.',
      { retryable: true, now: ctx.context.now },
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

async function stdioApplyFailure(
  ctx: StdioContext,
  error: unknown,
): Promise<McpConnectorOperationResult> {
  const summary = stdioEnrichFailureSummary(
    ctx,
    normalizeConnectorError(error, ctx.context.now, 'stdio_connection_failed'),
  )
  await stdioDisposeChild(ctx)
  ctx.sessionReady = false
  const failure = createConnectorFailure(ctx.server, summary, {
    now: ctx.context.now,
    transportState: {
      kind: 'stdio',
      processStatus: ctx.lastExitCode === null && ctx.lastExitSignal === null ? 'stopped' : 'exited',
      pid: null,
      lastExitCode: ctx.lastExitCode,
      lastExitSignal: ctx.lastExitSignal,
    },
    lastPhase: ctx.currentPhase,
    previousTools: ctx.tools,
    lastHandshakeAt: ctx.state.lastHandshakeAt ?? null,
    lastCatalogSyncAt: ctx.state.lastCatalogSyncAt ?? null,
    warnings: stdioGetWarnings(ctx),
  })
  ctx.state = cloneStateSummary(failure.state)
  await stdioEmitState(ctx)
  return failure
}

async function stdioApplyUnexpectedDisconnect(
  ctx: StdioContext,
  error: unknown,
): Promise<void> {
  const summary = stdioEnrichFailureSummary(
    ctx,
    normalizeConnectorError(error, ctx.context.now, 'stdio_disconnected'),
  )
  const failure = createConnectorFailure(ctx.server, summary, {
    now: ctx.context.now,
    transportState: {
      kind: 'stdio',
      processStatus: 'exited',
      pid: null,
      lastExitCode: ctx.lastExitCode,
      lastExitSignal: ctx.lastExitSignal,
    },
    lastPhase: ctx.currentPhase,
    previousTools: ctx.tools,
    lastHandshakeAt: ctx.state.lastHandshakeAt ?? null,
    lastCatalogSyncAt: ctx.state.lastCatalogSyncAt ?? null,
    warnings: stdioGetWarnings(ctx),
  })
  ctx.state = cloneStateSummary(failure.state)
  await stdioEmitState(ctx)
}

async function stdioDisposeChild(ctx: StdioContext): Promise<void> {
  const activeChild = ctx.child
  if (activeChild === null) {
    return
  }

  ctx.child = null
  stdioRejectPending(ctx, new McpConnectorError(createMcpErrorSummary(
    'connection_closed',
    'The MCP stdio connection was closed.',
    { retryable: true, now: ctx.context.now },
  )))

  if (!activeChild.killed) {
    activeChild.kill()
  }

  await Promise.race([
    once(activeChild, 'exit').then(() => undefined).catch(() => undefined),
    delay(150),
  ])
}

function stdioRejectPending(ctx: StdioContext, error: unknown): void {
  for (const [requestId, pendingRequest] of ctx.pending.entries()) {
    ctx.pending.delete(requestId)
    pendingRequest.reject(error)
  }
}

function stdioCreateProcessExitSummary(
  ctx: StdioContext,
  code: number | null,
  signal: NodeJS.Signals | null,
) {
  const stderrSummary = stdioGetStderrSummary(ctx)
  const detailParts = [
    code === null ? null : `exit code ${code}`,
    signal === null ? null : `signal ${signal}`,
    stderrSummary,
  ].filter((value): value is string => value !== null)

  const suffix = detailParts.length === 0 ? '' : ` (${detailParts.join(', ')})`
  return createMcpErrorSummary(
    'process_exited',
    `The MCP stdio process exited unexpectedly${suffix}.`,
    {
      retryable: true,
      now: ctx.context.now,
      details: {
        exitCode: code,
        exitSignal: signal,
        phase: ctx.currentPhase,
        stderrSummary,
      },
    },
  )
}

async function stdioEmitState(ctx: StdioContext): Promise<void> {
  await ctx.context.onStateChange?.(cloneStateSummary(ctx.state))
}

async function stdioUpdatePhase(
  ctx: StdioContext,
  phase: McpConnectionPhase,
): Promise<void> {
  ctx.currentPhase = phase
  ctx.state = createConnectorState(ctx.server, 'connecting', ctx.tools.length, {
    transportState: ctx.child === null
      ? {
          kind: 'stdio',
          processStatus: 'starting',
          pid: null,
          lastExitCode: ctx.lastExitCode,
          lastExitSignal: ctx.lastExitSignal,
        }
      : {
          kind: 'stdio',
          processStatus: 'running',
          pid: ctx.child.pid ?? null,
          lastExitCode: ctx.lastExitCode,
          lastExitSignal: ctx.lastExitSignal,
        },
    lastPhase: phase,
    lastHandshakeAt: ctx.state.lastHandshakeAt ?? null,
    lastCatalogSyncAt: ctx.state.lastCatalogSyncAt ?? null,
    lastError: null,
  })
  await stdioEmitState(ctx)
}

function stdioRecordStderr(ctx: StdioContext, text: string): void {
  for (const line of text.split(/\r?\n/gu)) {
    const normalized = line.trim()
    if (normalized === '') {
      continue
    }

    ctx.stderrLines.push(normalized)
    while (ctx.stderrLines.length > STDERR_SUMMARY_MAX_LINES) {
      ctx.stderrLines.shift()
    }
  }
}

function stdioGetStderrSummary(ctx: StdioContext): string | null {
  return ctx.stderrLines.length === 0 ? null : ctx.stderrLines.join(' | ')
}

function stdioGetWarnings(ctx: StdioContext): string[] {
  const stderrSummary = stdioGetStderrSummary(ctx)
  return stderrSummary === null ? [] : [stderrSummary]
}

function stdioEnrichFailureSummary(
  ctx: StdioContext,
  summary: ReturnType<typeof normalizeConnectorError>,
): ReturnType<typeof normalizeConnectorError> {
  const phase = ctx.currentPhase
  const stderrSummary = stdioGetStderrSummary(ctx)
  const diagnosticSummary = buildDiagnosticSummary(phase, stderrSummary, ctx)
  const nextDetails = {
    ...(summary.details ?? {}),
    phase,
    requestedCommand: ctx.resolvedCommand.requestedCommand,
    resolutionKind: ctx.resolvedCommand.resolutionKind,
    managedFamily: ctx.resolvedCommand.managedFamily ?? null,
    command: ctx.transportConfig.command,
    args: [...ctx.transportConfig.args],
    cwd: ctx.transportConfig.cwd ?? null,
    stderrSummary,
    diagnosticSummary,
  }

  return {
    ...summary,
    message: createPhaseAwareMessage(summary, phase),
    details: nextDetails,
  }
}

function stdioReadManagedRuntimeFailure(ctx: StdioContext) {
  const rawFailure = ctx.transportConfig.env?.CANDUE_MANAGED_RUNTIME_ERROR
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
      {
        retryable: false,
        now: () => typeof parsed.observedAt === 'string' && parsed.observedAt.trim() !== ''
          ? parsed.observedAt
          : ctx.context.now(),
        details: isRecord(parsed.details) ? parsed.details : null,
      },
    )
  } catch {
    return createMcpErrorSummary(
      'managed_runtime_unavailable',
      'The managed runtime required by this MCP launcher is unavailable.',
      { retryable: false, now: ctx.context.now },
    )
  }
}

function buildDiagnosticSummary(
  phase: McpConnectionPhase | null,
  stderrSummary: string | null,
  ctx: StdioContext,
): string {
  const parts = [
    phase === null ? null : `phase=${phase}`,
    `requestedCommand=${ctx.resolvedCommand.requestedCommand}`,
    `resolution=${ctx.resolvedCommand.resolutionKind}`,
    ctx.resolvedCommand.managedFamily ? `managedFamily=${ctx.resolvedCommand.managedFamily}` : null,
    `command=${ctx.transportConfig.command}`,
    ctx.transportConfig.args.length === 0 ? null : `args=${ctx.transportConfig.args.join(' ')}`,
    ctx.transportConfig.cwd ? `cwd=${ctx.transportConfig.cwd}` : null,
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

function createPhaseTimeoutMessage(phase: McpConnectionPhase | null): string {
  if (phase === null) {
    return STDIO_REQUEST_TIMEOUT_MESSAGE
  }

  return `Timed out while waiting for the MCP stdio server response during ${phase}.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
