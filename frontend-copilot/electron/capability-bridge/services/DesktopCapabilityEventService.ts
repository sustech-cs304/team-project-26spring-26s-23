import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { DesktopCapabilityBridgeError } from '../errors'
import type {
  CreateDesktopCapabilityBridgeServiceOptions,
  DesktopCapabilityBridgeLogLevel,
} from '../types'

interface NormalizedDesktopCapabilityEventPayload {
  eventType: string
  message: string | null
  data: Record<string, unknown>
}

export interface DesktopCapabilityEventService {
  handle(request: DesktopCapabilityBridgeRequest): Promise<Record<string, unknown>>
}

export function createDesktopCapabilityEventService(
  options: CreateDesktopCapabilityBridgeServiceOptions,
): DesktopCapabilityEventService {
  return {
    async handle(request) {
      if (request.operation !== 'emit_event') {
        throw new DesktopCapabilityBridgeError(
          'unsupported_operation',
          `Event capability does not support operation '${request.operation}'.`,
          {
            details: {
              capability: request.capability,
              operation: request.operation,
            },
          },
        )
      }

      const payload = normalizeEventPayload(request.payload)
      await options.appendLog?.(resolveEventLogLevel(payload), '[capability-bridge] Event emitted.', {
        capability: request.capability,
        operation: request.operation,
        toolId: request.toolId,
        runId: request.runId,
        toolCallId: request.toolCallId,
        eventType: payload.eventType,
        message: payload.message,
        data: payload.data,
      }, {
        relayToRenderer: false,
      })

      return {}
    },
  }
}

function normalizeEventPayload(payload: Record<string, unknown>): NormalizedDesktopCapabilityEventPayload {
  return {
    eventType: requireNonEmptyString(payload.eventType, 'eventType must be a non-empty string.'),
    message: normalizeOptionalNonEmptyString(payload.message, 'message must be a non-empty string when provided.'),
    data: normalizeOptionalRecord(payload.data, 'data must be an object when provided.'),
  }
}

function resolveEventLogLevel(payload: NormalizedDesktopCapabilityEventPayload): DesktopCapabilityBridgeLogLevel {
  const hintedLevel = normalizeLogLevel(payload.data.level) ?? normalizeLogLevel(payload.data.severity)
  if (hintedLevel !== null) {
    return hintedLevel
  }

  return normalizeLogLevel(payload.eventType) ?? 'info'
}

function requireNonEmptyString(value: unknown, message: string): string {
  const normalized = normalizeOptionalString(value)
  if (normalized === null) {
    throw new DesktopCapabilityBridgeError('invalid_request', message)
  }

  return normalized
}

function normalizeOptionalNonEmptyString(value: unknown, message: string): string | null {
  if (value === undefined) {
    return null
  }

  const normalized = normalizeOptionalString(value)
  if (normalized === null) {
    throw new DesktopCapabilityBridgeError('invalid_request', message)
  }

  return normalized
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function normalizeOptionalRecord(value: unknown, message: string): Record<string, unknown> {
  if (value === undefined) {
    return {}
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DesktopCapabilityBridgeError('invalid_request', message)
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value as Record<string, unknown>)
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function normalizeLogLevel(value: unknown): DesktopCapabilityBridgeLogLevel | null {
  if (typeof value !== 'string') {
    return null
  }

  switch (value.trim().toLowerCase()) {
    case 'error':
      return 'error'
    case 'warn':
    case 'warning':
      return 'warn'
    case 'info':
      return 'info'
    default:
      return null
  }
}
