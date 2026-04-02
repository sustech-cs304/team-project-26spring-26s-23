import type {
  RuntimeModelRoute,
  RuntimeRunCompletedEvent,
  RuntimeRunDiagnosticEvent,
  RuntimeRunEvent,
  RuntimeRunFailedEvent,
  RuntimeRunStartedEvent,
  RuntimeRunTerminalEvent,
  RuntimeTextDeltaEvent,
  RuntimeToolEvent,
  RuntimeToolEventPhase,
} from './chat-contract'

const TERMINAL_RUNTIME_RUN_EVENT_TYPES = new Set<RuntimeRunEvent['type']>([
  'run_completed',
  'run_failed',
  'run_cancelled',
])

export async function* parseRuntimeRunEventStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<RuntimeRunEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        buffer += decoder.decode()
        break
      }

      buffer += decoder.decode(chunk.value, { stream: true })
      buffer = normalizeSseBuffer(buffer)

      while (true) {
        const boundaryIndex = buffer.indexOf('\n\n')
        if (boundaryIndex < 0) {
          break
        }

        const rawBlock = buffer.slice(0, boundaryIndex)
        buffer = buffer.slice(boundaryIndex + 2)
        const event = parseRuntimeRunEventBlock(rawBlock)
        if (event !== null) {
          yield event
        }
      }
    }

    const remainingEvent = parseRuntimeRunEventBlock(normalizeSseBuffer(buffer))
    if (remainingEvent !== null) {
      yield remainingEvent
    }
  } finally {
    reader.releaseLock()
  }
}

export function isTerminalRuntimeRunEvent(
  event: RuntimeRunEvent,
): event is RuntimeRunTerminalEvent {
  return TERMINAL_RUNTIME_RUN_EVENT_TYPES.has(event.type)
}

function parseRuntimeRunEventBlock(block: string): RuntimeRunEvent | null {
  const trimmedBlock = block.trim()
  if (trimmedBlock === '') {
    return null
  }

  const dataLines = trimmedBlock
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())

  if (dataLines.length === 0) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(dataLines.join('\n'))
  } catch (error) {
    throw new Error(`Failed to parse runtime event payload JSON: ${formatUnknownError(error)}`)
  }

  return parseRuntimeRunEvent(parsed)
}

function parseRuntimeRunEvent(value: unknown): RuntimeRunEvent {
  const record = requireRecord(value, 'runtime event')
  const eventType = requireRuntimeRunEventType(record.type)
  const runId = requireNonEmptyString(record.runId, 'runtime event.runId')
  const sessionId = requireNonEmptyString(record.sessionId, 'runtime event.sessionId')
  const sequence = requireSequence(record.sequence)
  const payload = requireRecord(record.payload, `runtime event payload for "${eventType}"`)

  switch (eventType) {
    case 'run_started':
      return {
        type: 'run_started',
        runId,
        sessionId,
        sequence,
        payload: {
          assistantMessageId: requireNonEmptyString(
            payload.assistantMessageId,
            'runtime event payload.assistantMessageId',
          ),
        },
      } satisfies RuntimeRunStartedEvent
    case 'text_delta':
      return {
        type: 'text_delta',
        runId,
        sessionId,
        sequence,
        payload: {
          assistantMessageId: requireNonEmptyString(
            payload.assistantMessageId,
            'runtime event payload.assistantMessageId',
          ),
          delta: requireString(payload.delta, 'runtime event payload.delta'),
        },
      } satisfies RuntimeTextDeltaEvent
    case 'run_completed':
      return {
        type: 'run_completed',
        runId,
        sessionId,
        sequence,
        payload: {
          assistantMessageId: requireNonEmptyString(
            payload.assistantMessageId,
            'runtime event payload.assistantMessageId',
          ),
          assistantText: requireString(payload.assistantText, 'runtime event payload.assistantText'),
          resolvedModelId: requireNonEmptyString(
            payload.resolvedModelId,
            'runtime event payload.resolvedModelId',
          ),
          resolvedModelRoute: requireRuntimeModelRoute(
            payload.resolvedModelRoute,
            'runtime event payload.resolvedModelRoute',
          ),
          resolvedToolIds: requireStringArray(payload.resolvedToolIds, 'runtime event payload.resolvedToolIds'),
          requestOptions: requireRecord(payload.requestOptions, 'runtime event payload.requestOptions'),
        },
      } satisfies RuntimeRunCompletedEvent
    case 'run_failed':
      return {
        type: 'run_failed',
        runId,
        sessionId,
        sequence,
        payload: {
          code: requireNonEmptyString(payload.code, 'runtime event payload.code'),
          message: requireString(payload.message, 'runtime event payload.message'),
          details: requireRecord(payload.details, 'runtime event payload.details'),
        },
      } satisfies RuntimeRunFailedEvent
    case 'run_cancelled':
      return {
        type: 'run_cancelled',
        runId,
        sessionId,
        sequence,
        payload: {
          assistantMessageId: requireNonEmptyString(
            payload.assistantMessageId,
            'runtime event payload.assistantMessageId',
          ),
          reason: requireString(payload.reason, 'runtime event payload.reason'),
        },
      }
    case 'run_diagnostic':
      return {
        type: 'run_diagnostic',
        runId,
        sessionId,
        sequence,
        payload: {
          code: requireNonEmptyString(payload.code, 'runtime event payload.code'),
          message: requireString(payload.message, 'runtime event payload.message'),
          details: requireRecord(payload.details, 'runtime event payload.details'),
          stage: requireNonEmptyString(payload.stage, 'runtime event payload.stage'),
        },
      } satisfies RuntimeRunDiagnosticEvent
    case 'tool_event': {
      const toolEventPayload: RuntimeToolEvent['payload'] = {
        toolCallId: requireNonEmptyString(payload.toolCallId, 'runtime event payload.toolCallId'),
        toolId: requireNonEmptyString(payload.toolId, 'runtime event payload.toolId'),
        phase: requireRuntimeToolEventPhase(payload.phase),
        title: requireNonEmptyString(payload.title, 'runtime event payload.title'),
        summary: requireNonEmptyString(payload.summary, 'runtime event payload.summary'),
      }
      const inputSummary = requireOptionalString(payload.inputSummary, 'runtime event payload.inputSummary')
      const resultSummary = requireOptionalString(payload.resultSummary, 'runtime event payload.resultSummary')
      const errorSummary = requireOptionalString(payload.errorSummary, 'runtime event payload.errorSummary')
      if (inputSummary !== undefined) {
        toolEventPayload.inputSummary = inputSummary
      }
      if (resultSummary !== undefined) {
        toolEventPayload.resultSummary = resultSummary
      }
      if (errorSummary !== undefined) {
        toolEventPayload.errorSummary = errorSummary
      }
      return {
        type: 'tool_event',
        runId,
        sessionId,
        sequence,
        payload: toolEventPayload,
      } satisfies RuntimeToolEvent
    }
  }
}

function requireRuntimeModelRoute(value: unknown, label: string): RuntimeModelRoute {
  const record = requireRecord(value, label)
  const snapshot = requireRecord(record.snapshot, `${label}.snapshot`)

  return {
    providerProfileId: requireNonEmptyString(record.providerProfileId, `${label}.providerProfileId`),
    snapshot: {
      provider: requireNonEmptyString(snapshot.provider, `${label}.snapshot.provider`),
      endpointType: requireNonEmptyString(snapshot.endpointType, `${label}.snapshot.endpointType`),
      baseUrl: requireNonEmptyString(snapshot.baseUrl, `${label}.snapshot.baseUrl`),
      modelId: requireNonEmptyString(snapshot.modelId, `${label}.snapshot.modelId`),
    },
  }
}

function requireRuntimeRunEventType(value: unknown): RuntimeRunEvent['type'] {
  const eventType = requireNonEmptyString(value, 'runtime event.type')
  switch (eventType) {
    case 'run_started':
    case 'text_delta':
    case 'run_completed':
    case 'run_failed':
    case 'run_cancelled':
    case 'run_diagnostic':
    case 'tool_event':
      return eventType
    default:
      throw new Error(`Unsupported runtime event type: ${eventType}`)
  }
}

function requireRuntimeToolEventPhase(value: unknown): RuntimeToolEventPhase {
  const phase = requireNonEmptyString(value, 'runtime event payload.phase')
  switch (phase) {
    case 'started':
    case 'completed':
    case 'failed':
      return phase
    default:
      throw new Error(`Unsupported runtime tool event phase: ${phase}`)
  }
}

function requireSequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('runtime event.sequence must be a positive integer.')
  }

  return value
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`)
  }

  return value.map((item, index) => requireString(item, `${label}[${index}]`))
}

function requireOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return requireString(value, label)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }

  return value as Record<string, unknown>
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }

  return value
}

function requireNonEmptyString(value: unknown, label: string): string {
  const normalizedValue = requireString(value, label).trim()
  if (normalizedValue === '') {
    throw new Error(`${label} must be a non-empty string.`)
  }

  return normalizedValue
}

function normalizeSseBuffer(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
