import { describe, expect, it, vi } from 'vitest'

import type { RuntimeToolApprovalResolveResponse } from './tool-approval'
import { resolveRuntimeToolApproval } from './tool-approval'
import { RuntimeRequestError } from './thread-run-contract'
import { createFetchResponse } from './thread-run-contract.test-support'

const RUNTIME_URL = 'http://127.0.0.1:8765'
const RUN_ID = 'run-1'
const TOOL_CALL_ID = 'tool.remote-search:call-1'

function createApprovalResponse(
  overrides: Partial<RuntimeToolApprovalResolveResponse> = {},
): RuntimeToolApprovalResolveResponse {
  return {
    ok: true,
    runId: RUN_ID,
    toolCallId: TOOL_CALL_ID,
    decision: 'approved',
    status: 'approved',
    resolvedAt: '2026-03-27T10:05:00Z',
    source: 'user',
    details: {
      toolId: 'tool.remote-search',
      mode: 'ask',
    },
    ...overrides,
  }
}

describe('resolveRuntimeToolApproval', () => {
  it('resolves tool approval with approved decision', async () => {
    const response = createApprovalResponse()
    const fetchFn = vi.fn().mockResolvedValue(createFetchResponse(response))

    const result = await resolveRuntimeToolApproval({
      runtimeUrl: RUNTIME_URL,
      runId: RUN_ID,
      toolCallId: TOOL_CALL_ID,
      decision: 'approved',
      fetchFn,
    })

    expect(result).toEqual(response)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const callArg = fetchFn.mock.calls[0][0] as string
    expect(callArg).toBe(`${RUNTIME_URL}/`)
  })

  it('resolves tool approval with rejected decision', async () => {
    const response = createApprovalResponse({ decision: 'rejected', status: 'rejected' })
    const fetchFn = vi.fn().mockResolvedValue(createFetchResponse(response))

    const result = await resolveRuntimeToolApproval({
      runtimeUrl: RUNTIME_URL,
      runId: RUN_ID,
      toolCallId: TOOL_CALL_ID,
      decision: 'rejected',
      fetchFn,
    })

    expect(result.decision).toBe('rejected')
    expect(result.status).toBe('rejected')
  })

  it('posts JSON with the correct method and body', async () => {
    const response = createApprovalResponse()
    const fetchFn = vi.fn().mockResolvedValue(createFetchResponse(response))

    await resolveRuntimeToolApproval({
      runtimeUrl: RUNTIME_URL,
      runId: RUN_ID,
      toolCallId: TOOL_CALL_ID,
      decision: 'approved',
      fetchFn,
    })

    const requestInit = fetchFn.mock.calls[0][1] as RequestInit
    expect(requestInit.method).toBe('POST')
    expect(requestInit.headers).toEqual({ 'Content-Type': 'application/json' })
    const parsedBody = JSON.parse(requestInit.body as string)
    expect(parsedBody).toEqual({
      method: 'tool-approval/resolve',
      body: {
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        decision: 'approved',
      },
    })
  })

  it('does not append trailing slash when runtimeUrl already ends with one', async () => {
    const response = createApprovalResponse()
    const fetchFn = vi.fn().mockResolvedValue(createFetchResponse(response))

    await resolveRuntimeToolApproval({
      runtimeUrl: `${RUNTIME_URL}/`,
      runId: RUN_ID,
      toolCallId: TOOL_CALL_ID,
      decision: 'approved',
      fetchFn,
    })

    const callArg = fetchFn.mock.calls[0][0] as string
    expect(callArg).toBe(`${RUNTIME_URL}/`)
  })

  it('throws RuntimeRequestError when HTTP status is not ok with structured error', async () => {
    const errorPayload = {
      ok: false,
      error: {
        code: 'tool_approval_failed',
        message: 'Tool approval already resolved',
      },
    }
    const fetchFn = vi.fn().mockResolvedValue(createFetchResponse(errorPayload, { ok: false, status: 409 }))

    await expect(
      resolveRuntimeToolApproval({
        runtimeUrl: RUNTIME_URL,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        decision: 'approved',
        fetchFn,
      }),
    ).rejects.toThrow(RuntimeRequestError)
  })

  it('throws RuntimeRequestError when payload has ok:false', async () => {
    const errorPayload = {
      ok: false,
      error: {
        code: 'invalid_decision',
        message: 'Invalid approval decision',
        details: { allowed: ['approved', 'rejected'] },
      },
    }
    const fetchFn = vi.fn().mockResolvedValue(createFetchResponse(errorPayload))

    await expect(
      resolveRuntimeToolApproval({
        runtimeUrl: RUNTIME_URL,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        decision: 'approved',
        fetchFn,
      }),
    ).rejects.toThrow(RuntimeRequestError)
  })

  it('includes HTTP status in error message when no error code or message', async () => {
    const errorPayload = { ok: false }
    const fetchFn = vi.fn().mockResolvedValue(createFetchResponse(errorPayload, { ok: false, status: 500 }))

    await expect(
      resolveRuntimeToolApproval({
        runtimeUrl: RUNTIME_URL,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        decision: 'approved',
        fetchFn,
      }),
    ).rejects.toThrow('Runtime request failed with HTTP 500.')
  })

  it('uses only error code in message when message is missing', async () => {
    const errorPayload = {
      ok: false,
      error: { code: 'timeout' },
    }
    const fetchFn = vi.fn().mockResolvedValue(createFetchResponse(errorPayload, { ok: false, status: 408 }))

    try {
      await resolveRuntimeToolApproval({
        runtimeUrl: RUNTIME_URL,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        decision: 'approved',
        fetchFn,
      })
      expect.unreachable('Expected error to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeRequestError)
      expect((error as RuntimeRequestError).message).toBe('timeout')
    }
  })

  it('uses only error message in error when code is missing', async () => {
    const errorPayload = {
      ok: false,
      error: { message: 'Something went wrong' },
    }
    const fetchFn = vi.fn().mockResolvedValue(createFetchResponse(errorPayload, { ok: false, status: 400 }))

    try {
      await resolveRuntimeToolApproval({
        runtimeUrl: RUNTIME_URL,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        decision: 'approved',
        fetchFn,
      })
      expect.unreachable('Expected error to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeRequestError)
      expect((error as RuntimeRequestError).message).toBe('Something went wrong')
    }
  })

  it('handles aborted request via AbortSignal', async () => {
    const controller = new AbortController()
    const fetchFn = vi.fn().mockImplementation(() => {
      controller.abort()
      const error = new Error('The operation was aborted.')
      error.name = 'AbortError'
      throw error
    })

    await expect(
      resolveRuntimeToolApproval({
        runtimeUrl: RUNTIME_URL,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        decision: 'approved',
        fetchFn,
        signal: controller.signal,
      }),
    ).rejects.toThrow('The operation was aborted.')
  })

  it('handles aborted request when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchFn = vi.fn().mockRejectedValue(new Error('unreachable'))

    await expect(
      resolveRuntimeToolApproval({
        runtimeUrl: RUNTIME_URL,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        decision: 'approved',
        fetchFn,
        signal: controller.signal,
      }),
    ).rejects.toThrow('The operation was aborted.')
  })

  it('wraps non-RuntimeRequestError transport errors', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('Network error'))

    await expect(
      resolveRuntimeToolApproval({
        runtimeUrl: RUNTIME_URL,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        decision: 'approved',
        fetchFn,
      }),
    ).rejects.toThrow(RuntimeRequestError)
  })

  it('re-throws RuntimeRequestError from transport errors', async () => {
    const originalError = new RuntimeRequestError('Already wrapped', {
      status: 0,
      details: {},
    })
    const fetchFn = vi.fn().mockRejectedValue(originalError)

    await expect(
      resolveRuntimeToolApproval({
        runtimeUrl: RUNTIME_URL,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        decision: 'approved',
        fetchFn,
      }),
    ).rejects.toBe(originalError)
  })

  it('converts non-Error transport rejections to RuntimeRequestError', async () => {
    const fetchFn = vi.fn().mockRejectedValue('Connection refused')

    await expect(
      resolveRuntimeToolApproval({
        runtimeUrl: RUNTIME_URL,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        decision: 'approved',
        fetchFn,
      }),
    ).rejects.toThrow(RuntimeRequestError)
  })

  it('passes AbortSignal to fetch', async () => {
    const response = createApprovalResponse()
    const fetchFn = vi.fn().mockResolvedValue(createFetchResponse(response))
    const controller = new AbortController()

    await resolveRuntimeToolApproval({
      runtimeUrl: RUNTIME_URL,
      runId: RUN_ID,
      toolCallId: TOOL_CALL_ID,
      decision: 'approved',
      fetchFn,
      signal: controller.signal,
    })

    const requestInit = fetchFn.mock.calls[0][1] as RequestInit
    expect(requestInit.signal).toBe(controller.signal)
  })

  it('handles DOMException AbortError during fetch', async () => {
    const fetchFn = vi.fn().mockImplementation(() => {
      throw new DOMException('Aborted', 'AbortError')
    })

    await expect(
      resolveRuntimeToolApproval({
        runtimeUrl: RUNTIME_URL,
        runId: RUN_ID,
        toolCallId: TOOL_CALL_ID,
        decision: 'approved',
        fetchFn,
      }),
    ).rejects.toThrow('The operation was aborted.')
  })
})
