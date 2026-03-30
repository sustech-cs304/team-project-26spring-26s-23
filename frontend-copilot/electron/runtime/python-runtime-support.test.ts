import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizePythonRuntimeStartFailure } from './python-runtime-startup-failure'
import { summarizeHostedBackendState, summarizeLaunchSpec } from './python-runtime-observability-support'
import {
  appendCapturedText,
  buildCapturedOutputSummary,
  requestRuntimeChildTermination,
  type SpawnedRuntimeChild,
} from './python-runtime-process'
import { createHostedBackendFailure } from './runtime-diagnostics'
import { prepareRuntimePaths } from './python-runtime-paths-support'
import { probeRuntimeReadiness } from './python-runtime-readiness'
import { createHostedRuntimePaths } from './runtime-paths'
import { createInitialHostedBackendState, markHostedBackendReady } from './runtime-state'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('python runtime process helpers', () => {
  it('keeps only the most recent captured output window', () => {
    const firstChunk = 'a'.repeat(7_990)
    const combined = appendCapturedText(firstChunk, 'b'.repeat(20))

    expect(combined).toHaveLength(8_000)
    expect(combined.endsWith('b'.repeat(20))).toBe(true)
    expect(combined.startsWith('a'.repeat(7_980))).toBe(true)
  })

  it('summarizes stdout and stderr without adding empty sections', () => {
    expect(buildCapturedOutputSummary(' hello\n', ' world\n')).toBe('stdout:\nhello\n\nstderr:\nworld')
    expect(buildCapturedOutputSummary('   ', '\n\t')).toBeNull()
  })

  it('skips termination when the child already exited', () => {
    const kill = vi.fn()
    requestRuntimeChildTermination({
      exitCode: 0,
      signalCode: null,
      kill,
    } as unknown as SpawnedRuntimeChild, 'SIGTERM')

    expect(kill).not.toHaveBeenCalled()
  })
})

describe('python runtime readiness helpers', () => {
  it('accepts a ready payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"ready":true}',
    }))

    await expect(probeRuntimeReadiness('http://127.0.0.1:9000/ready', 500)).resolves.toEqual({
      ready: true,
      detail: null,
    })
  })

  it('reports http probe failures with truncated response detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'runtime warming up',
    }))

    await expect(probeRuntimeReadiness('http://127.0.0.1:9000/ready', 500)).resolves.toEqual({
      ready: false,
      detail: 'Readiness probe returned HTTP 503: runtime warming up',
    })
  })

  it('reports timeout details when the readiness request aborts', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted.')
          abortError.name = 'AbortError'
          reject(abortError)
        })
      })
    }))

    const probePromise = probeRuntimeReadiness('http://127.0.0.1:9000/ready', 250)
    await vi.advanceTimersByTimeAsync(250)

    await expect(probePromise).resolves.toEqual({
      ready: false,
      detail: 'Readiness probe timed out after 250ms.',
    })
  })
})

describe('python runtime path helpers', () => {
  it('creates runtime directory structure for the hosted backend', async () => {
    const userDataRoot = await mkdtemp(path.join(tmpdir(), 'candue-runtime-paths-'))
    const runtimePaths = createHostedRuntimePaths(userDataRoot)

    try {
      await prepareRuntimePaths(runtimePaths)

      await expect(access(runtimePaths.runtimeRootDir)).resolves.toBeUndefined()
      await expect(access(runtimePaths.configDir)).resolves.toBeUndefined()
      await expect(access(runtimePaths.logsDir)).resolves.toBeUndefined()
      await expect(access(runtimePaths.databaseDir)).resolves.toBeUndefined()
      await expect(access(runtimePaths.stateDir)).resolves.toBeUndefined()
    } finally {
      await rm(userDataRoot, { recursive: true, force: true })
    }
  })
})

describe('python runtime startup failure helpers', () => {
  it('preserves hosted backend failures while appending captured output', () => {
    const failure = createHostedBackendFailure({
      code: 'startup_timeout',
      phase: 'healthcheck',
      message: 'Timed out.',
      detail: 'probe detail',
    })

    expect(normalizePythonRuntimeStartFailure(failure, 'stderr:\ntraceback')).toMatchObject({
      code: 'startup_timeout',
      phase: 'healthcheck',
      detail: 'probe detail\nstderr:\ntraceback',
    })
  })

  it('wraps unknown readiness failures with the hosted failure shape', () => {
    const normalized = normalizePythonRuntimeStartFailure(new Error('boom'), 'stdout:\nbooting')

    expect(normalized).toMatchObject({
      code: 'healthcheck_failed',
      phase: 'healthcheck',
      message: 'Desktop runtime failed during readiness probing.',
      detail: 'boom\nstdout:\nbooting',
    })
  })
})

describe('python runtime observability helpers', () => {
  it('summarizes launch spec split between base and runtime args', () => {
    expect(summarizeLaunchSpec({
      mode: 'development',
      workspaceRoot: 'workspace',
      backendDir: 'backend',
      resourcesRoot: 'resources',
      workingDirectory: 'backend',
      entryModule: 'app.desktop_runtime',
      command: 'python',
      args: ['-m', 'app.desktop_runtime'],
      env: {},
      manifestPath: null,
      pythonExecutablePath: null,
      pythonPathEntries: ['backend'],
      sitePackagesEntries: [],
    }, ['-m', 'app.desktop_runtime', '--port', '9000'])).toEqual({
      mode: 'development',
      workspaceRoot: 'workspace',
      backendDir: 'backend',
      resourcesRoot: 'resources',
      workingDirectory: 'backend',
      entryModule: 'app.desktop_runtime',
      command: 'python',
      baseArgs: ['-m', 'app.desktop_runtime'],
      runtimeArgs: ['--port', '9000'],
      args: ['-m', 'app.desktop_runtime', '--port', '9000'],
      manifestPath: null,
      pythonExecutablePath: null,
      pythonPathEntries: ['backend'],
      sitePackagesEntries: [],
    })
  })

  it('summarizes hosted backend state without dropping failure metadata', () => {
    const failure = createHostedBackendFailure({
      code: 'unexpected_exit',
      phase: 'runtime',
      message: 'Exited unexpectedly.',
      exitCode: 1,
    })

    const state = {
      ...markHostedBackendReady(createInitialHostedBackendState()),
      status: 'degraded' as const,
      mode: 'development' as const,
      baseUrl: 'http://127.0.0.1:9000',
      pid: null,
      stoppedAt: '2026-03-29T00:00:00.000Z',
      exitCode: 1,
      signal: null,
      lastFailure: failure,
    }

    expect(summarizeHostedBackendState(state)).toEqual({
      status: 'degraded',
      mode: 'development',
      baseUrl: 'http://127.0.0.1:9000',
      pid: null,
      startedAt: state.startedAt,
      readyAt: state.readyAt,
      stoppedAt: '2026-03-29T00:00:00.000Z',
      exitCode: 1,
      signal: null,
      lastFailure: failure,
    })
  })
})
