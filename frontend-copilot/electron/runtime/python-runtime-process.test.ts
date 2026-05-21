import { describe, expect, it, vi } from 'vitest'
import {
  appendCapturedText,
  buildCapturedOutputSummary,
  requestRuntimeChildTermination,
  waitForChildExit,
  FAILED_START_CLEANUP_TIMEOUT_MS,
  type ChildExitResult,
} from './python-runtime-process'
import type { ChildProcess } from 'node:child_process'

function createFakeChild(overrides?: Partial<ChildProcess>): ChildProcess {
  return {
    exitCode: null,
    signalCode: null,
    killed: false,
    pid: 1234,
    kill: vi.fn(),
    on: vi.fn().mockReturnThis(),
    once: vi.fn().mockReturnThis(),
    removeListener: vi.fn().mockReturnThis(),
    ...overrides,
  } as unknown as ChildProcess
}

function delayedExitResult(ms: number, result: ChildExitResult): Promise<ChildExitResult> {
  return new Promise((resolve) => setTimeout(() => resolve(result), ms))
}

describe('requestRuntimeChildTermination', () => {
  it('does nothing when the child has already exited with an exit code', () => {
    const child = createFakeChild({ exitCode: 0 })
    requestRuntimeChildTermination(child, 'SIGTERM')

    expect(child.kill).not.toHaveBeenCalled()
  })

  it('does nothing when the child has already exited with a signal', () => {
    const child = createFakeChild({ signalCode: 'SIGTERM' })
    requestRuntimeChildTermination(child, 'SIGTERM')

    expect(child.kill).not.toHaveBeenCalled()
  })

  it('calls kill() with no signal on win32', () => {
    const originalPlatform = process.platform
    vi.stubGlobal('process', { ...process, platform: 'win32' })

    try {
      const child = createFakeChild()
      requestRuntimeChildTermination(child, 'SIGTERM')

      expect(child.kill).toHaveBeenCalledWith()
    } finally {
      vi.unstubAllGlobals()
      vi.stubGlobal('process', { ...globalThis.process, platform: originalPlatform })
    }
  })

  it('calls kill() with the signal on non-win32 platforms', () => {
    const originalPlatform = process.platform
    vi.stubGlobal('process', { ...process, platform: 'linux' })

    try {
      const child = createFakeChild()
      requestRuntimeChildTermination(child, 'SIGKILL')

      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.unstubAllGlobals()
      vi.stubGlobal('process', { ...globalThis.process, platform: originalPlatform })
    }
  })

  it('catches kill errors gracefully (race condition)', () => {
    const child = createFakeChild({
      kill: vi.fn().mockImplementation(() => { throw new Error('kill error') }),
    })

    expect(() => requestRuntimeChildTermination(child, 'SIGTERM')).not.toThrow()
    expect(child.kill).toHaveBeenCalled()
  })
})

describe('waitForChildExit', () => {
  it('resolves with the child exit result when the child exits before the timeout', async () => {
    vi.useFakeTimers()

    const expected: ChildExitResult = { code: 0, signal: null }
    const promise = waitForChildExit(delayedExitResult(500, expected), 1000)

    vi.advanceTimersByTime(600)
    const result = await promise

    expect(result).toEqual(expected)
    vi.useRealTimers()
  })

  it('throws when the child does not exit within the timeout', async () => {
    vi.useFakeTimers()

    const promise = waitForChildExit(delayedExitResult(2000, { code: 0, signal: null }), 1000)

    vi.advanceTimersByTime(1100)
    await expect(promise).rejects.toThrow('Timed out after 1000ms while waiting for the child process to exit.')
    vi.useRealTimers()
  })
})

describe('appendCapturedText', () => {
  it('appends a string to the current captured text', () => {
    expect(appendCapturedText('hello ', 'world')).toBe('hello world')
  })

  it('converts a Buffer to a UTF-8 string before appending', () => {
    const buffer = Buffer.from('world', 'utf8')
    expect(appendCapturedText('hello ', buffer)).toBe('hello world')
  })

  it('keeps output under the max length by trimming from the start', () => {
    const longString = 'x'.repeat(4000)
    const result = appendCapturedText(longString, 'y'.repeat(5000))

    expect(result.length).toBeLessThanOrEqual(8000)
    expect(result.endsWith('y'.repeat(5000))).toBe(true)
    expect(result).not.toBe('x'.repeat(4000) + 'y'.repeat(5000))
  })

  it('preserves content when combined length is exactly at the max', () => {
    const first = 'x'.repeat(4000)
    const second = 'y'.repeat(4000)
    const result = appendCapturedText(first, second)

    expect(result).toBe(`${first}${second}`)
    expect(result.length).toBe(8000)
  })
})

describe('buildCapturedOutputSummary', () => {
  it('returns null when both stdout and stderr are empty or whitespace', () => {
    expect(buildCapturedOutputSummary('', '')).toBeNull()
    expect(buildCapturedOutputSummary('   ', '\n')).toBeNull()
  })

  it('includes stdout content when present', () => {
    const summary = buildCapturedOutputSummary('stdout line', '')

    expect(summary).toContain('stdout:')
    expect(summary).toContain('stdout line')
    expect(summary).not.toContain('stderr:')
  })

  it('includes stderr content when present', () => {
    const summary = buildCapturedOutputSummary('', 'stderr line')

    expect(summary).toContain('stderr:')
    expect(summary).toContain('stderr line')
    expect(summary).not.toContain('stdout:')
  })

  it('includes both stdout and stderr sections when both are present', () => {
    const summary = buildCapturedOutputSummary('out line', 'err line')

    expect(summary).toContain('stdout:\nout line')
    expect(summary).toContain('stderr:\nerr line')
  })

  it('separates sections with a double newline', () => {
    const summary = buildCapturedOutputSummary('out', 'err')

    expect(summary).toBe('stdout:\nout\n\nstderr:\nerr')
  })

  it('trims whitespace from output content', () => {
    const summary = buildCapturedOutputSummary('  hi  ', '  bye  ')

    expect(summary).toBe('stdout:\nhi\n\nstderr:\nbye')
  })
})

describe('FAILED_START_CLEANUP_TIMEOUT_MS', () => {
  it('is a positive number', () => {
    expect(FAILED_START_CLEANUP_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('is 1500ms', () => {
    expect(FAILED_START_CLEANUP_TIMEOUT_MS).toBe(1500)
  })
})
