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

const EVENT_PAYLOAD_ASSISTANT_MESSAGE_ID_PATH = 'runtime event payload.assistantMessageId'

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
      return parseRunStartedEvent(runId, sessionId, sequence, payload)
    case 'run_metadata':
      return parseRunMetadataEvent(runId, sessionId, sequence, payload)
    case 'text_delta':
      return parseTextDeltaEvent(runId, sessionId, sequence, payload)
    case 'reasoning_delta':
      return parseReasoningDeltaEvent(runId, sessionId, sequence, payload)
    case 'run_completed':
      return parseRunCompletedEvent(runId, sessionId, sequence, payload)
    case 'run_failed':
      return parseRunFailedEvent(runId, sessionId, sequence, payload)
    case 'run_cancelled':
      return parseRunCancelledEvent(runId, sessionId, sequence, payload)
    case 'run_diagnostic':
      return parseRunDiagnosticEvent(runId, sessionId, sequence, payload)
    case 'tool_event':
      return parseToolEvent(runId, sessionId, sequence, payload)
  }
}

function parseRunStartedEvent(
  runId: string, sessionId: string, sequence: number, payload: Record<string, unknown>,
): RuntimeRunStartedEvent {
  return {
    type: 'run_started', runId, sessionId, sequence,
    payload: {
      assistantMessageId: requireNonEmptyString(payload.assistantMessageId, EVENT_PAYLOAD_ASSISTANT_MESSAGE_ID_PATH),
      ...parseOptionalRuntimeRunThinkingMetadata(payload, 'runtime event payload'),
    },
  }
}

function parseRunMetadataEvent(
  runId: string, sessionId: string, sequence: number, payload: Record<string, unknown>,
): RuntimeRunMetadataEvent {
  return {
    type: 'run_metadata', runId, sessionId, sequence,
    payload: requireRuntimeRunThinkingMetadata(payload, 'runtime event payload'),
  }
}

function parseTextDeltaEvent(
  runId: string, sessionId: string, sequence: number, payload: Record<string, unknown>,
): RuntimeTextDeltaEvent {
  return {
    type: 'text_delta', runId, sessionId, sequence,
    payload: {
      assistantMessageId: requireNonEmptyString(payload.assistantMessageId, EVENT_PAYLOAD_ASSISTANT_MESSAGE_ID_PATH),
      delta: requireString(payload.delta, 'runtime event payload.delta'),
    },
  }
}

function parseReasoningDeltaEvent(
  runId: string, sessionId: string, sequence: number, payload: Record<string, unknown>,
): RuntimeReasoningDeltaEvent {
  return {
    type: 'reasoning_delta', runId, sessionId, sequence,
    payload: {
      delta: requireString(payload.delta, 'runtime event payload.delta'),
    },
  }
}

function parseRunCompletedEvent(
  runId: string, sessionId: string, sequence: number, payload: Record<string, unknown>,
): RuntimeRunCompletedEvent {
  return {
    type: 'run_completed', runId, sessionId, sequence,
    payload: {
      assistantMessageId: requireNonEmptyString(payload.assistantMessageId, EVENT_PAYLOAD_ASSISTANT_MESSAGE_ID_PATH),
      assistantText: requireString(payload.assistantText, 'runtime event payload.assistantText'),
      resolvedModelId: requireNonEmptyString(payload.resolvedModelId, 'runtime event payload.resolvedModelId'),
      resolvedModelRoute: requireRuntimeResolvedModelRoute(payload.resolvedModelRoute, 'runtime event payload.resolvedModelRoute'),
      resolvedToolIds: requireStringArray(payload.resolvedToolIds, 'runtime event payload.resolvedToolIds'),
      requestOptions: requireRecord(payload.requestOptions, 'runtime event payload.requestOptions'),
    },
  }
}

function parseRunFailedEvent(
  runId: string, sessionId: string, sequence: number, payload: Record<string, unknown>,
): RuntimeRunFailedEvent {
  return {
    type: 'run_failed', runId, sessionId, sequence,
    payload: {
      code: requireNonEmptyString(payload.code, 'runtime event payload.code'),
      message: requireString(payload.message, 'runtime event payload.message'),
      details: requireRecord(payload.details, 'runtime event payload.details'),
    },
  }
}

function parseRunCancelledEvent(
  runId: string, sessionId: string, sequence: number, payload: Record<string, unknown>,
): RuntimeRunEvent {
  return {
    type: 'run_cancelled', runId, sessionId, sequence,
    payload: {
      assistantMessageId: requireNonEmptyString(payload.assistantMessageId, EVENT_PAYLOAD_ASSISTANT_MESSAGE_ID_PATH),
      reason: requireString(payload.reason, 'runtime event payload.reason'),
    },
  }
}

function parseRunDiagnosticEvent(
  runId: string, sessionId: string, sequence: number, payload: Record<string, unknown>,
): RuntimeRunDiagnosticEvent {
  return {
    type: 'run_diagnostic', runId, sessionId, sequence,
    payload: {
      code: requireNonEmptyString(payload.code, 'runtime event payload.code'),
      message: requireString(payload.message, 'runtime event payload.message'),
      details: requireRecord(payload.details, 'runtime event payload.details'),
      stage: requireNonEmptyString(payload.stage, 'runtime event payload.stage'),
    },
  }
}

function parseToolEvent(
  runId: string, sessionId: string, sequence: number, payload: Record<string, unknown>,
): RuntimeToolEvent {
  const toolEventPayload: RuntimeToolEvent['payload'] = {
    toolCallId: requireNonEmptyString(payload.toolCallId, 'runtime event payload.toolCallId'),
    toolId: requireNonEmptyString(payload.toolId, 'runtime event payload.toolId'),
    phase: requireRuntimeToolEventPhase(payload.phase),
    title: requireNonEmptyString(payload.title, 'runtime event payload.title'),
    summary: requireNonEmptyString(payload.summary, 'runtime event payload.summary'),
  }

  assignOptionalStringField(toolEventPayload, 'inputSummary', payload.inputSummary, 'runtime event payload.inputSummary')
  assignOptionalStringField(toolEventPayload, 'resultSummary', payload.resultSummary, 'runtime event payload.resultSummary')
  assignOptionalStringField(toolEventPayload, 'errorSummary', payload.errorSummary, 'runtime event payload.errorSummary')

  if (payload.security !== undefined && payload.security !== null) {
    toolEventPayload.security = parseToolEventSecurity(payload.security)
  }

  if (payload.approval !== undefined && payload.approval !== null) {
    toolEventPayload.approval = requireRuntimeToolEventApproval(payload.approval, 'runtime event payload.approval')
  }

  const formRequest = parseOptionalRuntimeInlineFormRequest(payload.formRequest)
  if (formRequest !== undefined) {
    toolEventPayload.formRequest = formRequest
  }

  return { type: 'tool_event', runId, sessionId, sequence, payload: toolEventPayload }
}

function assignOptionalStringField(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  path: string,
): void {
  const resolved = requireOptionalString(value, path)
  if (resolved !== undefined) {
    target[key] = resolved
  }
}

function parseToolEventSecurity(security: unknown): RuntimeToolEventSecurity {
  if (typeof security !== 'object' || security === null || Array.isArray(security)) {
    throw new Error('runtime event payload.security must be an object')
  }
  const securityObj = security as Record<string, unknown>
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
  return securityPayload
}

function normalizeSseBuffer(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
