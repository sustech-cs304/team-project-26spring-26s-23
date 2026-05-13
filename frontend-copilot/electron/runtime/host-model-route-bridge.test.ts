import { afterEach, describe, expect, it } from 'vitest'
import {
  createHostModelRouteBridge,
  HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES,
  HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER,
} from './host-model-route-bridge'

const ROUTE_KIND = 'provider-model' as const
const PROFILE_ID = 'provider-1'
const MODEL_ID = 'gpt-4.1'
const PROVIDER = 'openai'
const PROVIDER_ID = 'openai'
const ADAPTER_ID = 'openai'
const ENDPOINT_FAMILY = 'openai'
const ENDPOINT_TYPE = 'openai-compatible'
const BASE_URL = 'https://api.example.com/v1'
const CATALOG_REV = '2026-04-06-provider-catalog-v1'
const AUTH_KIND = 'api-key' as const
const SECRET_VALUE = 'secret-value'

const ROUTE_REF = { routeKind: ROUTE_KIND, profileId: PROFILE_ID, modelId: MODEL_ID }

function makeResolvedRoute() {
  return {
    ok: true as const,
    resolvedRoute: {
      routeRef: ROUTE_REF,
      capabilityHints: {},
      providerProfileId: PROFILE_ID,
      provider: PROVIDER,
      providerId: PROVIDER_ID,
      adapterId: ADAPTER_ID,
      runtimeStatus: 'enabled' as const,
      catalogRevision: CATALOG_REV,
      endpointFamily: ENDPOINT_FAMILY,
      endpointType: ENDPOINT_TYPE,
      baseUrl: BASE_URL,
      modelId: MODEL_ID,
      authKind: AUTH_KIND,
    },
    privateAuth: {
      authKind: AUTH_KIND,
      authPayload: { apiKey: SECRET_VALUE },
      apiKey: SECRET_VALUE,
    },
  }
}

const activeStops: Array<() => Promise<void>> = []

afterEach(async () => {
  while (activeStops.length > 0) {
    const stop = activeStops.pop()
    if (stop === undefined) continue
    await stop()
  }
})

describe('createHostModelRouteBridge', () => {
  it('resolves a provider route for authenticated private runtime requests from stable route refs', async () => {
    const bridge = await createHostModelRouteBridge({
      async resolveProviderRoute(request) {
        expect(request).toEqual({ routeRef: ROUTE_REF, catalogRevision: CATALOG_REV })
        return makeResolvedRoute()
      },
    })
    activeStops.push(bridge.stop)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER]: bridge.bootstrap.token },
      body: JSON.stringify({ routeRef: ROUTE_REF, catalogRevision: CATALOG_REV }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(makeResolvedRoute())
  })

  it('rejects legacy snapshot request bodies even when routeRef is present', async () => {
    let resolverCalls = 0
    const bridge = await createHostModelRouteBridge({
      resolveProviderRoute() { resolverCalls += 1; throw new Error('resolveProviderRoute should not be called for legacy requests.') },
    })
    activeStops.push(bridge.stop)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER]: bridge.bootstrap.token },
      body: JSON.stringify({ routeRef: ROUTE_REF, snapshot: { provider: PROVIDER, endpointType: ENDPOINT_TYPE, baseUrl: BASE_URL, modelId: MODEL_ID } }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES.INVALID_REQUEST, message: 'Host model route bridge request body is invalid.', details: {} },
    })
    expect(resolverCalls).toBe(0)
  })

  it('rejects requests with an invalid private bridge token', async () => {
    const bridge = await createHostModelRouteBridge({
      resolveProviderRoute() { throw new Error('resolveProviderRoute should not be called when the token is invalid.') },
    })
    activeStops.push(bridge.stop)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER]: 'wrong-token' },
      body: JSON.stringify({ routeRef: ROUTE_REF }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES.INVALID_TOKEN, message: 'Missing or invalid host model route bridge token.', details: { headerName: HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER } },
    })
  })

  it('accepts repeated token headers when every supplied value matches the bootstrap token', async () => {
    let resolverCalls = 0
    const bridge = await createHostModelRouteBridge({
      resolveProviderRoute() { resolverCalls += 1; return makeResolvedRoute() },
    })
    activeStops.push(bridge.stop)

    const headers = new Headers({ 'content-type': 'application/json' })
    headers.append(HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER, bridge.bootstrap.token)
    headers.append(HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER, bridge.bootstrap.token)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ routeRef: ROUTE_REF }),
    })

    expect(response.status).toBe(200)
    expect(resolverCalls).toBe(1)
  })

  it('rejects malformed request bodies before resolver execution', async () => {
    let resolverCalls = 0
    const bridge = await createHostModelRouteBridge({
      resolveProviderRoute() { resolverCalls += 1; throw new Error('resolveProviderRoute should not be called for malformed requests.') },
    })
    activeStops.push(bridge.stop)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER]: bridge.bootstrap.token },
      body: JSON.stringify({ providerProfileId: PROFILE_ID }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES.INVALID_REQUEST, message: 'Host model route bridge request body is invalid.', details: {} },
    })
    expect(resolverCalls).toBe(0)
  })
})
