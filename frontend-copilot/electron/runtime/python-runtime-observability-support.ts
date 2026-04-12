import type { HostedRuntimeLaunchConfig, SanitizedHostedRuntimeLaunchConfig } from './runtime-config'
import { sanitizeHostedRuntimeLaunchConfig } from './runtime-config'
import type { HostedBackendFailure } from './runtime-diagnostics'
import { summarizeUnknownError } from './runtime-diagnostics'
import {
  appendRuntimeLog,
  buildHostedRuntimeSnapshot,
  writeHostedRuntimeSnapshot,
  writeLastFailureRecord,
  type RuntimeLogLevel,
} from './runtime-observability'
import type { HostedRuntimePaths } from './runtime-paths'
import type { HostedBackendState } from './runtime-state'
import type { PythonRuntimeLaunchSpec } from './python-runtime-resolver'

export interface PersistRuntimeObservabilityInput {
  runtimePaths: HostedRuntimePaths
  launchConfig: HostedRuntimeLaunchConfig | null
  state: HostedBackendState
  lastFailure: HostedBackendFailure | null
  sensitiveValues: string[]
  level?: RuntimeLogLevel
  message?: string
  context?: unknown
}

export async function persistRuntimeObservability(input: PersistRuntimeObservabilityInput): Promise<void> {
  try {
    await Promise.all([
      writeHostedRuntimeSnapshot(
        input.runtimePaths.runtimeSnapshotFile,
        buildHostedRuntimeSnapshot({
          paths: input.runtimePaths,
          launchConfig: sanitizeLaunchConfig(input.launchConfig),
          state: cloneHostedBackendState(input.state),
          lastFailure: cloneHostedBackendFailure(input.lastFailure),
        }),
        input.sensitiveValues,
      ),
      writeLastFailureRecord(
        input.runtimePaths.lastFailureFile,
        {
          updatedAt: new Date().toISOString(),
          status: input.state.status,
          failure: cloneHostedBackendFailure(input.lastFailure),
        },
        input.sensitiveValues,
      ),
    ])

    if (input.level !== undefined && input.message !== undefined) {
      await appendRuntimeLog(input.runtimePaths.hostLogFile, {
        source: 'python-runtime-manager',
        level: input.level,
        message: input.message,
        context: input.context,
      }, input.sensitiveValues)
    }
  } catch (error) {
    console.error('[desktop-runtime] Failed to persist runtime observability artifacts.', summarizeUnknownError(error))
  }
}

export function summarizeLaunchSpec(
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

export function summarizeHostedBackendState(state: HostedBackendState): Record<string, unknown> {
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

function sanitizeLaunchConfig(
  launchConfig: HostedRuntimeLaunchConfig | null,
): SanitizedHostedRuntimeLaunchConfig | null {
  return launchConfig === null ? null : sanitizeHostedRuntimeLaunchConfig(launchConfig)
}

function cloneHostedBackendState(state: HostedBackendState): HostedBackendState {
  return {
    ...state,
    lastFailure: cloneHostedBackendFailure(state.lastFailure),
  }
}

function cloneHostedBackendFailure(failure: HostedBackendFailure | null): HostedBackendFailure | null {
  return failure === null ? null : { ...failure }
}
