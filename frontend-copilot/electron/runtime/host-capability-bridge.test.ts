import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesktopCapabilityBridgeSuccessResponse } from '../capability-bridge/protocol'
import {
  createHostCapabilityBridge,
  HOST_CAPABILITY_BRIDGE_TOKEN_HEADER,
} from './host-capability-bridge'

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

describe('createHostCapabilityBridge', () => {
  it('dispatches authenticated capability bridge requests through the configured handler', async () => {
    const bridge = await createHostCapabilityBridge({
      async handleRequest(request) {
        expect(request).toEqual({
          requestId: 'request-1',
          capability: 'secret',
          operation: 'get_secret',
          toolId: 'blackboard.snapshot.sync',
          runId: 'run-1',
          toolCallId: 'call-1',
          payload: {
            secretName: 'provider.openrouter.apiKey',
          },
        })

        return createDesktopCapabilityBridgeSuccessResponse(request.requestId, {
          value: 'resolved-secret',
        })
      },
    })
    activeStops.push(bridge.stop)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HOST_CAPABILITY_BRIDGE_TOKEN_HEADER]: bridge.bootstrap.token,
      },
      body: JSON.stringify({
        requestId: 'request-1',
        capability: 'secret',
        operation: 'get_secret',
        toolId: 'blackboard.snapshot.sync',
        runId: 'run-1',
        toolCallId: 'call-1',
        payload: {
          secretName: 'provider.openrouter.apiKey',
        },
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      requestId: 'request-1',
      ok: true,
      result: {
        value: 'resolved-secret',
      },
    })
  })

  it('rejects requests with an invalid private bridge token', async () => {
    const bridge = await createHostCapabilityBridge({
      handleRequest() {
        throw new Error('handleRequest should not be called when the token is invalid.')
      },
    })
    activeStops.push(bridge.stop)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HOST_CAPABILITY_BRIDGE_TOKEN_HEADER]: 'wrong-token',
      },
      body: JSON.stringify({
        requestId: 'request-unauthorized',
        capability: 'secret',
        operation: 'get_secret',
        toolId: 'blackboard.snapshot.sync',
        runId: 'run-1',
        toolCallId: 'call-1',
        payload: {
          secretName: 'provider.openrouter.apiKey',
        },
      }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      requestId: 'unauthorized',
      ok: false,
      errorCode: 'permission_denied',
      errorMessage: 'Missing or invalid host capability bridge token.',
      errorRetryable: false,
      details: {
        headerName: HOST_CAPABILITY_BRIDGE_TOKEN_HEADER,
      },
    })
  })

  it('rejects malformed capability request bodies before handler execution', async () => {
    let handlerCalls = 0
    const bridge = await createHostCapabilityBridge({
      handleRequest() {
        handlerCalls += 1
        throw new Error('handleRequest should not be called for malformed requests.')
      },
    })
    activeStops.push(bridge.stop)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HOST_CAPABILITY_BRIDGE_TOKEN_HEADER]: bridge.bootstrap.token,
      },
      body: JSON.stringify({
        requestId: 'request-invalid',
        capability: 'secret',
        operation: 'get_secret',
        toolId: 'blackboard.snapshot.sync',
        runId: 'run-1',
        toolCallId: 'call-1',
        payload: {
          wrongField: 'provider.openrouter.apiKey',
        },
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      requestId: 'request-invalid',
      ok: false,
      errorCode: 'invalid_request',
      errorRetryable: false,
    })
    expect(handlerCalls).toBe(0)
  })

  it('maps handler failures into protocol failure responses', async () => {
    const bridge = await createHostCapabilityBridge({
      handleRequest() {
        throw new Error('bridge exploded')
      },
    })
    activeStops.push(bridge.stop)

    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HOST_CAPABILITY_BRIDGE_TOKEN_HEADER]: bridge.bootstrap.token,
      },
      body: JSON.stringify({
        requestId: 'request-error',
        capability: 'event',
        operation: 'emit_event',
        toolId: 'blackboard.snapshot.sync',
        runId: 'run-1',
        toolCallId: 'call-1',
        payload: {
          eventType: 'log',
          message: 'hello',
          data: {
            source: 'test',
          },
        },
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      requestId: 'request-error',
      ok: false,
      errorCode: 'internal_error',
      errorMessage: 'bridge exploded',
      errorRetryable: false,
      details: {},
    })
  })

  it('rejects oversized request bodies before handler execution', async () => {
    let handlerCalls = 0
    const bridge = await createHostCapabilityBridge({
      handleRequest() {
        handlerCalls += 1
        throw new Error('handleRequest should not be called for oversized payloads.')
      },
    })
    activeStops.push(bridge.stop)

    const abortSignal = AbortSignal.timeout(5_000)
    const response = await fetch(bridge.bootstrap.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HOST_CAPABILITY_BRIDGE_TOKEN_HEADER]: bridge.bootstrap.token,
      },
      body: JSON.stringify({
        requestId: 'request-too-large',
        capability: 'event',
        operation: 'emit_event',
        toolId: 'blackboard.snapshot.sync',
        runId: 'run-1',
        toolCallId: 'call-1',
        payload: {
          message: 'x'.repeat(1024 * 1024),
        },
      }),
      signal: abortSignal,
    })

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      requestId: 'invalid-request',
      ok: false,
      errorCode: 'payload_too_large',
      errorMessage: 'Host capability bridge request body exceeds 1048576 bytes.',
      errorRetryable: false,
      details: {
        maxBodyBytes: 1048576,
      },
    })
    expect(handlerCalls).toBe(0)
    vi.clearAllTimers()
  })
})
