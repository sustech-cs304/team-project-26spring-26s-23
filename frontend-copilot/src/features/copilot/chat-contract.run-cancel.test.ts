import { describe, expect, it } from 'vitest'

import { cancelRuntimeRun } from './thread-run-contract'
import {
  createFetchFn,
  createRuntimeRunCancelResponse,
  runtimeUrl,
} from './thread-run-contract.test-support'

describe('cancelRuntimeRun', () => {
  it('posts run/cancel and returns the cancel acknowledgement payload', async () => {
    const fetchFn = createFetchFn(createRuntimeRunCancelResponse({
      run: {
        runId: 'run-1',
        threadId: 'session-1',
        status: 'cancelling',
        createdAt: '2026-03-27T10:00:00Z',
        updatedAt: '2026-03-27T10:00:02Z',
        startedAt: '2026-03-27T10:00:01Z',
        terminalAt: null,
        cancelRequested: true,
      },
      cancelAccepted: true,
    }))

    const response = await cancelRuntimeRun({
      runtimeUrl,
      runId: 'run-1',
      fetchFn,
    })

    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8765/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'run/cancel',
        body: {
          runId: 'run-1',
        },
      }),
      signal: undefined,
    })
    expect(response.cancelAccepted).toBe(true)
    expect(response.run.runId).toBe('run-1')
  })
})
