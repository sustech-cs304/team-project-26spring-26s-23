import { describe, expect, it } from 'vitest'

import { createRuntimeSession } from './thread-run-contract'
import {
  agentId,
  createFetchFn,
  createRuntimeErrorPayload,
  createRuntimeThreadCreateResponse,
  runtimeUrl,
} from './thread-run-contract.test-support'

describe('createRuntimeSession', () => {
  it('posts thread/create and returns the projected session payload', async () => {
    const fetchFn = createFetchFn(createRuntimeThreadCreateResponse())

    const response = await createRuntimeSession({
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
    expect(response.sessionId).toBe('session-1')
    expect(response.boundAgent.agentId).toBe('general')
    expect(response.recommendedTools).toEqual(['tool.file-convert'])
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

    await expect(createRuntimeSession({
      runtimeUrl,
      agentId,
      fetchFn,
    })).rejects.toThrow('legacy_chat_contract_removed: old provider path removed')
  })
})
