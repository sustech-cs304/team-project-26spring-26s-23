import { describe, expect, it } from 'vitest'

import { getRuntimeCapabilities } from './chat-contract'
import {
  createFetchFn,
  createRuntimeErrorPayload,
  createRuntimeThreadGetResponse,
  runtimeUrl,
  sessionId,
} from './chat-contract.test-support'

describe('getRuntimeCapabilities', () => {
  it('posts thread/get and returns the backend capability snapshot fields', async () => {
    const fetchFn = createFetchFn(createRuntimeThreadGetResponse())

    const response = await getRuntimeCapabilities({
      runtimeUrl,
      sessionId,
      fetchFn,
    })

    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8765/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'thread/get',
        body: {
          threadId: 'session-1',
        },
      }),
      signal: undefined,
    })
    expect(response.capabilitiesVersion).toBe('cap-v12')
    expect(response.tools.map((tool) => tool.toolId)).toEqual([
      'tool.file-convert',
      'tool.remote-search',
    ])
    expect(response.recommendedTools).toEqual(['tool.file-convert'])
  })

  it('throws a structured RuntimeRequestError when thread/get fails', async () => {
    const fetchFn = createFetchFn(
      createRuntimeErrorPayload({
        code: 'thread_not_found',
        message: 'thread missing',
      }),
      {
        ok: false,
        status: 404,
        headers: {
          'content-type': 'application/json',
        },
      },
    )

    await expect(getRuntimeCapabilities({
      runtimeUrl,
      sessionId,
      fetchFn,
    })).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      code: 'thread_not_found',
      status: 404,
      message: 'thread_not_found: thread missing',
    })
  })
})
