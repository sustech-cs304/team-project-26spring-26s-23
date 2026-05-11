import { describe, expect, it, vi } from 'vitest'

import type { RuntimeRunEvent } from './thread-run-contract'
import { dispatchCopilotMessage } from './copilot-send-controller'
import {
  agentId,
  createFetchResponse,
  createFetchSequence,
  createRuntimeErrorPayload,
  createRuntimeModelRoute,
  createRuntimeRunCompletedEvent,
  createRuntimeRunStartResponse,
  createRuntimeThinkingSelection,
  createSseEventStream,
  createUserMessage,
  runtimeUrl,
  sessionId,
} from './thread-run-contract.test-support'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const LABEL_HTTP_127 = 'http://127.0.0.1:8765/'
const LABEL_RUN_ASSISTANT = 'run-1:assistant'
const LABEL_TOOL_REMOTE_SEARCH = 'tool.remote-search'


const RUNTIME_CONNECTIVITY_ERROR_MESSAGE = '无法连接到本地运行时，可能由后端异常、CORS 或网络拒绝导致，请查看运行时控制台日志。'

describe('dispatchCopilotMessage', () => {
  it('posts run/start then run/stream with structured thinking payload as the main transport path', async () => {
    const runEvents: RuntimeRunEvent[] = [
      {
        type: 'run_started',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 1,
        payload: {
          assistantMessageId: LABEL_RUN_ASSISTANT,
        },
      },
      {
        type: 'text_delta',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          assistantMessageId: LABEL_RUN_ASSISTANT,
          delta: '这是总结结果。',
        },
      },
      createRuntimeRunCompletedEvent({
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 3,
        payload: {
          assistantMessageId: LABEL_RUN_ASSISTANT,
          assistantText: '这是总结结果。',
          resolvedModelId: 'qwen-plus',
          resolvedModelRoute: createRuntimeModelRoute(),
          resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
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
        assistantMessageId: LABEL_RUN_ASSISTANT,
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

    const events = await collectEvents(dispatchCopilotMessage({
      runtimeUrl,
      sessionId,
      agent: agentId,
      message: createUserMessage(),
      modelRoute: createRuntimeModelRoute(),
      thinkingSelection: createRuntimeThinkingSelection({ level: 'auto' }),
      enabledTools: [LABEL_TOOL_REMOTE_SEARCH],
      debugModeEnabled: true,
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
      assistantMessageId: LABEL_RUN_ASSISTANT,
    }))
    expect(fetchFn).toHaveBeenNthCalledWith(1, LABEL_HTTP_127, {
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
            modelRoute: {
              routeRef: {
                routeKind: 'provider-model',
                profileId: 'provider-openai',
                modelId: 'qwen-plus',
              },
              catalogRevision: '2026-04-06-provider-catalog-v1',
            },
            thinkingSelection: {
              series: 'compat-discrete-selection-v1',
              value: {
                valueType: 'code',
                code: 'auto',
                labelZh: '自动',
              },
            },
            enabledTools: [LABEL_TOOL_REMOTE_SEARCH],
            debugModeEnabled: true,
            requestOptions: {
              trace: true,
            },
          },
        },
      }),
      signal: undefined,
    })
    expect(fetchFn).toHaveBeenNthCalledWith(2, LABEL_HTTP_127, {
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
      for await (const _event of dispatchCopilotMessage({
        runtimeUrl,
        sessionId,
        agent: 'blackboard',
        message: createUserMessage(),
        modelRoute: createRuntimeModelRoute(),
        thinkingSelection: null,
        enabledTools: [LABEL_TOOL_REMOTE_SEARCH],
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

  it.each([
    ['native TypeError rejection', new TypeError('Failed to fetch')],
    ['plain Failed to fetch rejection', new Error('Failed to fetch')],
    ['CORS rejection', new Error('CORS policy blocked the request')],
  ])('maps %s during run/start into a readable RuntimeRequestError', async (_label, fetchError) => {
    const rawFetchFn = vi.fn().mockRejectedValue(fetchError)
    const fetchFn = rawFetchFn as unknown as typeof fetch

    await expect(collectEvents(dispatchCopilotMessage({
      runtimeUrl,
      sessionId,
      agent: agentId,
      message: createUserMessage(),
      modelRoute: createRuntimeModelRoute(),
      thinkingSelection: null,
      enabledTools: [LABEL_TOOL_REMOTE_SEARCH],
      requestOptions: {},
      fetchFn,
    }))).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      code: null,
      status: 0,
      message: RUNTIME_CONNECTIVITY_ERROR_MESSAGE,
    })

    expect(rawFetchFn).toHaveBeenCalledTimes(1)
  })

  it('maps browser connectivity failures during run/stream into a readable RuntimeRequestError', async () => {
    const rawFetchFn = vi.fn()
    rawFetchFn.mockResolvedValueOnce(createFetchResponse(createRuntimeRunStartResponse(), {
      headers: {
        'content-type': 'application/json',
      },
    }))
    rawFetchFn.mockRejectedValueOnce(new Error('CORS policy blocked the request'))
    const fetchFn = rawFetchFn as unknown as typeof fetch

    await expect(collectEvents(dispatchCopilotMessage({
      runtimeUrl,
      sessionId,
      agent: agentId,
      message: createUserMessage(),
      modelRoute: createRuntimeModelRoute(),
      thinkingSelection: null,
      enabledTools: [LABEL_TOOL_REMOTE_SEARCH],
      requestOptions: {},
      fetchFn,
    }))).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      code: null,
      status: 0,
      message: RUNTIME_CONNECTIVITY_ERROR_MESSAGE,
    })

    expect(rawFetchFn).toHaveBeenCalledTimes(2)
  })

  it('forwards abort signals into both run/start and run/stream requests', async () => {
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    let callIndex = 0
    const rawFetchFn = vi.fn(async () => {
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

    await expect(collectEvents(dispatchCopilotMessage({
      runtimeUrl,
      sessionId,
      agent: agentId,
      message: createUserMessage(),
      modelRoute: createRuntimeModelRoute(),
      thinkingSelection: null,
      enabledTools: [],
      requestOptions: {},
      fetchFn,
      signal: abortController.signal,
    }))).rejects.toMatchObject({
      name: 'AbortError',
    })

    expect(rawFetchFn).toHaveBeenCalledTimes(2)
    expect(rawFetchFn).toHaveBeenNthCalledWith(1, LABEL_HTTP_127, expect.objectContaining({
      signal: abortController.signal,
    }))
    expect(rawFetchFn).toHaveBeenNthCalledWith(2, LABEL_HTTP_127, expect.objectContaining({
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
