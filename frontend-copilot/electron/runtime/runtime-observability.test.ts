import { describe, expect, it, beforeEach } from 'vitest'
import {
  buildHostedRuntimeSnapshot,
} from './runtime-observability'
import { createHostedRuntimePaths, type HostedRuntimePaths } from './runtime-paths'
import { type HostedBackendState } from './runtime-state'
import { type HostedBackendFailure } from './runtime-diagnostics'

function createTestState(overrides?: Partial<HostedBackendState>): HostedBackendState {
  return {
    status: 'ready',
    mode: 'bundled',
    baseUrl: 'http://127.0.0.1:4000',
    pid: 1234,
    startedAt: '2026-01-01T00:00:00.000Z',
    readyAt: '2026-01-01T00:00:02.000Z',
    stoppedAt: null,
    exitCode: null,
    signal: null,
    lastFailure: null,
    ...overrides,
  }
}

function createTestPaths(userDataPath = '/tmp/test'): HostedRuntimePaths {
  return createHostedRuntimePaths(userDataPath)
}

describe('buildHostedRuntimeSnapshot', () => {
  let paths: HostedRuntimePaths
  let state: HostedBackendState

  beforeEach(() => {
    paths = createTestPaths()
    state = createTestState()
  })

  it('includes a generatedAt ISO timestamp', () => {
    const snapshot = buildHostedRuntimeSnapshot({
      paths,
      launchConfig: null,
      state,
      lastFailure: null,
    })

    expect(snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('copies the current status from state', () => {
    const snapshot = buildHostedRuntimeSnapshot({
      paths,
      launchConfig: null,
      state,
      lastFailure: null,
    })

    expect(snapshot.status).toBe('ready')

    const failedState = createTestState({ status: 'failed' })
    const failedSnapshot = buildHostedRuntimeSnapshot({
      paths,
      launchConfig: null,
      state: failedState,
      lastFailure: null,
    })

    expect(failedSnapshot.status).toBe('failed')
  })

  it('sanitizes the runtime paths', () => {
    const snapshot = buildHostedRuntimeSnapshot({
      paths,
      launchConfig: null,
      state,
      lastFailure: null,
    })

    expect(snapshot.paths.userDataDir).toBe(paths.userDataDir)
    expect(snapshot.paths.runtimeRootDir).toBe(paths.runtimeRootDir)
    expect(snapshot.paths.configDir).toBe(paths.configDir)
  })

  it('preserves the full state object', () => {
    const snapshot = buildHostedRuntimeSnapshot({
      paths,
      launchConfig: null,
      state,
      lastFailure: null,
    })

    expect(snapshot.state).toEqual(state)
  })

  it('stores a null launchConfig when none is provided', () => {
    const snapshot = buildHostedRuntimeSnapshot({
      paths,
      launchConfig: null,
      state,
      lastFailure: null,
    })

    expect(snapshot.launchConfig).toBeNull()
  })

  it('stores the launchConfig when provided', () => {
    const launchConfig = {
      baseUrl: 'http://127.0.0.1:4000',
      readyUrl: 'http://127.0.0.1:4000/health',
      localToken: 'test-token',
      args: ['--port', '4000'],
      env: {},
    } as any

    const snapshot = buildHostedRuntimeSnapshot({
      paths,
      launchConfig,
      state,
      lastFailure: null,
    })

    expect(snapshot.launchConfig).toEqual(launchConfig)
  })

  it('stores the lastFailure when provided', () => {
    const lastFailure: HostedBackendFailure = {
      code: 'unexpected_exit',
      phase: 'runtime',
      message: 'Unexpected exit.',
      retryable: true,
      detail: 'exit code 1',
      exitCode: 1,
      signal: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    }

    const snapshot = buildHostedRuntimeSnapshot({
      paths,
      launchConfig: null,
      state,
      lastFailure,
    })

    expect(snapshot.lastFailure).toEqual(lastFailure)
  })

  it('stores null lastFailure when not provided', () => {
    const snapshot = buildHostedRuntimeSnapshot({
      paths,
      launchConfig: null,
      state,
      lastFailure: null,
    })

    expect(snapshot.lastFailure).toBeNull()
  })
})

describe('RuntimeLogEntryInput type', () => {
  it('accepts valid log entry shapes at the type level', () => {
    const entry = {
      source: 'electron-main' as const,
      level: 'info' as const,
      message: 'Runtime started.',
      context: { pid: 1234 },
    }

    expect(entry.source).toBe('electron-main')
    expect(entry.level).toBe('info')
    expect(entry.message).toBe('Runtime started.')
    expect(entry.context).toEqual({ pid: 1234 })
  })
})

describe('LastFailureRecord type', () => {
  it('accepts valid last failure record shapes at the type level', () => {
    const failure: HostedBackendFailure = {
      code: 'startup_timeout',
      phase: 'healthcheck',
      message: 'Timed out.',
      retryable: true,
      detail: null,
      exitCode: null,
      signal: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    }

    const record = {
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'failed' as const,
      failure,
    }

    expect(record.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(record.status).toBe('failed')
    expect(record.failure).toEqual(failure)
  })

  it('allows a null failure', () => {
    const record = {
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'ready' as const,
      failure: null,
    }

    expect(record.failure).toBeNull()
  })
})
