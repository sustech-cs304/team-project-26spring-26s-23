import { describe, expect, it } from 'vitest'

import { sendRuntimeMessage } from './chat-contract'
import {
  agentId,
  createFetchFn,
  createRuntimeErrorPayload,
  createRuntimeMessageSendResponse,
  createUserMessage,
  runtimeUrl,
  sessionId,
} from './chat-contract.test-support'

describe('sendRuntimeMessage', () => {
  it('posts message/send with request-scoped model, enabledTools and requestOptions', async () => {
    const fetchFn = createFetchFn(createRuntimeMessageSendResponse())

    const response = await sendRuntimeMessage({
      runtimeUrl,
      sessionId,
      agent: agentId,
      message: createUserMessage(),
      model: 'qwen-plus',
      enabledTools: ['tool.file-convert'],
      requestOptions: {
        trace: true,
      },
      fetchFn,
    })

    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8765/', {
      method: 'POST',
      headers: {
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
          model: 'qwen-plus',
          enabledTools: ['tool.file-convert'],
          requestOptions: {
            trace: true,
          },
        },
      }),
    })
    expect(response.resolvedModelId).toBe('qwen-plus')
    expect(response.resolvedToolIds).toEqual(['tool.file-convert'])
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
      },
    )

    await expect(sendRuntimeMessage({
      runtimeUrl,
      sessionId,
      agent: 'blackboard',
      message: createUserMessage(),
      model: 'qwen-plus',
      enabledTools: ['tool.file-convert'],
      requestOptions: {},
      fetchFn,
    })).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      code: 'agent_mismatch',
      status: 409,
    })
  })
})
