import { describe, expect, it, vi, beforeEach } from 'vitest'
import { probeRuntimeReadiness } from './python-runtime-readiness'

describe('probeRuntimeReadiness', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns ready when fetch returns a 200 with a JSON { ready: true } payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ ready: true })),
    }))

    const result = await probeRuntimeReadiness('http://127.0.0.1:4000/health', 5000)

    expect(result.ready).toBe(true)
    expect(result.detail).toBeNull()
  })

  it('returns not ready when fetch returns a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue('Service Unavailable'),
    }))

    const result = await probeRuntimeReadiness('http://127.0.0.1:4000/health', 5000)

    expect(result.ready).toBe(false)
    expect(result.detail).toContain('503')
    expect(result.detail).toContain('Service Unavailable')
  })

  it('returns not ready when fetch returns 200 but payload is not { ready: true }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ ready: false, status: 'initializing' })),
    }))

    const result = await probeRuntimeReadiness('http://127.0.0.1:4000/health', 5000)

    expect(result.ready).toBe(false)
    expect(result.detail).toContain('not ready')
  })

  it('returns not ready when fetch returns 200 with an empty body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(''),
    }))

    const result = await probeRuntimeReadiness('http://127.0.0.1:4000/health', 5000)

    expect(result.ready).toBe(false)
    expect(result.detail).toContain('empty response body')
  })

  it('returns not ready when fetch returns 200 with non-JSON whitespace-only body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('   '),
    }))

    const result = await probeRuntimeReadiness('http://127.0.0.1:4000/health', 5000)

    expect(result.ready).toBe(false)
    expect(result.detail).toContain('empty response body')
  })

  it('returns not ready on AbortError (timeout)', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    const result = await probeRuntimeReadiness('http://127.0.0.1:4000/health', 5000)

    expect(result.ready).toBe(false)
    expect(result.detail).toContain('timed out after 5000ms')
  })

  it('returns not ready on a generic fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const result = await probeRuntimeReadiness('http://127.0.0.1:4000/health', 5000)

    expect(result.ready).toBe(false)
    expect(result.detail).toContain('ECONNREFUSED')
  })

  it('clears the abort timeout in the finally block', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      return new Promise((resolve) => setTimeout(() => resolve({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({ ready: true })),
      }), 100))
    }))

    const promise = probeRuntimeReadiness('http://127.0.0.1:4000/health', 5000)
    vi.advanceTimersByTime(200)
    await promise

    expect(clearTimeoutSpy).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('truncation behavior via probeRuntimeReadiness', () => {
  it('truncates long status messages in payload responses', async () => {
    const longMessage = 'x'.repeat(500)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ ready: false, message: longMessage })),
    }))

    const result = await probeRuntimeReadiness('http://127.0.0.1:4000/health', 5000)

    expect(result.detail!.length).toBeLessThan(longMessage.length)
  })
})

describe('non-JSON response text handling via probeRuntimeReadiness', () => {
  it('returns not ready with the non-JSON body text when fetch returns a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('<html>Internal Server Error</html>'),
    }))

    const result = await probeRuntimeReadiness('http://127.0.0.1:4000/health', 5000)

    expect(result.ready).toBe(false)
    expect(result.detail).toContain('500')
    expect(result.detail).toContain('<html>Internal Server Error</html>')
  })
})
