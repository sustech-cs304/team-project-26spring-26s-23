import { describe, expect, it } from 'vitest'

import { listRuntimeAgents } from './thread-run-contract'
import {
  createFetchFn,
  createRuntimeAgentsListResponse,
  createRuntimeErrorPayload,
  runtimeUrl,
} from './thread-run-contract.test-support'

describe('listRuntimeAgents', () => {
  it('posts agents/list to the runtime root endpoint', async () => {
    const fetchFn = createFetchFn(createRuntimeAgentsListResponse())

    const response = await listRuntimeAgents({
      runtimeUrl,
      fetchFn,
    })

    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8765/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'agents/list',
      }),
    })
    expect(response.defaultAgentId).toBe('general')
    expect(response.agents[0]?.agentId).toBe('general')
  })

  it('throws a structured RuntimeRequestError when agents/list fails', async () => {
    const fetchFn = createFetchFn(
      createRuntimeErrorPayload({
        code: 'agent_directory_unavailable',
        message: 'directory snapshot missing',
      }),
      {
        ok: false,
        status: 503,
      },
    )

    await expect(listRuntimeAgents({
      runtimeUrl,
      fetchFn,
    })).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      code: 'agent_directory_unavailable',
      status: 503,
      message: 'agent_directory_unavailable: directory snapshot missing',
    })
  })
})
