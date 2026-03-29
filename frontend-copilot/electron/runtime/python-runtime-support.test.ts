import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendCapturedText,
  buildCapturedOutputSummary,
  requestRuntimeChildTermination,
} from './python-runtime-process'
import { prepareRuntimePaths } from './python-runtime-paths-support'
import { probeRuntimeReadiness } from './python-runtime-readiness'
import { createHostedRuntimePaths } from './runtime-paths'

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
    } as unknown as ReturnType<typeof import('node:child_process').spawn>, 'SIGTERM')

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
