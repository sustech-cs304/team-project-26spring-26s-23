import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import {
  DEFAULT_HEALTHCHECK_INTERVAL_MS,
  DEFAULT_HEALTHCHECK_REQUEST_TIMEOUT_MS,
  DEFAULT_RUNTIME_APP_MODE,
  DEFAULT_RUNTIME_HOST,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_STARTUP_TIMEOUT_MS,
  allocateLoopbackPort,
  createHostedRuntimeLaunchConfig,
  resolveHostedRuntimeEnvironmentOverrides,
  sanitizeHostedRuntimeLaunchConfig,
  type HostedRuntimeLaunchConfig,
} from './runtime-config'
import {
  appendRuntimeLog,
  buildHostedRuntimeSnapshot,
  RuntimeTextFileSink,
  writeHostedRuntimeSnapshot,
  writeLastFailureRecord,
  type RuntimeLogLevel,
} from './runtime-observability'
import {
  resolvePythonRuntimeLaunchSpec,
  type PythonRuntimeLaunchSpec,
  type PythonRuntimeResolverContext,
} from './python-runtime-resolver'
import {
  appendFailureDetail,
  classifyUnexpectedExit,
  createHostedBackendFailure,
  summarizeUnknownError,
  type HostedBackendFailure,
} from './runtime-diagnostics'
import { collectSensitiveValues } from './runtime-redaction'
import { createHostedRuntimePaths, ensureHostedRuntimeDirectories, type HostedRuntimePaths } from './runtime-paths'
import {
  createInitialHostedBackendState,
  markHostedBackendDegraded,
  markHostedBackendFailed,
  markHostedBackendReady,
  markHostedBackendStarting,
  markHostedBackendStopped,
  type HostedBackendState,
} from './runtime-state'

export interface PythonRuntimeManagerOptions extends PythonRuntimeResolverContext {
  userDataPath: string
  runtimePaths?: HostedRuntimePaths
  environment?: string
  processEnv?: NodeJS.ProcessEnv
  host?: string
  appMode?: string
  model?: string | null
  localToken?: string
  startupTimeoutMs?: number
  shutdownTimeoutMs?: number
  healthcheckIntervalMs?: number
  healthcheckRequestTimeoutMs?: number
}

interface ResolvedPythonRuntimeManagerOptions extends PythonRuntimeResolverContext {
  userDataPath: string
  processEnv: NodeJS.ProcessEnv
  host: string
  appMode: string
  environment: string
  model?: string | null
  localToken?: string
  startupTimeoutMs: number
  shutdownTimeoutMs: number
  healthcheckIntervalMs: number
  healthcheckRequestTimeoutMs: number
}

interface ChildExitResult {
  code: number | null
  signal: NodeJS.Signals | null
}

interface ReadinessProbeResult {
  ready: boolean
  detail: string | null
}

type SpawnedRuntimeChild = ReturnType<typeof spawn>
type ExpectedExitDisposition = 'none' | 'stopped' | 'failed-start' | 'failed-shutdown'

const MAX_CAPTURED_OUTPUT_LENGTH = 8_000
const FAILED_START_CLEANUP_TIMEOUT_MS = 1_500

export class PythonRuntimeManager {
  private readonly options: ResolvedPythonRuntimeManagerOptions
  private readonly runtimePaths: HostedRuntimePaths

  private state: HostedBackendState = createInitialHostedBackendState()
  private child: SpawnedRuntimeChild | null = null
  private launchConfig: HostedRuntimeLaunchConfig | null = null
  private startPromise: Promise<HostedBackendState> | null = null
  private stopPromise: Promise<void> | null = null
  private childExitPromise: Promise<ChildExitResult> | null = null
  private resolveChildExit: ((result: ChildExitResult) => void) | null = null
  private runtimeExitFailure: HostedBackendFailure | null = null
  private expectedExitDisposition: ExpectedExitDisposition = 'none'
  private stdoutOutput = ''
  private stderrOutput = ''
  private stdoutSink: RuntimeTextFileSink | null = null
  private stderrSink: RuntimeTextFileSink | null = null

  constructor(options: PythonRuntimeManagerOptions) {
    const processEnv = options.processEnv ?? process.env
    const envOverrides = resolveHostedRuntimeEnvironmentOverrides(processEnv)

    this.options = {
      ...options,
      processEnv,
      host: options.host ?? envOverrides.host ?? DEFAULT_RUNTIME_HOST,
      appMode: options.appMode ?? DEFAULT_RUNTIME_APP_MODE,
      environment: options.environment
        ?? envOverrides.environment
        ?? (options.isPackaged ? 'production' : 'development'),
      startupTimeoutMs: options.startupTimeoutMs
        ?? envOverrides.startupTimeoutMs
        ?? DEFAULT_STARTUP_TIMEOUT_MS,
      shutdownTimeoutMs: options.shutdownTimeoutMs
        ?? envOverrides.shutdownTimeoutMs
        ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
      healthcheckIntervalMs: options.healthcheckIntervalMs
        ?? envOverrides.healthcheckIntervalMs
        ?? DEFAULT_HEALTHCHECK_INTERVAL_MS,
      healthcheckRequestTimeoutMs: options.healthcheckRequestTimeoutMs
        ?? envOverrides.healthcheckRequestTimeoutMs
        ?? DEFAULT_HEALTHCHECK_REQUEST_TIMEOUT_MS,
    }
    this.runtimePaths = options.runtimePaths ?? createHostedRuntimePaths(options.userDataPath)
  }

  getState(): HostedBackendState {
    return cloneHostedBackendState(this.state)
  }

  getLastFailure(): HostedBackendFailure | null {
    return this.state.lastFailure === null ? null : { ...this.state.lastFailure }
  }

  getRuntimeBaseUrl(): string | null {
    return this.launchConfig?.baseUrl ?? this.state.baseUrl
  }

  isReady(): boolean {
    return this.state.status === 'ready'
  }

  async start(): Promise<HostedBackendState> {
    if (this.startPromise !== null) {
      return await this.startPromise
    }

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null
    })

    return await this.startPromise
  }

  async stop(): Promise<void> {
    if (this.stopPromise !== null) {
      await this.stopPromise
      return
    }

    this.stopPromise = this.stopInternal().finally(() => {
      this.stopPromise = null
    })

    await this.stopPromise
  }

  private async startInternal(): Promise<HostedBackendState> {
    if (this.child !== null && this.state.status === 'ready') {
      return this.getState()
    }

    if (this.stopPromise !== null) {
      await this.stopPromise
    }

    await this.closeOutputSinks()
    this.runtimeExitFailure = null
    this.expectedExitDisposition = 'none'
    this.stdoutOutput = ''
    this.stderrOutput = ''
    this.childExitPromise = null
    this.resolveChildExit = null
    this.launchConfig = null

    await this.prepareRuntimePaths()

    let launchSpec: PythonRuntimeLaunchSpec

    try {
      launchSpec = await resolvePythonRuntimeLaunchSpec({
        appRoot: this.options.appRoot,
        resourcesPath: this.options.resourcesPath,
        isPackaged: this.options.isPackaged,
      })
    } catch (error) {
      const failure = createHostedBackendFailure({
        code: 'runtime_resolution_failed',
        phase: 'resolve',
        message: 'Failed to resolve the desktop runtime launch specification.',
        cause: error,
        retryable: false,
      })
      this.state = markHostedBackendFailed(this.state, { failure })
      this.runtimeExitFailure = failure
      await this.persistObservability('error', 'Failed to resolve the hosted desktop runtime launch specification.', {
        failure,
      })
      throw failure
    }

    let port: number

    try {
      port = await allocateLoopbackPort(this.options.host)
    } catch (error) {
      const failure = createHostedBackendFailure({
        code: 'port_allocation_failed',
        phase: 'configure',
        message: 'Failed to allocate a loopback port for the desktop runtime.',
        cause: error,
      })
      this.state = markHostedBackendFailed(this.state, { failure })
      this.runtimeExitFailure = failure
      await this.persistObservability('error', 'Failed to allocate a loopback port for the hosted desktop runtime.', {
        failure,
      })
      throw failure
    }

    this.launchConfig = createHostedRuntimeLaunchConfig({
      userDataPath: this.options.userDataPath,
      processEnv: this.options.processEnv,
      port,
      host: this.options.host,
      appMode: this.options.appMode,
      environment: this.options.environment,
      model: this.options.model,
      localToken: this.options.localToken,
      paths: this.runtimePaths,
    })

    const childArgs = buildPythonRuntimeSpawnArguments(launchSpec.args, this.launchConfig.args)

    await this.persistObservability('info', 'Prepared hosted desktop runtime launch configuration.', {
      launchConfig: sanitizeHostedRuntimeLaunchConfig(this.launchConfig),
      launchSpec: summarizeLaunchSpec(launchSpec, childArgs),
    })
    await this.initializeOutputSinks()

    const child = spawn(launchSpec.command, childArgs, {
      cwd: launchSpec.workingDirectory,
      env: {
        ...this.launchConfig.env,
        ...launchSpec.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.child = child
    this.trackSpawnedProcess(child)
    this.state = markHostedBackendStarting(this.state, {
      mode: launchSpec.mode,
      baseUrl: this.launchConfig.baseUrl,
      pid: child.pid ?? null,
    })
    await this.persistObservability('info', 'Spawned hosted desktop runtime process.', {
      state: summarizeHostedBackendState(this.state),
    })

    try {
      await this.waitForRuntimeReady(child, this.launchConfig)
      this.state = markHostedBackendReady(this.state)
      await this.persistObservability('info', 'Hosted desktop runtime reported ready.', {
        state: summarizeHostedBackendState(this.state),
      })
      return this.getState()
    } catch (error) {
      const failure = this.normalizeStartFailure(error)
      this.state = markHostedBackendFailed(this.state, { failure })
      this.runtimeExitFailure = failure
      await this.persistObservability('error', 'Hosted desktop runtime failed during startup.', {
        failure,
        state: summarizeHostedBackendState(this.state),
      })
      await this.terminateChildAfterFailedStart()
      throw failure
    }
  }

  private async stopInternal(): Promise<void> {
    const activeChild = this.child
    const activeExitPromise = this.childExitPromise

    if (activeChild === null || activeExitPromise === null) {
      if (this.state.status === 'ready' || this.state.status === 'starting') {
        this.state = markHostedBackendStopped(this.state)
        await this.persistObservability('info', 'Marked hosted desktop runtime as stopped without an active child process.', {
          state: summarizeHostedBackendState(this.state),
        })
      }
      await this.closeOutputSinks()
      return
    }

    this.expectedExitDisposition = 'stopped'

    try {
      requestRuntimeChildTermination(activeChild, 'SIGTERM')
      await waitForChildExit(activeExitPromise, this.options.shutdownTimeoutMs)
    } catch (error) {
      const timeoutFailure = createHostedBackendFailure({
        code: 'shutdown_timeout',
        phase: 'shutdown',
        message: `Timed out after ${this.options.shutdownTimeoutMs}ms while waiting for the desktop runtime to exit.`,
        detail: this.buildCapturedOutputSummary(),
        cause: error,
        retryable: false,
      })
      this.state = markHostedBackendFailed(this.state, { failure: timeoutFailure })
      this.runtimeExitFailure = timeoutFailure
      this.expectedExitDisposition = 'failed-shutdown'
      await this.persistObservability('error', 'Timed out while stopping the hosted desktop runtime.', {
        failure: timeoutFailure,
        state: summarizeHostedBackendState(this.state),
      })

      try {
        requestRuntimeChildTermination(activeChild, 'SIGKILL')
        await waitForChildExit(activeExitPromise, FAILED_START_CLEANUP_TIMEOUT_MS)
      } catch (killError) {
        const shutdownFailure = createHostedBackendFailure({
          code: 'shutdown_failed',
          phase: 'shutdown',
          message: 'Failed to terminate the desktop runtime process during shutdown.',
          detail: this.buildCapturedOutputSummary(),
          cause: killError,
          retryable: false,
        })
        this.state = markHostedBackendFailed(this.state, { failure: shutdownFailure })
        this.runtimeExitFailure = shutdownFailure
        await this.persistObservability('error', 'Failed to force-stop the hosted desktop runtime.', {
          failure: shutdownFailure,
          state: summarizeHostedBackendState(this.state),
        })
      }
    }
  }

  private async prepareRuntimePaths(): Promise<void> {
    try {
      await ensureHostedRuntimeDirectories(this.runtimePaths)
    } catch (error) {
      const failure = createHostedBackendFailure({
        code: 'runtime_resolution_failed',
        phase: 'configure',
        message: 'Failed to prepare runtime directories for the desktop backend.',
        cause: error,
        retryable: false,
      })
      this.state = markHostedBackendFailed(this.state, { failure })
      this.runtimeExitFailure = failure
      await this.persistObservability('error', 'Failed to prepare hosted desktop runtime directories.', {
        failure,
      })
      throw failure
    }
  }

  private async initializeOutputSinks(): Promise<void> {
    await this.closeOutputSinks()

    if (this.launchConfig === null) {
      return
    }

    try {
      const sensitiveValues = this.getSensitiveValues()
      this.stdoutSink = new RuntimeTextFileSink(this.launchConfig.paths.backendStdoutLogFile, sensitiveValues)
      this.stderrSink = new RuntimeTextFileSink(this.launchConfig.paths.backendStderrLogFile, sensitiveValues)
    } catch (error) {
      this.stdoutSink = null
      this.stderrSink = null
      await this.persistObservability('warn', 'Failed to initialize backend stdout/stderr log sinks.', {
        detail: summarizeUnknownError(error),
      })
    }
  }

  private async closeOutputSinks(): Promise<void> {
    const stdoutSink = this.stdoutSink
    const stderrSink = this.stderrSink
    this.stdoutSink = null
    this.stderrSink = null

    await Promise.all([
      stdoutSink?.close(),
      stderrSink?.close(),
    ].filter((operation): operation is Promise<void> => operation !== undefined).map((operation) => {
      return operation.catch((error) => {
        console.error('[desktop-runtime] Failed to close runtime log sink.', summarizeUnknownError(error))
      })
    }))
  }

  private trackSpawnedProcess(child: SpawnedRuntimeChild): void {
    this.childExitPromise = new Promise<ChildExitResult>((resolve) => {
      this.resolveChildExit = resolve
    })

    child.stdout?.on('data', (chunk) => {
      this.stdoutOutput = appendCapturedText(this.stdoutOutput, chunk)
      this.stdoutSink?.write(chunk)
    })

    child.stderr?.on('data', (chunk) => {
      this.stderrOutput = appendCapturedText(this.stderrOutput, chunk)
      this.stderrSink?.write(chunk)
    })

    child.once('error', (error) => {
      if (this.child !== child) {
        return
      }

      const failure = createHostedBackendFailure({
        code: 'spawn_failed',
        phase: 'spawn',
        message: 'Failed to spawn the desktop runtime process.',
        cause: error,
      })

      this.runtimeExitFailure = appendFailureDetail(failure, this.buildCapturedOutputSummary())
      this.state = markHostedBackendFailed(this.state, { failure: this.runtimeExitFailure })
      this.child = null
      this.settleChildExit({ code: null, signal: null })
      void this.persistObservability('error', 'Failed to spawn the hosted desktop runtime process.', {
        failure: this.runtimeExitFailure,
        state: summarizeHostedBackendState(this.state),
      })
      void this.closeOutputSinks()
    })

    child.once('exit', (code, signal) => {
      if (this.child !== child) {
        return
      }

      const expectedDisposition = this.expectedExitDisposition
      this.expectedExitDisposition = 'none'
      this.child = null
      this.settleChildExit({ code, signal })

      if (expectedDisposition === 'stopped') {
        this.state = markHostedBackendStopped(this.state, { exitCode: code, signal })
        void this.persistObservability('info', 'Hosted desktop runtime process exited after shutdown request.', {
          state: summarizeHostedBackendState(this.state),
        })
        void this.closeOutputSinks()
        return
      }

      if (expectedDisposition === 'failed-start' || expectedDisposition === 'failed-shutdown') {
        if (this.state.lastFailure !== null) {
          this.state = markHostedBackendFailed(this.state, {
            failure: this.state.lastFailure,
            exitCode: code,
            signal,
          })
        }
        void this.persistObservability(undefined, undefined, undefined)
        void this.closeOutputSinks()
        return
      }

      const failure = appendFailureDetail(
        classifyUnexpectedExit(code, signal, this.state.status === 'ready' ? 'runtime' : 'healthcheck'),
        this.buildCapturedOutputSummary(),
      )

      this.runtimeExitFailure = failure
      this.state = this.state.status === 'ready'
        ? markHostedBackendDegraded(this.state, { failure, exitCode: code, signal })
        : markHostedBackendFailed(this.state, { failure, exitCode: code, signal })
      void this.persistObservability('error', 'Hosted desktop runtime exited unexpectedly.', {
        failure,
        state: summarizeHostedBackendState(this.state),
      })
      void this.closeOutputSinks()
    })
  }

  private settleChildExit(result: ChildExitResult): void {
    this.resolveChildExit?.(result)
    this.resolveChildExit = null
    this.childExitPromise = null
  }

  private async waitForRuntimeReady(
    child: SpawnedRuntimeChild,
    config: HostedRuntimeLaunchConfig,
  ): Promise<void> {
    const startedAt = Date.now()
    let lastDetail: string | null = null

    while (Date.now() - startedAt < this.options.startupTimeoutMs) {
      if (this.child !== child) {
        throw this.runtimeExitFailure ?? createHostedBackendFailure({
          code: 'unexpected_exit',
          phase: 'healthcheck',
          message: 'Desktop runtime exited before the readiness check completed.',
        })
      }

      if (this.runtimeExitFailure !== null) {
        throw this.runtimeExitFailure
      }

      const probeResult = await probeRuntimeReadiness(config.readyUrl, this.options.healthcheckRequestTimeoutMs)
      if (probeResult.ready) {
        return
      }

      lastDetail = probeResult.detail
      await delay(this.options.healthcheckIntervalMs)
    }

    throw appendFailureDetail(
      appendFailureDetail(
        createHostedBackendFailure({
          code: 'startup_timeout',
          phase: 'healthcheck',
          message: `Desktop runtime did not become ready within ${this.options.startupTimeoutMs}ms.`,
        }),
        lastDetail,
      ),
      this.buildCapturedOutputSummary(),
    )
  }

  private normalizeStartFailure(error: unknown): HostedBackendFailure {
    if (isHostedBackendFailureLike(error)) {
      return appendFailureDetail(error, this.buildCapturedOutputSummary())
    }

    return appendFailureDetail(
      createHostedBackendFailure({
        code: 'healthcheck_failed',
        phase: 'healthcheck',
        message: 'Desktop runtime failed during readiness probing.',
        cause: error,
      }),
      this.buildCapturedOutputSummary(),
    )
  }

  private async terminateChildAfterFailedStart(): Promise<void> {
    const activeChild = this.child
    const activeExitPromise = this.childExitPromise

    if (activeChild === null || activeExitPromise === null) {
      await this.closeOutputSinks()
      return
    }

    this.expectedExitDisposition = 'failed-start'

    try {
      requestRuntimeChildTermination(activeChild, 'SIGTERM')
      await waitForChildExit(activeExitPromise, FAILED_START_CLEANUP_TIMEOUT_MS)
    } catch {
      try {
        requestRuntimeChildTermination(activeChild, 'SIGKILL')
        await waitForChildExit(activeExitPromise, FAILED_START_CLEANUP_TIMEOUT_MS)
      } catch {
        // Best effort cleanup only; the startup failure itself is already recorded in state.
      }
    }
  }

  private buildCapturedOutputSummary(): string | null {
    const sections: string[] = []

    if (this.stdoutOutput.trim() !== '') {
      sections.push(`stdout:\n${this.stdoutOutput.trim()}`)
    }

    if (this.stderrOutput.trim() !== '') {
      sections.push(`stderr:\n${this.stderrOutput.trim()}`)
    }

    return sections.length === 0 ? null : sections.join('\n\n')
  }

  private getSensitiveValues(): string[] {
    return collectSensitiveValues(this.launchConfig?.localToken)
  }

  private async persistObservability(
    level?: RuntimeLogLevel,
    message?: string,
    context?: unknown,
  ): Promise<void> {
    const sensitiveValues = this.getSensitiveValues()

    try {
      await Promise.all([
        writeHostedRuntimeSnapshot(
          this.runtimePaths.runtimeSnapshotFile,
          buildHostedRuntimeSnapshot({
            paths: this.runtimePaths,
            launchConfig: this.launchConfig === null ? null : sanitizeHostedRuntimeLaunchConfig(this.launchConfig),
            state: this.getState(),
            lastFailure: this.getLastFailure(),
          }),
          sensitiveValues,
        ),
        writeLastFailureRecord(
          this.runtimePaths.lastFailureFile,
          {
            updatedAt: new Date().toISOString(),
            status: this.state.status,
            failure: this.getLastFailure(),
          },
          sensitiveValues,
        ),
      ])

      if (level !== undefined && message !== undefined) {
        await appendRuntimeLog(this.runtimePaths.hostLogFile, {
          source: 'python-runtime-manager',
          level,
          message,
          context,
        }, sensitiveValues)
      }
    } catch (error) {
      console.error('[desktop-runtime] Failed to persist runtime observability artifacts.', summarizeUnknownError(error))
    }
  }
}

export function createPythonRuntimeManager(options: PythonRuntimeManagerOptions): PythonRuntimeManager {
  return new PythonRuntimeManager(options)
}

function requestRuntimeChildTermination(
  child: SpawnedRuntimeChild,
  signal: 'SIGTERM' | 'SIGKILL',
): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  try {
    if (process.platform === 'win32') {
      child.kill()
      return
    }

    child.kill(signal)
  } catch {
    // Ignore termination races when the child exits between the liveness check and kill request.
  }
}

async function probeRuntimeReadiness(url: string, requestTimeoutMs: number): Promise<ReadinessProbeResult> {
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => {
    controller.abort()
  }, requestTimeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    const responseText = await response.text()

    if (!response.ok) {
      return {
        ready: false,
        detail: `Readiness probe returned HTTP ${response.status}${responseText.trim() === '' ? '' : `: ${truncateText(responseText)}`}`,
      }
    }

    const payload = parseJsonResponse(responseText)
    if (isRuntimeReadyPayload(payload)) {
      return { ready: true, detail: null }
    }

    return {
      ready: false,
      detail: payload === null
        ? 'Readiness probe returned an empty response body.'
        : `Runtime reported not ready yet: ${truncateText(JSON.stringify(payload))}`,
    }
  } catch (error) {
    return {
      ready: false,
      detail: error instanceof Error && error.name === 'AbortError'
        ? `Readiness probe timed out after ${requestTimeoutMs}ms.`
        : `Readiness probe failed: ${summarizeUnknownError(error)}`,
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function parseJsonResponse(text: string): unknown | null {
  const normalizedText = text.trim()
  if (normalizedText === '') {
    return null
  }

  try {
    return JSON.parse(normalizedText) as unknown
  } catch {
    return normalizedText
  }
}

function isRuntimeReadyPayload(payload: unknown): payload is { ready: true } {
  return typeof payload === 'object'
    && payload !== null
    && 'ready' in payload
    && payload.ready === true
}

function appendCapturedText(current: string, chunk: string | Buffer): string {
  const nextChunk = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  const combined = `${current}${nextChunk}`

  if (combined.length <= MAX_CAPTURED_OUTPUT_LENGTH) {
    return combined
  }

  return combined.slice(-MAX_CAPTURED_OUTPUT_LENGTH)
}

function truncateText(text: string): string {
  const normalizedText = text.replace(/\s+/g, ' ').trim()
  if (normalizedText.length <= 300) {
    return normalizedText
  }

  return `${normalizedText.slice(0, 297)}...`
}

function cloneHostedBackendState(state: HostedBackendState): HostedBackendState {
  return {
    ...state,
    lastFailure: state.lastFailure === null ? null : { ...state.lastFailure },
  }
}

function isHostedBackendFailureLike(value: unknown): value is HostedBackendFailure {
  return typeof value === 'object'
    && value !== null
    && 'code' in value
    && 'phase' in value
    && 'message' in value
    && 'timestamp' in value
}

export function buildPythonRuntimeSpawnArguments(
  launchSpecArgs: readonly string[],
  runtimeArgs: readonly string[],
): string[] {
  return [...launchSpecArgs, ...runtimeArgs]
}

function summarizeLaunchSpec(
  spec: PythonRuntimeLaunchSpec,
  args: readonly string[] = spec.args,
): Record<string, unknown> {
  return {
    mode: spec.mode,
    workspaceRoot: spec.workspaceRoot,
    backendDir: spec.backendDir,
    resourcesRoot: spec.resourcesRoot,
    workingDirectory: spec.workingDirectory,
    entryModule: spec.entryModule,
    command: spec.command,
    baseArgs: [...spec.args],
    runtimeArgs: args.slice(spec.args.length),
    args: [...args],
    manifestPath: spec.manifestPath,
    pythonExecutablePath: spec.pythonExecutablePath,
    pythonPathEntries: [...spec.pythonPathEntries],
    sitePackagesEntries: [...spec.sitePackagesEntries],
  }
}

function summarizeHostedBackendState(state: HostedBackendState): Record<string, unknown> {
  return {
    status: state.status,
    mode: state.mode,
    baseUrl: state.baseUrl,
    pid: state.pid,
    startedAt: state.startedAt,
    readyAt: state.readyAt,
    stoppedAt: state.stoppedAt,
    exitCode: state.exitCode,
    signal: state.signal,
    lastFailure: state.lastFailure,
  }
}

async function waitForChildExit(exitPromise: Promise<ChildExitResult>, timeoutMs: number): Promise<ChildExitResult> {
  return await Promise.race([
    exitPromise,
    delay(timeoutMs).then(() => {
      throw new Error(`Timed out after ${timeoutMs}ms while waiting for the child process to exit.`)
    }),
  ])
}
