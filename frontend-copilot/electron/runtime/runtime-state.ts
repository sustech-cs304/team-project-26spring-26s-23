import type { HostedBackendFailure } from './runtime-diagnostics'
import type { PythonRuntimeMode } from './python-runtime-resolver'

export type HostedBackendStatus = 'starting' | 'ready' | 'failed' | 'stopped' | 'degraded'

export interface HostedBackendState {
  status: HostedBackendStatus
  mode: PythonRuntimeMode | null
  baseUrl: string | null
  pid: number | null
  startedAt: string | null
  readyAt: string | null
  stoppedAt: string | null
  exitCode: number | null
  signal: NodeJS.Signals | null
  lastFailure: HostedBackendFailure | null
}

export interface HostedBackendStartingInput {
  mode: PythonRuntimeMode
  baseUrl: string
  pid: number | null
}

export interface HostedBackendTerminalInput {
  failure: HostedBackendFailure
  exitCode?: number | null
  signal?: NodeJS.Signals | null
}

export interface HostedBackendStoppedInput {
  exitCode?: number | null
  signal?: NodeJS.Signals | null
}

export function createInitialHostedBackendState(): HostedBackendState {
  return {
    status: 'stopped',
    mode: null,
    baseUrl: null,
    pid: null,
    startedAt: null,
    readyAt: null,
    stoppedAt: null,
    exitCode: null,
    signal: null,
    lastFailure: null,
  }
}

export function markHostedBackendStarting(
  previous: HostedBackendState,
  input: HostedBackendStartingInput,
): HostedBackendState {
  return {
    ...previous,
    status: 'starting',
    mode: input.mode,
    baseUrl: input.baseUrl,
    pid: input.pid,
    startedAt: new Date().toISOString(),
    readyAt: null,
    stoppedAt: null,
    exitCode: null,
    signal: null,
    lastFailure: null,
  }
}

export function markHostedBackendReady(previous: HostedBackendState): HostedBackendState {
  return {
    ...previous,
    status: 'ready',
    readyAt: new Date().toISOString(),
    stoppedAt: null,
    exitCode: null,
    signal: null,
  }
}

export function markHostedBackendFailed(
  previous: HostedBackendState,
  input: HostedBackendTerminalInput,
): HostedBackendState {
  return {
    ...previous,
    status: 'failed',
    pid: null,
    stoppedAt: new Date().toISOString(),
    exitCode: input.exitCode ?? previous.exitCode,
    signal: input.signal ?? previous.signal,
    lastFailure: input.failure,
  }
}

export function markHostedBackendDegraded(
  previous: HostedBackendState,
  input: HostedBackendTerminalInput,
): HostedBackendState {
  return {
    ...previous,
    status: 'degraded',
    pid: null,
    stoppedAt: new Date().toISOString(),
    exitCode: input.exitCode ?? previous.exitCode,
    signal: input.signal ?? previous.signal,
    lastFailure: input.failure,
  }
}

export function markHostedBackendStopped(
  previous: HostedBackendState,
  input: HostedBackendStoppedInput = {},
): HostedBackendState {
  return {
    ...previous,
    status: 'stopped',
    pid: null,
    stoppedAt: new Date().toISOString(),
    exitCode: input.exitCode ?? previous.exitCode,
    signal: input.signal ?? previous.signal,
  }
}
