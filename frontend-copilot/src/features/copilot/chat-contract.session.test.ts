import { describe, expect, it } from 'vitest'

import { createRuntimeThread } from './thread-run-contract'
import {
  agentId,
  createFetchFn,
  createRuntimeErrorPayload,
  createRuntimeThreadCreateResponse,
  runtimeUrl,
} from './thread-run-contract.test-support'

describe('createRuntimeThread', () => {
  it('posts thread/create and returns the canonical thread payload', async () => {
    const fetchFn = createFetchFn(createRuntimeThreadCreateResponse())

    const response = await createRuntimeThread({
      runtimeUrl,
      agentId,
      fetchFn,
    })

    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8765/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'thread/create',
        body: {
          agentId: 'general',
        },
      }),
      signal: undefined,
    })
    expect(response.threadId).toBe('session-1')
    expect(response.boundAgent.agentId).toBe('general')
    expect(response.recommendedTools).toEqual(['tool.fs.read'])
  })

  it('surfaces structured runtime errors without silently continuing', async () => {
    const fetchFn = createFetchFn(
      createRuntimeErrorPayload({
        code: 'legacy_chat_contract_removed',
        message: 'old provider path removed',
      }),
      {
        ok: false,
        status: 409,
        headers: {
          'content-type': 'application/json',
        },
      },
    )

    await expect(createRuntimeThread({
      runtimeUrl,
      agentId,
      fetchFn,
    })).rejects.toThrow('legacy_chat_contract_removed: old provider path removed')
  })
})
