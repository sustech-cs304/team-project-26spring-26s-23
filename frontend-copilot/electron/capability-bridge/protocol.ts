export const DESKTOP_CAPABILITY_NAMES = ['secret', 'workspace', 'database', 'artifact', 'state', 'event'] as const
export type DesktopCapabilityName = (typeof DESKTOP_CAPABILITY_NAMES)[number]

export const DESKTOP_CAPABILITY_OPERATIONS = [
  'get_secret',
  'has_secret',
  'resolve_path',
  'ensure_directory',
  'save_text',
  'save_bytes',
  'describe_artifact',
  'get_value',
  'put_value',
  'delete_value',
  'emit_event',
] as const
export type DesktopCapabilityOperation = (typeof DESKTOP_CAPABILITY_OPERATIONS)[number]

export const DESKTOP_CAPABILITY_STATE_SCOPES = ['tool', 'run'] as const
export type DesktopCapabilityStateScope = (typeof DESKTOP_CAPABILITY_STATE_SCOPES)[number]

export const DESKTOP_CAPABILITY_BRIDGE_ERROR_CODES = [
  'invalid_request',
  'unsupported_capability',
  'unsupported_operation',
  'permission_denied',
  'not_found',
  'conflict',
  'payload_too_large',
  'temporarily_unavailable',
  'timeout',
  'internal_error',
] as const
export type DesktopCapabilityBridgeErrorCode = (typeof DESKTOP_CAPABILITY_BRIDGE_ERROR_CODES)[number]

export const DESKTOP_CAPABILITY_OPERATIONS_BY_CAPABILITY: Record<
  DesktopCapabilityName,
  readonly DesktopCapabilityOperation[]
> = {
  secret: ['get_secret', 'has_secret'],
  workspace: ['resolve_path', 'ensure_directory'],
  database: ['resolve_path'],
  artifact: ['save_text', 'save_bytes', 'describe_artifact'],
  state: ['get_value', 'put_value', 'delete_value'],
  event: ['emit_event'],
}

export interface DesktopCapabilityBridgeRequest {
  requestId: string
  capability: DesktopCapabilityName
  operation: DesktopCapabilityOperation
  toolId: string
  runId: string
  toolCallId: string
  payload: Record<string, unknown>
}

export interface DesktopCapabilityBridgeFailureResponse {
  requestId: string
  ok: false
  errorCode: DesktopCapabilityBridgeErrorCode
  errorMessage: string
  errorRetryable: boolean
  details: Record<string, unknown>
}

export interface DesktopCapabilityBridgeSuccessResponse {
  requestId: string
  ok: true
  result: Record<string, unknown>
}

export type DesktopCapabilityBridgeResponse =
  | DesktopCapabilityBridgeSuccessResponse
  | DesktopCapabilityBridgeFailureResponse

export function isSupportedDesktopCapabilityOperation(
  capability: DesktopCapabilityName,
  operation: DesktopCapabilityOperation,
): boolean {
  return DESKTOP_CAPABILITY_OPERATIONS_BY_CAPABILITY[capability].includes(operation)
}

export function normalizeDesktopCapabilityBridgeRequest(input: unknown): DesktopCapabilityBridgeRequest {
  const record = requireRecord(input, 'Desktop capability bridge request')

  const capability = requireStringEnum(
    record.capability,
    DESKTOP_CAPABILITY_NAMES,
    'capability',
  )
  const operation = requireStringEnum(
    record.operation,
    DESKTOP_CAPABILITY_OPERATIONS,
    'operation',
  )

  assertNoUnexpectedKeys(
    record,
    ['requestId', 'capability', 'operation', 'toolId', 'runId', 'toolCallId', 'payload'],
    'Desktop capability bridge request',
  )

  const payload = requireRecord(record.payload, 'payload')

  return {
    requestId: requireNonEmptyString(record.requestId, 'requestId'),
    capability,
    operation,
    toolId: requireNonEmptyString(record.toolId, 'toolId'),
    runId: requireNonEmptyString(record.runId, 'runId'),
    toolCallId: requireNonEmptyString(record.toolCallId, 'toolCallId'),
    payload: normalizeDesktopCapabilityBridgePayload(capability, operation, payload),
  }
}

export function createDesktopCapabilityBridgeSuccessResponse(
  requestId: string,
  result: Record<string, unknown> = {},
): DesktopCapabilityBridgeSuccessResponse {
  return {
    requestId,
    ok: true,
    result: { ...result },
  }
}

export function createDesktopCapabilityBridgeFailureResponse(input: {
  requestId: string
  errorCode: DesktopCapabilityBridgeErrorCode
  errorMessage: string
  errorRetryable?: boolean
  details?: Record<string, unknown>
}): DesktopCapabilityBridgeFailureResponse {
  return {
    requestId: input.requestId,
    ok: false,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    errorRetryable: input.errorRetryable ?? false,
    details: { ...(input.details ?? {}) },
  }
}

function normalizeDesktopCapabilityBridgePayload(
  capability: DesktopCapabilityName,
  operation: DesktopCapabilityOperation,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!isSupportedDesktopCapabilityOperation(capability, operation)) {
    return { ...payload }
  }

  switch (operation) {
    case 'get_secret':
    case 'has_secret':
      assertNoUnexpectedKeys(payload, ['secretName'], 'secret payload')
      return {
        secretName: requireNonEmptyString(payload.secretName, 'secretName'),
      }
    case 'resolve_path': {
      const payloadLabel = capability === 'database' ? 'database payload' : 'workspace payload'
      assertNoUnexpectedKeys(payload, ['relativePath'], payloadLabel)
      const relativePath = payload.relativePath
      return relativePath === undefined
        ? {}
        : { relativePath: requireNonEmptyString(relativePath, 'relativePath') }
    }
    case 'ensure_directory':
      assertNoUnexpectedKeys(payload, ['relativePath'], 'workspace payload')
      return {
        relativePath: requireNonEmptyString(payload.relativePath, 'relativePath'),
      }
    case 'save_text': {
      assertNoUnexpectedKeys(payload, ['name', 'text', 'contentType', 'metadata'], 'artifact payload')
      const normalized: Record<string, unknown> = {
        name: requireNonEmptyString(payload.name, 'name'),
        text: requireString(payload.text, 'text'),
      }
      if (payload.contentType !== undefined) {
        normalized.contentType = requireNonEmptyString(payload.contentType, 'contentType')
      }
      if (payload.metadata !== undefined) {
        normalized.metadata = requireRecord(payload.metadata, 'metadata')
      }
      return normalized
    }
    case 'save_bytes': {
      assertNoUnexpectedKeys(payload, ['name', 'contentBase64', 'contentType', 'metadata'], 'artifact payload')
      const normalized: Record<string, unknown> = {
        name: requireNonEmptyString(payload.name, 'name'),
        contentBase64: requireNonEmptyString(payload.contentBase64, 'contentBase64'),
      }
      if (payload.contentType !== undefined) {
        normalized.contentType = requireNonEmptyString(payload.contentType, 'contentType')
      }
      if (payload.metadata !== undefined) {
        normalized.metadata = requireRecord(payload.metadata, 'metadata')
      }
      return normalized
    }
    case 'describe_artifact':
      assertNoUnexpectedKeys(payload, ['artifactId'], 'artifact payload')
      return {
        artifactId: requireNonEmptyString(payload.artifactId, 'artifactId'),
      }
    case 'get_value':
    case 'delete_value':
      assertNoUnexpectedKeys(payload, ['scope', 'key'], 'state payload')
      return {
        scope: requireStringEnum(payload.scope, DESKTOP_CAPABILITY_STATE_SCOPES, 'scope'),
        key: requireNonEmptyString(payload.key, 'key'),
      }
    case 'put_value':
      assertNoUnexpectedKeys(payload, ['scope', 'key', 'value'], 'state payload')
      return {
        scope: requireStringEnum(payload.scope, DESKTOP_CAPABILITY_STATE_SCOPES, 'scope'),
        key: requireNonEmptyString(payload.key, 'key'),
        value: requireRecord(payload.value, 'value'),
      }
    case 'emit_event': {
      assertNoUnexpectedKeys(payload, ['eventType', 'message', 'data'], 'event payload')
      const normalized: Record<string, unknown> = {
        eventType: requireNonEmptyString(payload.eventType, 'eventType'),
      }
      if (payload.message !== undefined) {
        normalized.message = requireNonEmptyString(payload.message, 'message')
      }
      if (payload.data !== undefined) {
        normalized.data = requireRecord(payload.data, 'data')
      }
      return normalized
    }
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }

  return { ...(value as Record<string, unknown>) }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }

  return value
}

function requireNonEmptyString(value: unknown, label: string): string {
  const normalized = requireString(value, label).trim()
  if (normalized === '') {
    throw new Error(`${label} must be a non-empty string.`)
  }

  return normalized
}

function requireStringEnum<TValue extends string>(
  value: unknown,
  allowedValues: readonly TValue[],
  label: string,
): TValue {
  const normalized = requireNonEmptyString(value, label)
  if (!allowedValues.includes(normalized as TValue)) {
    throw new Error(`${label} must be one of: ${allowedValues.join(', ')}.`)
  }

  return normalized as TValue
}

function assertNoUnexpectedKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const unexpectedKeys = Object.keys(record).filter((key) => !allowedKeys.includes(key))
  if (unexpectedKeys.length > 0) {
    throw new Error(`${label} contains unsupported field(s): ${unexpectedKeys.join(', ')}.`)
  }
}
