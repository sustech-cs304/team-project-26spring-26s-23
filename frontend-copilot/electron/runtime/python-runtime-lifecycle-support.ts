import type { HostedRuntimeLaunchConfig } from './runtime-config'
import { RuntimeTextFileSink, type RuntimeLogLevel } from './runtime-observability'
import {
  appendCapturedText,
  type ChildExitResult,
  type SpawnedRuntimeChild,
} from './python-runtime-process'
import {
  appendFailureDetail,
  classifyUnexpectedExit,
  createHostedBackendFailure,
  summarizeUnknownError,
  type HostedBackendFailure,
} from './runtime-diagnostics'
import {
  markHostedBackendDegraded,
  markHostedBackendFailed,
  markHostedBackendStopped,
  type HostedBackendState,
} from './runtime-state'
import { summarizeHostedBackendState } from './python-runtime-observability-support'

export type ExpectedRuntimeExitDisposition = 'none' | 'stopped' | 'failed-start' | 'failed-shutdown'

export interface RuntimeOutputSinks {
  stdoutSink: RuntimeTextFileSink | null
  stderrSink: RuntimeTextFileSink | null
}

export interface InitializeRuntimeOutputSinksInput {
  launchConfig: HostedRuntimeLaunchConfig | null
  sensitiveValues: string[]
  persistObservability: (level?: RuntimeLogLevel, message?: string, context?: unknown) => Promise<void>
}

export interface TrackSpawnedRuntimeProcessInput {
  child: SpawnedRuntimeChild
  getActiveChild: () => SpawnedRuntimeChild | null
  clearActiveChild: () => void
  takeExpectedExitDisposition: () => ExpectedRuntimeExitDisposition
  getState: () => HostedBackendState
  setState: (state: HostedBackendState) => void
  getCapturedOutputSummary: () => string | null
  setRuntimeExitFailure: (failure: HostedBackendFailure) => void
  persistObservability: (level?: RuntimeLogLevel, message?: string, context?: unknown) => Promise<void>
  closeOutputSinks: () => Promise<void>
  appendStdoutChunk: (chunk: string | Buffer) => void
  appendStderrChunk: (chunk: string | Buffer) => void
}

export async function initializeRuntimeOutputSinks(
  input: InitializeRuntimeOutputSinksInput,
): Promise<RuntimeOutputSinks> {
  if (input.launchConfig === null) {
    return { stdoutSink: null, stderrSink: null }
  }

  try {
    return {
      stdoutSink: new RuntimeTextFileSink(input.launchConfig.paths.backendStdoutLogFile, input.sensitiveValues),
      stderrSink: new RuntimeTextFileSink(input.launchConfig.paths.backendStderrLogFile, input.sensitiveValues),
    }
  } catch (error) {
    await input.persistObservability('warn', 'Failed to initialize backend stdout/stderr log sinks.', {
      detail: summarizeUnknownError(error),
    })
    return { stdoutSink: null, stderrSink: null }
  }
}

export async function closeRuntimeOutputSinks(sinks: RuntimeOutputSinks): Promise<void> {
  await Promise.all([
    sinks.stdoutSink?.close(),
    sinks.stderrSink?.close(),
  ].filter((operation): operation is Promise<void> => operation !== undefined).map((operation) => {
    return operation.catch((error) => {
      console.error('[desktop-runtime] Failed to close runtime log sink.', summarizeUnknownError(error))
    })
  }))
}

export function appendRuntimeCapturedOutput(current: string, chunk: string | Buffer): string {
  return appendCapturedText(current, chunk)
}

export function trackSpawnedRuntimeProcess(
  input: TrackSpawnedRuntimeProcessInput,
): Promise<ChildExitResult> {
  const childExitPromise = new Promise<ChildExitResult>((resolve) => {
    input.child.stdout?.on('data', (chunk) => {
      input.appendStdoutChunk(chunk)
    })

    input.child.stderr?.on('data', (chunk) => {
      input.appendStderrChunk(chunk)
    })

    input.child.once('error', (error) => {
      if (input.getActiveChild() !== input.child) {
        return
      }

      const failure = appendFailureDetail(createHostedBackendFailure({
        code: 'spawn_failed',
        phase: 'spawn',
        message: 'Failed to spawn the desktop runtime process.',
        cause: error,
      }), input.getCapturedOutputSummary())

      input.setRuntimeExitFailure(failure)
      input.setState(markHostedBackendFailed(input.getState(), { failure }))
      input.clearActiveChild()
      resolve({ code: null, signal: null })
      void input.persistObservability('error', 'Failed to spawn the hosted desktop runtime process.', {
        failure,
        state: summarizeHostedBackendState(input.getState()),
      })
      void input.closeOutputSinks()
    })

    input.child.once('exit', (code, signal) => {
      if (input.getActiveChild() !== input.child) {
        return
      }

      const expectedDisposition = input.takeExpectedExitDisposition()
      input.clearActiveChild()
      resolve({ code, signal })

      if (expectedDisposition === 'stopped') {
        input.setState(markHostedBackendStopped(input.getState(), { exitCode: code, signal }))
        void input.persistObservability('info', 'Hosted desktop runtime process exited after shutdown request.', {
          state: summarizeHostedBackendState(input.getState()),
        })
        void input.closeOutputSinks()
        return
      }

      if (expectedDisposition === 'failed-start' || expectedDisposition === 'failed-shutdown') {
        const currentState = input.getState()
        if (currentState.lastFailure !== null) {
          input.setState(markHostedBackendFailed(currentState, {
            failure: currentState.lastFailure,
            exitCode: code,
            signal,
          }))
        }
        void input.persistObservability(undefined, undefined, undefined)
        void input.closeOutputSinks()
        return
      }

      const previousState = input.getState()
      const failure = appendFailureDetail(
        classifyUnexpectedExit(code, signal, previousState.status === 'ready' ? 'runtime' : 'healthcheck'),
        input.getCapturedOutputSummary(),
      )

      input.setRuntimeExitFailure(failure)
      input.setState(previousState.status === 'ready'
        ? markHostedBackendDegraded(previousState, { failure, exitCode: code, signal })
        : markHostedBackendFailed(previousState, { failure, exitCode: code, signal }))
      void input.persistObservability('error', 'Hosted desktop runtime exited unexpectedly.', {
        failure,
        state: summarizeHostedBackendState(input.getState()),
      })
      void input.closeOutputSinks()
    })
  })

  return childExitPromise
}
