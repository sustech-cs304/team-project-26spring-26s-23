import { describe, expect, it } from 'vitest'

import {
  createRuntimeResolvedModelRoute,
  createRuntimeRunMetadataEvent,
  createRuntimeThinkingCapability,
  createRuntimeThinkingSelection,
} from './thread-run-contract.test-support'
import { parseRuntimeRunEventStream } from './runtime-message-stream'

describe('parseRuntimeRunEventStream', () => {
  it('parses real tool_event payloads and keeps optional summaries', async () => {
    const events = await collectEvents(createSseEventStream([
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
        type: 'tool_event',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          toolCallId: 'tool.remote-search:call-1',
          toolId: 'tool.remote-search',
          phase: 'completed',
          title: '天气工具已返回结果',
          summary: 'Shenzhen：晴 / 24°C / 湿度 60%',
          inputSummary: '{"location":"Shenzhen"}',
          resultSummary: 'Shenzhen：晴 / 24°C / 湿度 60%',
        },
      },
      {
        type: 'run_completed',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 3,
        payload: {
          assistantMessageId: 'run-1:assistant',
          assistantText: '这是助手回显',
          resolvedModelId: 'qwen-plus',
          resolvedModelRoute: createRuntimeResolvedModelRoute({
            providerProfileId: 'provider-openai',
            modelId: 'qwen-plus',
          }),
          resolvedToolIds: ['tool.remote-search'],
          requestOptions: {},
        },
      },
    ]))

    expect(events).toHaveLength(3)
    expect(events[1]).toEqual({
      type: 'tool_event',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 2,
      payload: {
        toolCallId: 'tool.remote-search:call-1',
        toolId: 'tool.remote-search',
        phase: 'completed',
        title: '天气工具已返回结果',
        summary: 'Shenzhen：晴 / 24°C / 湿度 60%',
        inputSummary: '{"location":"Shenzhen"}',
        resultSummary: 'Shenzhen：晴 / 24°C / 湿度 60%',
      },
    })
  })

  it('parses standalone reasoning_delta payloads', async () => {
    const events = await collectEvents(createSseEventStream([
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
        type: 'reasoning_delta',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          delta: '先思考。',
        },
      },
      {
        type: 'run_completed',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 3,
        payload: {
          assistantMessageId: 'run-1:assistant',
          assistantText: '最终答案',
          resolvedModelId: 'qwen-plus',
          resolvedModelRoute: createRuntimeResolvedModelRoute({
            providerProfileId: 'provider-openai',
            modelId: 'qwen-plus',
          }),
          resolvedToolIds: [],
          requestOptions: {},
        },
      },
    ]))

    expect(events[1]).toEqual({
      type: 'reasoning_delta',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 2,
      payload: {
        delta: '先思考。',
      },
    })
  })

  it('parses run_metadata payloads with canonical thinking snapshot', async () => {
    const capability = createRuntimeThinkingCapability({
      status: 'unknown-with-override',
      source: 'override',
      supportedLevels: ['off', 'auto', 'low'],
      defaultLevel: 'auto',
      reasonCode: 'override_levels_applied',
      providerHint: null,
      overrideLevels: ['off', 'auto', 'low'],
    })

    const events = await collectEvents(createSseEventStream([
      createRuntimeRunMetadataEvent({
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          requestedThinkingSelection: createRuntimeThinkingSelection({ level: 'low' }),
          appliedThinkingSelection: createRuntimeThinkingSelection({ level: 'auto' }),
          requestedThinkingLevel: 'low',
          appliedThinkingLevel: 'auto',
          thinkingCapabilitySnapshot: capability,
          thinkingSeriesDecision: null,
          reasoningSuppressionBasis: null,
        },
      }),
    ]))

    expect(events).toEqual([
      {
        type: 'run_metadata',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          requestedThinkingSelection: createRuntimeThinkingSelection({ level: 'low' }),
          appliedThinkingSelection: createRuntimeThinkingSelection({ level: 'auto' }),
          requestedThinkingLevel: 'low',
          appliedThinkingLevel: 'auto',
          thinkingCapabilitySnapshot: capability,
          thinkingSeriesDecision: null,
          reasoningSuppressionBasis: null,
        },
      },
    ])
  })

  it('parses waiting_approval and cancelled phases with security payloads', async () => {
    const stream = createSseEventStream([
      {
        type: 'tool_event',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 1,
        payload: {
          toolCallId: 'tool.remote-search:call-1',
          toolId: 'tool.remote-search',
          phase: 'waiting_approval',
          title: '等待批准',
          summary: '等待批准',
          security: {
            riskLevel: 'high',
            approvalMethod: 'accept_reject',
          },
          approval: {
            mode: 'delay',
            timeoutAt: '2026-04-17T16:00:30Z',
            timeoutSeconds: 30,
            timeoutAction: 'deny',
          },
        },
      },
      {
        type: 'tool_event',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          toolCallId: 'tool.remote-search:call-2',
          toolId: 'tool.remote-search',
          phase: 'cancelled',
          title: '已取消',
          summary: '已取消',
        },
      },
    ])

    const events = await collectEvents(stream)
    expect(events).toHaveLength(2)

    const event0 = events[0]
    expect(event0.type).toBe('tool_event')
    if (event0.type === 'tool_event') {
      expect(event0.payload.phase).toBe('waiting_approval')
      expect(event0.payload.security).toEqual({
        riskLevel: 'high',
        approvalMethod: 'accept_reject',
      })
      expect(event0.payload.approval).toEqual({
        mode: 'delay',
        timeoutAt: '2026-04-17T16:00:30Z',
        timeoutSeconds: 30,
        timeoutAction: 'deny',
      })
    }

    const event1 = events[1]
    expect(event1.type).toBe('tool_event')
    if (event1.type === 'tool_event') {
      expect(event1.payload.phase).toBe('cancelled')
    }
  })

  it('parses waiting_approval approval payloads without timeoutAt', async () => {
    const stream = createSseEventStream([
      {
        type: 'tool_event',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 1,
        payload: {
          toolCallId: 'tool.remote-search:call-1',
          toolId: 'tool.remote-search',
          phase: 'waiting_approval',
          title: '等待批准',
          summary: '等待批准',
          approval: {
            mode: 'ask',
            timeoutSeconds: null,
            timeoutAction: null,
          },
        },
      },
    ])

    const events = await collectEvents(stream)
    expect(events).toHaveLength(1)

    const event0 = events[0]
    expect(event0.type).toBe('tool_event')
    if (event0.type === 'tool_event') {
      expect(event0.payload.phase).toBe('waiting_approval')
      expect(event0.payload.approval).toEqual({
        mode: 'ask',
        timeoutSeconds: null,
        timeoutAction: null,
      })
    }
  })

  it('rejects unsupported tool_event phases', async () => {
    const stream = createSseEventStream([
      {
        type: 'tool_event',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 1,
        payload: {
          toolCallId: 'tool.remote-search:call-1',
          toolId: 'tool.remote-search',
          phase: 'unknown_phase_xyz',
          title: '天气工具已取消',
          summary: '已取消',
        },
      },
    ])

    await expect(collectEvents(stream)).rejects.toThrow('Unsupported runtime tool event phase: unknown_phase_xyz')
  })

  it('rejects invalid security payloads', async () => {
    const stream = createSseEventStream([
      {
        type: 'tool_event',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 1,
        payload: {
          toolCallId: 'tool.remote-search:call-1',
          toolId: 'tool.remote-search',
          phase: 'waiting_approval',
          title: '等待批准',
          summary: '等待批准',
          security: 'not_an_object',
        },
      },
    ])

    await expect(collectEvents(stream)).rejects.toThrow('runtime event payload.security must be an object')
  })
})

async function collectEvents(stream: ReadableStream<Uint8Array>) {
  const events = []
  for await (const event of parseRuntimeRunEventStream(stream)) {
    events.push(event)
  }
  return events
}

function createSseEventStream(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  })
}
