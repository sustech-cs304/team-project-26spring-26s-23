import { describe, expect, it } from 'vitest'

import { getRuntimeCapabilities } from './chat-contract'
import {
  createFetchFn,
  createRuntimeCapabilitiesGetResponse,
  createRuntimeErrorPayload,
  runtimeUrl,
  sessionId,
} from './chat-contract.test-support'

describe('getRuntimeCapabilities', () => {
  it('posts capabilities/get and returns the backend capability snapshot fields', async () => {
    const fetchFn = createFetchFn(createRuntimeCapabilitiesGetResponse())

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
        method: 'capabilities/get',
        body: {
          sessionId: 'session-1',
        },
      }),
    })
    expect(response.capabilitiesVersion).toBe('cap-v12')
    expect(response.tools.map((tool) => tool.toolId)).toEqual([
      'tool.file-convert',
      'tool.remote-search',
    ])
    expect(response.recommendedTools).toEqual(['tool.file-convert'])
  })

  it('throws a structured RuntimeRequestError when capabilities/get fails', async () => {
    const fetchFn = createFetchFn(
      createRuntimeErrorPayload({
        code: 'session_not_found',
        message: 'session missing',
      }),
      {
        ok: false,
        status: 404,
      },
    )

    await expect(getRuntimeCapabilities({
      runtimeUrl,
      sessionId,
      fetchFn,
    })).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      code: 'session_not_found',
      status: 404,
      message: 'session_not_found: session missing',
    })
  })
})
