import { describe, expect, it } from 'vitest'

import {
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
          toolCallId: 'tool.weather-current:call-1',
          toolId: 'tool.weather-current',
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
          resolvedModelRoute: {
            providerProfileId: 'provider-openai',
            snapshot: {
              provider: 'openai',
              endpointType: 'openai-compatible',
              baseUrl: 'https://api.example.com/v1',
              modelId: 'qwen-plus',
            },
          },
          resolvedToolIds: ['tool.weather-current'],
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
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
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
          resolvedModelRoute: {
            providerProfileId: 'provider-openai',
            snapshot: {
              provider: 'openai',
              endpointType: 'openai-compatible',
              baseUrl: 'https://api.example.com/v1',
              modelId: 'qwen-plus',
            },
          },
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
          thinkingSelectionResult: null,
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
          thinkingSelectionResult: null,
          reasoningSuppressionBasis: null,
        },
      },
    ])
  })

  it('rejects unsupported tool_event phases', async () => {
    const stream = createSseEventStream([
      {
        type: 'tool_event',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 1,
        payload: {
          toolCallId: 'tool.weather-current:call-1',
          toolId: 'tool.weather-current',
          phase: 'cancelled',
          title: '天气工具已取消',
          summary: '已取消',
        },
      },
    ])

    await expect(collectEvents(stream)).rejects.toThrow('Unsupported runtime tool event phase: cancelled')
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
