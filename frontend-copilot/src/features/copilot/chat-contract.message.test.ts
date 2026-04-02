import { describe, expect, it, vi } from 'vitest'

import { sendRuntimeMessage, type RuntimeRunEvent } from './chat-contract'
import {
  agentId,
  createFetchResponse,
  createFetchSequence,
  createRuntimeErrorPayload,
  createRuntimeModelRoute,
  createRuntimeRunCompletedEvent,
  createRuntimeRunStartResponse,
  createSseEventStream,
  createUserMessage,
  runtimeUrl,
  sessionId,
} from './chat-contract.test-support'

describe('sendRuntimeMessage', () => {
  it('posts run/start then run/stream with request-scoped modelRoute, enabledTools and requestOptions', async () => {
    const runEvents: RuntimeRunEvent[] = [
      {
        type: 'run_started',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 1,
        payload: {
          assistantMessageId: 'run-1:assistant',
        },
      },
      {
        type: 'text_delta',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          assistantMessageId: 'run-1:assistant',
          delta: '这是总结结果。',
        },
      },
      createRuntimeRunCompletedEvent({
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 3,
        payload: {
          assistantMessageId: 'run-1:assistant',
          assistantText: '这是总结结果。',
          resolvedModelId: 'qwen-plus',
          resolvedModelRoute: createRuntimeModelRoute(),
          resolvedToolIds: ['tool.file-convert'],
          requestOptions: {
            trace: true,
          },
        },
      }),
    ]
    const fetchFn = createFetchSequence(
      createFetchResponse(createRuntimeRunStartResponse({
        run: {
          runId: 'run-1',
          threadId: 'session-1',
          status: 'pending',
          createdAt: '2026-03-27T10:00:00Z',
          updatedAt: '2026-03-27T10:00:00Z',
          startedAt: null,
          terminalAt: null,
          cancelRequested: false,
        },
        assistantMessageId: 'run-1:assistant',
      }), {
        headers: {
          'content-type': 'application/json',
        },
      }),
      createFetchResponse({}, {
        headers: {
          'content-type': 'text/event-stream',
        },
        body: createSseEventStream(runEvents),
      }),
    )
    const onRunStart = vi.fn()

    const events = await collectEvents(sendRuntimeMessage({
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
      onRunStart,
    }))

    expect(events.map((event) => event.type)).toEqual([
      'run_started',
      'text_delta',
      'run_completed',
    ])
    expect(onRunStart).toHaveBeenCalledWith(expect.objectContaining({
      run: expect.objectContaining({
        runId: 'run-1',
        threadId: 'session-1',
      }),
      assistantMessageId: 'run-1:assistant',
    }))
    expect(fetchFn).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8765/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'run/start',
        body: {
          threadId: 'session-1',
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
    expect(fetchFn).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8765/', {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'run/stream',
        body: {
          runId: 'run-1',
        },
      }),
      signal: undefined,
    })
  })

  it('throws RuntimeRequestError for explicit run/start backend failures', async () => {
    const fetchFn = createFetchSequence(
      createFetchResponse(
        createRuntimeErrorPayload({
          code: 'agent_mismatch',
          message: 'thread is bound to general',
        }),
        {
          ok: false,
          status: 409,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
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

  it('forwards abort signals into both run/start and run/stream requests', async () => {
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    let callIndex = 0
    const rawFetchFn = vi.fn(async (..._args: Parameters<typeof fetch>) => {
      callIndex += 1
      if (callIndex === 1) {
        return createFetchResponse(createRuntimeRunStartResponse(), {
          headers: {
            'content-type': 'application/json',
          },
        }) as unknown as Response
      }
      throw abortError
    })
    const fetchFn = rawFetchFn as unknown as typeof fetch
    const abortController = new AbortController()

    await expect(collectEvents(sendRuntimeMessage({
      runtimeUrl,
      sessionId,
      agent: agentId,
      message: createUserMessage(),
      modelRoute: createRuntimeModelRoute(),
      enabledTools: [],
      requestOptions: {},
      fetchFn,
      signal: abortController.signal,
    }))).rejects.toMatchObject({
      name: 'AbortError',
    })

    expect(rawFetchFn).toHaveBeenCalledTimes(2)
    expect(rawFetchFn).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8765/', expect.objectContaining({
      signal: abortController.signal,
    }))
    expect(rawFetchFn).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8765/', expect.objectContaining({
      signal: abortController.signal,
    }))
  })
})

async function collectEvents(iterator: AsyncGenerator<RuntimeRunEvent>) {
  const events: RuntimeRunEvent[] = []
  for await (const event of iterator) {
    events.push(event)
  }
  return events
}
