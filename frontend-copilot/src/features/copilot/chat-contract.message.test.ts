import { describe, expect, it } from 'vitest'

import { sendRuntimeMessage } from './chat-contract'
import {
  agentId,
  createFetchFn,
  createRuntimeErrorPayload,
  createRuntimeModelRoute,
  createUserMessage,
  runtimeUrl,
  sessionId,
} from './chat-contract.test-support'

describe('sendRuntimeMessage', () => {
  it('posts message/send with request-scoped modelRoute, enabledTools and requestOptions', async () => {
    const fetchFn = createFetchFn(createRuntimeErrorPayload(), {
      ok: false,
      status: 418,
      headers: {
        'content-type': 'application/json',
      },
    })

    await expect(async () => {
      for await (const _event of sendRuntimeMessage({
        runtimeUrl,
        sessionId,
        agent: agentId,
        message: createUserMessage(),
        modelRoute: createRuntimeModelRoute(),
        enabledTools: ['tool.file-convert'],
        requestOptions: {
          trace: true,
        },
        fetchFn,
      })) {
        throw new Error(`Unexpected event: ${JSON.stringify(_event)}`)
      }
    }).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      status: 418,
    })

    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8765/', {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'message/send',
        body: {
          sessionId: 'session-1',
          agent: 'general',
          message: {
            role: 'user',
            content: '请总结这份文档',
          },
          policy: {
            modelRoute: createRuntimeModelRoute(),
            enabledTools: ['tool.file-convert'],
            requestOptions: {
              trace: true,
            },
          },
        },
      }),
      signal: undefined,
    })
  })

  it('throws RuntimeRequestError for explicit message/send backend failures', async () => {
    const fetchFn = createFetchFn(
      createRuntimeErrorPayload({
        code: 'agent_mismatch',
        message: 'session is bound to general',
      }),
      {
        ok: false,
        status: 409,
        headers: {
          'content-type': 'application/json',
        },
      },
    )

    await expect(async () => {
      for await (const _event of sendRuntimeMessage({
        runtimeUrl,
        sessionId,
        agent: 'blackboard',
        message: createUserMessage(),
        modelRoute: createRuntimeModelRoute(),
        enabledTools: ['tool.file-convert'],
        requestOptions: {},
        fetchFn,
      })) {
        throw new Error(`Unexpected event: ${JSON.stringify(_event)}`)
      }
    }).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      code: 'agent_mismatch',
      status: 409,
    })
  })
})
