import type {
  RuntimeReasoningDeltaEvent,
  RuntimeRunCompletedEvent,
  RuntimeRunDiagnosticEvent,
  RuntimeRunEvent,
  RuntimeRunFailedEvent,
  RuntimeRunMetadataEvent,
  RuntimeRunStartedEvent,
  RuntimeRunTerminalEvent,
  RuntimeTextDeltaEvent,
  RuntimeToolEvent,
  RuntimeToolEventSecurity,
} from './thread-run-contract'
import {
  parseOptionalRuntimeInlineFormRequest,
  parseOptionalRuntimeRunThinkingMetadata,
  requireNonEmptyString,
  requireOptionalString,
  requireRecord,
  requireRuntimeResolvedModelRoute,
  requireRuntimeRunEventType,
  requireRuntimeRunThinkingMetadata,
  requireRuntimeToolEventApproval,
  requireRuntimeToolEventPhase,
  requireSequence,
  requireString,
  requireStringArray,
} from './_stream/validators'

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
          ...parseOptionalRuntimeRunThinkingMetadata(payload, 'runtime event payload'),
        },
      } satisfies RuntimeRunStartedEvent
    case 'run_metadata':
      return {
        type: 'run_metadata',
        runId,
        sessionId,
        sequence,
        payload: requireRuntimeRunThinkingMetadata(payload, 'runtime event payload'),
      } satisfies RuntimeRunMetadataEvent
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
    case 'reasoning_delta':
      return {
        type: 'reasoning_delta',
        runId,
        sessionId,
        sequence,
        payload: {
          delta: requireString(payload.delta, 'runtime event payload.delta'),
        },
      } satisfies RuntimeReasoningDeltaEvent
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
          resolvedModelRoute: requireRuntimeResolvedModelRoute(
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

      if (payload.security !== undefined && payload.security !== null) {
        if (typeof payload.security !== 'object' || Array.isArray(payload.security)) {
          throw new Error('runtime event payload.security must be an object')
        }
        const securityObj = payload.security as Record<string, unknown>
        const riskLevel = securityObj.riskLevel
        if (riskLevel !== 'safe' && riskLevel !== 'moderate' && riskLevel !== 'high') {
          throw new Error(`Invalid security riskLevel: ${riskLevel}`)
        }
        const approvalMethod = securityObj.approvalMethod
        if (approvalMethod !== undefined && approvalMethod !== 'accept_reject' && approvalMethod !== 'password') {
          throw new Error(`Invalid security approvalMethod: ${approvalMethod}`)
        }
        const securityPayload: RuntimeToolEventSecurity = { riskLevel }
        if (approvalMethod) {
          securityPayload.approvalMethod = approvalMethod
        }
        toolEventPayload.security = securityPayload
      }

      if (payload.approval !== undefined && payload.approval !== null) {
        toolEventPayload.approval = requireRuntimeToolEventApproval(
          payload.approval,
          'runtime event payload.approval',
        )
      }

      const formRequest = parseOptionalRuntimeInlineFormRequest(payload.formRequest)
      if (formRequest !== undefined) {
        toolEventPayload.formRequest = formRequest
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

function normalizeSseBuffer(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
