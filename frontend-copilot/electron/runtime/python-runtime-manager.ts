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
import { buildPythonRuntimeSpawnArguments } from './runtime-spawn-args'
import {
  RuntimeTextFileSink,
  type RuntimeLogLevel,
} from './runtime-observability'
import {
  FAILED_START_CLEANUP_TIMEOUT_MS,
  buildCapturedOutputSummary,
  requestRuntimeChildTermination,
  waitForChildExit,
  type ChildExitResult,
} from './python-runtime-process'
import { prepareRuntimePaths, createPrepareRuntimePathsFailure } from './python-runtime-paths-support'
import { probeRuntimeReadiness } from './python-runtime-readiness'
import {
  resolvePythonRuntimeLaunchSpec,
  type PythonRuntimeLaunchSpec,
  type PythonRuntimeResolverContext,
} from './python-runtime-resolver'
import {
  appendFailureDetail,
  createHostedBackendFailure,
  type HostedBackendFailure,
} from './runtime-diagnostics'
import {
  appendRuntimeCapturedOutput,
  closeRuntimeOutputSinks,
  initializeRuntimeOutputSinks,
  trackSpawnedRuntimeProcess,
  type ExpectedRuntimeExitDisposition,
} from './python-runtime-lifecycle-support'
import {
  persistRuntimeObservability,
  summarizeHostedBackendState,
  summarizeLaunchSpec,
} from './python-runtime-observability-support'
import { collectSensitiveValues } from './runtime-redaction'
import { createHostedRuntimePaths, type HostedRuntimePaths } from './runtime-paths'
import {
  createInitialHostedBackendState,
  markHostedBackendFailed,
  markHostedBackendReady,
  markHostedBackendStarting,
  markHostedBackendStopped,
  type HostedBackendState,
} from './runtime-state'
import {
  normalizePythonRuntimeStartFailure,
  terminateRuntimeChildAfterFailedStart,
} from './python-runtime-startup-failure'

export interface PythonRuntimeManagerOptions extends PythonRuntimeResolverContext {
  userDataPath: string
  runtimePaths?: HostedRuntimePaths
  environment?: string
  processEnv?: NodeJS.ProcessEnv
  host?: string
  appMode?: string
  model?: string | null
  configuredModel?: string | null
  localToken?: string
  hostModelRouteBridgeUrl?: string | null
  hostModelRouteBridgeToken?: string | null
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
  configuredModel?: string | null
  localToken?: string
  hostModelRouteBridgeUrl?: string | null
  hostModelRouteBridgeToken?: string | null
  startupTimeoutMs: number
  shutdownTimeoutMs: number
  healthcheckIntervalMs: number
  healthcheckRequestTimeoutMs: number
}

type SpawnedRuntimeChild = ReturnType<typeof spawn>

export class PythonRuntimeManager {
  private readonly options: ResolvedPythonRuntimeManagerOptions
  private readonly runtimePaths: HostedRuntimePaths

  private state: HostedBackendState = createInitialHostedBackendState()
  private child: SpawnedRuntimeChild | null = null
  private launchConfig: HostedRuntimeLaunchConfig | null = null
  private startPromise: Promise<HostedBackendState> | null = null
  private stopPromise: Promise<void> | null = null
  private childExitPromise: Promise<ChildExitResult> | null = null
  private runtimeExitFailure: HostedBackendFailure | null = null
  private expectedExitDisposition: ExpectedRuntimeExitDisposition = 'none'
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
    this.launchConfig = null

    await this.ensurePreparedRuntimePaths()

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
      configuredModel: this.options.configuredModel,
      localToken: this.options.localToken,
      hostModelRouteBridgeUrl: this.options.hostModelRouteBridgeUrl,
      hostModelRouteBridgeToken: this.options.hostModelRouteBridgeToken,
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
        detail: this.getCapturedOutputSummary(),
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
          detail: this.getCapturedOutputSummary(),
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

  private async ensurePreparedRuntimePaths(): Promise<void> {
    try {
      await prepareRuntimePaths(this.runtimePaths)
    } catch (error) {
      const failure = createPrepareRuntimePathsFailure(error)
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

    const sinks = await initializeRuntimeOutputSinks({
      launchConfig: this.launchConfig,
      sensitiveValues: this.getSensitiveValues(),
      persistObservability: (level, message, context) => this.persistObservability(level, message, context),
    })
    this.stdoutSink = sinks.stdoutSink
    this.stderrSink = sinks.stderrSink
  }

  private async closeOutputSinks(): Promise<void> {
    const stdoutSink = this.stdoutSink
    const stderrSink = this.stderrSink
    this.stdoutSink = null
    this.stderrSink = null

    await closeRuntimeOutputSinks({ stdoutSink, stderrSink })
  }

  private trackSpawnedProcess(child: SpawnedRuntimeChild): void {
    this.childExitPromise = trackSpawnedRuntimeProcess({
      child,
      getActiveChild: () => this.child,
      clearActiveChild: () => {
        this.child = null
        this.childExitPromise = null
      },
      takeExpectedExitDisposition: () => {
        const expectedDisposition = this.expectedExitDisposition
        this.expectedExitDisposition = 'none'
        return expectedDisposition
      },
      getState: () => this.state,
      setState: (state) => {
        this.state = state
      },
      getCapturedOutputSummary: () => this.getCapturedOutputSummary(),
      setRuntimeExitFailure: (failure) => {
        this.runtimeExitFailure = failure
      },
      persistObservability: (level, message, context) => this.persistObservability(level, message, context),
      closeOutputSinks: () => this.closeOutputSinks(),
      appendStdoutChunk: (chunk) => {
        this.stdoutOutput = appendRuntimeCapturedOutput(this.stdoutOutput, chunk)
        this.stdoutSink?.write(chunk)
      },
      appendStderrChunk: (chunk) => {
        this.stderrOutput = appendRuntimeCapturedOutput(this.stderrOutput, chunk)
        this.stderrSink?.write(chunk)
      },
    })
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
      this.getCapturedOutputSummary(),
    )
  }

  private normalizeStartFailure(error: unknown): HostedBackendFailure {
    return normalizePythonRuntimeStartFailure(error, this.getCapturedOutputSummary())
  }

  private async terminateChildAfterFailedStart(): Promise<void> {
    await terminateRuntimeChildAfterFailedStart({
      child: this.child,
      exitPromise: this.childExitPromise,
      closeOutputSinks: () => this.closeOutputSinks(),
      markExpectedFailedStartExit: () => {
        this.expectedExitDisposition = 'failed-start'
      },
    })
  }

  private getCapturedOutputSummary(): string | null {
    return buildCapturedOutputSummary(this.stdoutOutput, this.stderrOutput)
  }

  private getSensitiveValues(): string[] {
    return collectSensitiveValues(
      this.launchConfig?.localToken,
      this.launchConfig?.hostModelRouteBridgeToken,
    )
  }

  private async persistObservability(
    level?: RuntimeLogLevel,
    message?: string,
    context?: unknown,
  ): Promise<void> {
    await persistRuntimeObservability({
      runtimePaths: this.runtimePaths,
      launchConfig: this.launchConfig,
      state: this.state,
      lastFailure: this.state.lastFailure,
      sensitiveValues: this.getSensitiveValues(),
      level,
      message,
      context,
    })
  }
}

export function createPythonRuntimeManager(options: PythonRuntimeManagerOptions): PythonRuntimeManager {
  return new PythonRuntimeManager(options)
}

function cloneHostedBackendState(state: HostedBackendState): HostedBackendState {
  return {
    ...state,
    lastFailure: state.lastFailure === null ? null : { ...state.lastFailure },
  }
}

export { buildPythonRuntimeSpawnArguments } from './runtime-spawn-args'
