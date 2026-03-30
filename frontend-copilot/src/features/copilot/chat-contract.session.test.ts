import { describe, expect, it } from 'vitest'

import { createRuntimeSession } from './chat-contract'
import {
  agentId,
  createFetchFn,
  createRuntimeErrorPayload,
  createRuntimeSessionCreateResponse,
  runtimeUrl,
} from './chat-contract.test-support'

describe('createRuntimeSession', () => {
  it('posts session/create and returns the bound session payload', async () => {
    const fetchFn = createFetchFn(createRuntimeSessionCreateResponse())

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
        method: 'session/create',
        body: {
          agentId: 'general',
        },
      }),
    })
    expect(response.sessionId).toBe('session-1')
    expect(response.boundAgent.agentId).toBe('general')
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
      },
    )

    await expect(createRuntimeSession({
      runtimeUrl,
      agentId,
      fetchFn,
    })).rejects.toThrow('legacy_chat_contract_removed: old provider path removed')
  })
})
