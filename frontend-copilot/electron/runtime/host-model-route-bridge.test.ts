import { afterEach, describe, expect, it } from 'vitest'
import {
  createHostModelRouteBridge,
  HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES,
  HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER,
} from './host-model-route-bridge'

const activeStops: Array<() => Promise<void>> = []

afterEach(async () => {
  while (activeStops.length > 0) {
    const stop = activeStops.pop()
    if (stop === undefined) {
      continue
    }
    await stop()
  }
})

describe('createHostModelRouteBridge', () => {
  it('resolves a provider route for authenticated private runtime requests from stable route refs', async () => {
    const bridge = await createHostModelRouteBridge({
      async resolveProviderRoute(request) {
        expect(request).toEqual({
          routeRef: {
            routeKind: 'provider-model',
            profileId: 'provider-1',
            modelId: 'gpt-4.1',
          },
          catalogRevision: '2026-04-06-provider-catalog-v1',
        })

        return {
          ok: true,
          resolvedRoute: {
            routeRef: {
              routeKind: 'provider-model',
              profileId: 'provider-1',
              modelId: 'gpt-4.1',
            },
            providerProfileId: 'provider-1',
            provider: 'openai',
            providerId: 'openai',
            adapterId: 'openai',
            runtimeStatus: 'enabled',
            catalogRevision: '2026-04-06-provider-catalog-v1',
            endpointFamily: 'openai',
            endpointType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            modelId: 'gpt-4.1',
            authKind: 'api-key',
          },
          privateAuth: {
            authKind: 'api-key',
            authPayload: {
              apiKey: 'secret-value',
            },
            apiKey: 'secret-value',
          },
        }
      },
    })
    activeStops.push(bridge.stop)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER]: bridge.bootstrap.token,
      },
      body: JSON.stringify({
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'provider-1',
          modelId: 'gpt-4.1',
        },
        catalogRevision: '2026-04-06-provider-catalog-v1',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      resolvedRoute: {
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'provider-1',
          modelId: 'gpt-4.1',
        },
        providerProfileId: 'provider-1',
        provider: 'openai',
        providerId: 'openai',
        adapterId: 'openai',
        runtimeStatus: 'enabled',
        catalogRevision: '2026-04-06-provider-catalog-v1',
        endpointFamily: 'openai',
        endpointType: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'gpt-4.1',
        authKind: 'api-key',
      },
      privateAuth: {
        authKind: 'api-key',
        authPayload: {
          apiKey: 'secret-value',
        },
        apiKey: 'secret-value',
      },
    })
  })

  it('rejects legacy snapshot request bodies even when routeRef is present', async () => {
    let resolverCalls = 0
    const bridge = await createHostModelRouteBridge({
      resolveProviderRoute() {
        resolverCalls += 1
        throw new Error('resolveProviderRoute should not be called for legacy requests.')
      },
    })
    activeStops.push(bridge.stop)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER]: bridge.bootstrap.token,
      },
      body: JSON.stringify({
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'provider-1',
          modelId: 'gpt-4.1',
        },
        snapshot: {
          provider: 'openai',
          endpointType: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          modelId: 'gpt-4.1',
        },
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES.INVALID_REQUEST,
        message: 'Host model route bridge request body is invalid.',
        details: {},
      },
    })
    expect(resolverCalls).toBe(0)
  })

  it('rejects requests with an invalid private bridge token', async () => {
    const bridge = await createHostModelRouteBridge({
      resolveProviderRoute() {
        throw new Error('resolveProviderRoute should not be called when the token is invalid.')
      },
    })
    activeStops.push(bridge.stop)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER]: 'wrong-token',
      },
      body: JSON.stringify({
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'provider-1',
          modelId: 'gpt-4.1',
        },
      }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES.INVALID_TOKEN,
        message: 'Missing or invalid host model route bridge token.',
        details: {
          headerName: HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER,
        },
      },
    })
  })

  it('accepts repeated token headers when every supplied value matches the bootstrap token', async () => {
    let resolverCalls = 0
    const bridge = await createHostModelRouteBridge({
      resolveProviderRoute() {
        resolverCalls += 1
        return {
          ok: true,
          resolvedRoute: {
            routeRef: {
              routeKind: 'provider-model',
              profileId: 'provider-1',
              modelId: 'gpt-4.1',
            },
            providerProfileId: 'provider-1',
            provider: 'openai',
            providerId: 'openai',
            adapterId: 'openai',
            runtimeStatus: 'enabled',
            catalogRevision: '2026-04-06-provider-catalog-v1',
            endpointFamily: 'openai',
            endpointType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            modelId: 'gpt-4.1',
            authKind: 'api-key',
          },
          privateAuth: {
            authKind: 'api-key',
            authPayload: {
              apiKey: 'secret-value',
            },
            apiKey: 'secret-value',
          },
        }
      },
    })
    activeStops.push(bridge.stop)

    const headers = new Headers({
      'content-type': 'application/json',
    })
    headers.append(HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER, bridge.bootstrap.token)
    headers.append(HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER, bridge.bootstrap.token)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'provider-1',
          modelId: 'gpt-4.1',
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(resolverCalls).toBe(1)
  })

  it('rejects malformed request bodies before resolver execution', async () => {
    let resolverCalls = 0
    const bridge = await createHostModelRouteBridge({
      resolveProviderRoute() {
        resolverCalls += 1
        throw new Error('resolveProviderRoute should not be called for malformed requests.')
      },
    })
    activeStops.push(bridge.stop)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER]: bridge.bootstrap.token,
      },
      body: JSON.stringify({
        providerProfileId: 'provider-1',
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES.INVALID_REQUEST,
        message: 'Host model route bridge request body is invalid.',
        details: {},
      },
    })
    expect(resolverCalls).toBe(0)
  })
})
