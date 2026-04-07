import { describe, expect, it } from 'vitest'

import {
  buildRuntimeEndpoint,
  createRuntimeThread,
  getRuntimeThinkingCapability,
  listRuntimeAgents,
} from './thread-run-contract'
import {
  agentId,
  createFetchFn,
  createRuntimeErrorPayload,
  createRuntimeModelRoute,
  runtimeUrl,
} from './thread-run-contract.test-support'

describe('chat contract transport helpers', () => {
  it('normalizes runtime endpoint paths to the root slash', () => {
    expect(buildRuntimeEndpoint('http://127.0.0.1:8765')).toBe('http://127.0.0.1:8765/')
    expect(buildRuntimeEndpoint('http://127.0.0.1:8765/')).toBe('http://127.0.0.1:8765/')
  })

  it('throws RuntimeRequestError when thread/create returns ok false on an HTTP success response', async () => {
    const fetchFn = createFetchFn(createRuntimeErrorPayload({
      code: 'capabilities_stale',
      message: 'refresh required',
    }))

    await expect(createRuntimeThread({
      runtimeUrl,
      agentId,
      fetchFn,
    })).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      code: 'capabilities_stale',
      status: 200,
      message: 'capabilities_stale: refresh required',
    })
  })

  it('falls back to an HTTP status message when the backend error payload is unstructured', async () => {
    const fetchFn = createFetchFn({}, {
      ok: false,
      status: 500,
    })

    await expect(listRuntimeAgents({
      runtimeUrl,
      fetchFn,
    })).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      code: null,
      status: 500,
      message: 'Runtime request failed with HTTP 500.',
    })
  })

  it('preserves runtime error details on request failures', async () => {
    const fetchFn = createFetchFn(createRuntimeErrorPayload({
      code: 'provider_catalog_only',
      message: 'provider not enabled',
      details: {
        providerId: 'openrouter',
        runtimeStatus: 'catalog-only',
      },
    }), {
      ok: false,
      status: 409,
    })

    await expect(getRuntimeThinkingCapability({
      runtimeUrl,
      sessionId: 'session-1',
      modelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openrouter',
        snapshot: {
          provider: 'openrouter',
          endpointType: 'openai-compatible',
          baseUrl: 'https://openrouter.ai/api/v1',
          modelId: 'openrouter/auto',
        },
      }),
      fetchFn,
    })).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      code: 'provider_catalog_only',
      status: 409,
      details: {
        providerId: 'openrouter',
        runtimeStatus: 'catalog-only',
      },
    })
  })
})
