import { formatThinkingTokenCount } from '../../workbench/thinking-display'
import type {
  RuntimeCanonicalThinkingSelection,
  RuntimeModelRoute,
  RuntimeReasoningDeltaEvent,
  RuntimeReasoningSuppressionBasis,
  RuntimeRunCompletedEvent,
  RuntimeRunDiagnosticEvent,
  RuntimeRunEvent,
  RuntimeRunFailedEvent,
  RuntimeRunMetadataEvent,
  RuntimeRunStartedEvent,
  RuntimeRunTerminalEvent,
  RuntimeRunThinkingMetadata,
  RuntimeTextDeltaEvent,
  RuntimeThinkingCapability,
  RuntimeThinkingCapabilityProvenance,
  RuntimeThinkingControlSpec,
  RuntimeThinkingLevel,
  RuntimeThinkingSelection,
  RuntimeThinkingSelectionResult,
  RuntimeThinkingVisibility,
  RuntimeToolEvent,
  RuntimeToolEventPhase,
} from './thread-run-contract'

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
    case 'run_metadata':
    case 'text_delta':
    case 'reasoning_delta':
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

function requireNullableRuntimeThinkingSelection(
  value: unknown,
  label: string,
): RuntimeThinkingSelection | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireRuntimeThinkingSelection(value, label)
}

function requireRuntimeThinkingSelection(value: unknown, label: string): RuntimeThinkingSelection {
  const record = requireRecord(value, label)
  const series = requireNonEmptyString(record.series, `${label}.series`)
  const runtimeValue = record.value === undefined
    ? buildRuntimeThinkingValueFromLegacyRecord(record, label)
    : requireRuntimeThinkingValue(record.value, `${label}.value`)

  if (runtimeValue === null) {
    throw new Error(`${label}.value must describe a valid thinking series value.`)
  }

  return {
    series,
    value: runtimeValue,
    ...deriveLegacyRuntimeThinkingSelectionFields(runtimeValue),
  }
}

function requireRuntimeRunThinkingMetadata(
  value: Record<string, unknown>,
  label: string,
): RuntimeRunThinkingMetadata {
  const thinkingSeriesDecision = requireNullableRuntimeThinkingSelectionResult(
    value.thinkingSeriesDecision ?? value.thinkingSelectionResult,
    `${label}.thinkingSeriesDecision`,
  )
  const requestedThinkingLevel = hasOwn(value, 'requestedThinkingLevel')
    ? requireOptionalThinkingLevel(value.requestedThinkingLevel, `${label}.requestedThinkingLevel`)
    : undefined
  const appliedThinkingLevel = hasOwn(value, 'appliedThinkingLevel')
    ? requireOptionalThinkingLevel(value.appliedThinkingLevel, `${label}.appliedThinkingLevel`)
    : undefined

  return {
    requestedThinkingSelection: requireNullableRuntimeThinkingSelection(
      value.requestedThinkingSelection,
      `${label}.requestedThinkingSelection`,
    ),
    appliedThinkingSelection: requireNullableRuntimeThinkingSelection(
      value.appliedThinkingSelection,
      `${label}.appliedThinkingSelection`,
    ),
    thinkingCapabilitySnapshot: requireNullableRuntimeThinkingCapability(
      value.thinkingCapabilitySnapshot,
      `${label}.thinkingCapabilitySnapshot`,
    ),
    thinkingSeriesDecision,
    ...(requestedThinkingLevel === undefined ? {} : { requestedThinkingLevel }),
    ...(appliedThinkingLevel === undefined ? {} : { appliedThinkingLevel }),
    reasoningSuppressionBasis: requireNullableRuntimeReasoningSuppressionBasis(
      value.reasoningSuppressionBasis,
      `${label}.reasoningSuppressionBasis`,
    ),
  }
}

function parseOptionalRuntimeRunThinkingMetadata(
  value: Record<string, unknown>,
  label: string,
): Partial<RuntimeRunThinkingMetadata> {
  const partial: Partial<RuntimeRunThinkingMetadata> = {}
  if (hasOwn(value, 'requestedThinkingSelection')) {
    partial.requestedThinkingSelection = requireNullableRuntimeThinkingSelection(
      value.requestedThinkingSelection,
      `${label}.requestedThinkingSelection`,
    )
  }
  if (hasOwn(value, 'appliedThinkingSelection')) {
    partial.appliedThinkingSelection = requireNullableRuntimeThinkingSelection(
      value.appliedThinkingSelection,
      `${label}.appliedThinkingSelection`,
    )
  }
  if (hasOwn(value, 'requestedThinkingLevel')) {
    partial.requestedThinkingLevel = requireOptionalThinkingLevel(
      value.requestedThinkingLevel,
      `${label}.requestedThinkingLevel`,
    )
  }
  if (hasOwn(value, 'appliedThinkingLevel')) {
    partial.appliedThinkingLevel = requireOptionalThinkingLevel(
      value.appliedThinkingLevel,
      `${label}.appliedThinkingLevel`,
    )
  }
  if (hasOwn(value, 'thinkingCapabilitySnapshot')) {
    partial.thinkingCapabilitySnapshot = requireNullableRuntimeThinkingCapability(
      value.thinkingCapabilitySnapshot,
      `${label}.thinkingCapabilitySnapshot`,
    )
  }
  if (hasOwn(value, 'thinkingSeriesDecision') || hasOwn(value, 'thinkingSelectionResult')) {
    const thinkingSeriesDecision = requireNullableRuntimeThinkingSelectionResult(
      value.thinkingSeriesDecision ?? value.thinkingSelectionResult,
      `${label}.thinkingSeriesDecision`,
    )
    partial.thinkingSeriesDecision = thinkingSeriesDecision
  }
  if (hasOwn(value, 'reasoningSuppressionBasis')) {
    partial.reasoningSuppressionBasis = requireNullableRuntimeReasoningSuppressionBasis(
      value.reasoningSuppressionBasis,
      `${label}.reasoningSuppressionBasis`,
    )
  }
  return partial
}

function requireNullableRuntimeThinkingCapability(
  value: unknown,
  label: string,
): RuntimeThinkingCapability | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireRuntimeThinkingCapability(value, label)
}

function requireRuntimeThinkingCapability(value: unknown, label: string): RuntimeThinkingCapability {
  const record = requireRecord(value, label)
  const routeFingerprint = requireRecord(record.routeFingerprint, `${label}.routeFingerprint`)

  return {
    status: requireRuntimeThinkingCapabilityStatus(record.status, `${label}.status`),
    source: requireRuntimeThinkingCapabilitySource(record.source, `${label}.source`),
    series: requireNullableString(record.series, `${label}.series`),
    seriesLabelZh: requireNullableString(record.seriesLabelZh, `${label}.seriesLabelZh`),
    editorType: requireNullableRuntimeThinkingEditorType(record.editorType, `${label}.editorType`),
    allowedValues: requireRuntimeThinkingValueArray(record.allowedValues, `${label}.allowedValues`),
    defaultValue: requireNullableRuntimeThinkingValue(record.defaultValue, `${label}.defaultValue`),
    providerBuilderKey: requireNullableString(record.providerBuilderKey, `${label}.providerBuilderKey`),
    reasonCode: requireNonEmptyString(record.reasonCode, `${label}.reasonCode`),
    routeFingerprint: {
      providerProfileId: requireNonEmptyString(routeFingerprint.providerProfileId, `${label}.routeFingerprint.providerProfileId`),
      provider: requireNonEmptyString(routeFingerprint.provider, `${label}.routeFingerprint.provider`),
      endpointType: requireNonEmptyString(routeFingerprint.endpointType, `${label}.routeFingerprint.endpointType`),
      baseUrl: requireNonEmptyString(routeFingerprint.baseUrl, `${label}.routeFingerprint.baseUrl`),
      modelId: requireNonEmptyString(routeFingerprint.modelId, `${label}.routeFingerprint.modelId`),
    },
    ...(hasOwn(record, 'supported') ? { supported: requireBoolean(record.supported, `${label}.supported`) } : {}),
    ...(hasOwn(record, 'controlSpec')
      ? { controlSpec: requireNullableRuntimeThinkingControlSpec(record.controlSpec, `${label}.controlSpec`) }
      : {}),
    ...(hasOwn(record, 'defaultSelection')
      ? {
          defaultSelection: requireNullableRuntimeCanonicalThinkingSelection(
            record.defaultSelection,
            `${label}.defaultSelection`,
          ),
        }
      : {}),
    ...(hasOwn(record, 'supportedLevels')
      ? { supportedLevels: requireThinkingLevelArray(record.supportedLevels, `${label}.supportedLevels`) }
      : {}),
    ...(hasOwn(record, 'defaultLevel')
      ? { defaultLevel: requireOptionalThinkingLevel(record.defaultLevel, `${label}.defaultLevel`) }
      : {}),
    ...(hasOwn(record, 'providerHint')
      ? { providerHint: requireNullableString(record.providerHint, `${label}.providerHint`) }
      : {}),
    ...(hasOwn(record, 'provenance')
      ? { provenance: requireNullableRuntimeThinkingCapabilityProvenance(record.provenance, `${label}.provenance`) }
      : {}),
    ...(hasOwn(record, 'visibility')
      ? { visibility: requireNullableRuntimeThinkingVisibility(record.visibility, `${label}.visibility`) }
      : {}),
    ...(hasOwn(record, 'overrideLevels')
      ? { overrideLevels: requireThinkingLevelArray(record.overrideLevels, `${label}.overrideLevels`) }
      : {}),
  }
}

function requireNullableRuntimeThinkingEditorType(
  value: unknown,
  label: string,
): RuntimeThinkingCapability['editorType'] {
  if (value === null || value === undefined) {
    return null
  }
  const normalized = requireNonEmptyString(value, label)
  switch (normalized) {
    case 'discrete':
    case 'budget':
    case 'fixed':
      return normalized
    default:
      throw new Error(`${label} must be a supported thinking editor type.`)
  }
}

function requireRuntimeThinkingValueArray(
  value: unknown,
  label: string,
): RuntimeThinkingCapability['allowedValues'] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`)
  }
  return value.map((item, index) => requireRuntimeThinkingValue(item, `${label}[${index}]`))
}

function requireNullableRuntimeThinkingValue(
  value: unknown,
  label: string,
): NonNullable<RuntimeThinkingSelection['value']> | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireRuntimeThinkingValue(value, label)
}

function requireRuntimeThinkingValue(
  value: unknown,
  label: string,
): NonNullable<RuntimeThinkingSelection['value']> {
  const record = requireRecord(value, label)
  const valueType = requireNonEmptyString(record.valueType, `${label}.valueType`)
  switch (valueType) {
    case 'code':
      return {
        valueType: 'code',
        code: requireNonEmptyString(record.code, `${label}.code`),
        labelZh: requireNonEmptyString(record.labelZh, `${label}.labelZh`),
      }
    case 'budget': {
      const mode = requireNonEmptyString(record.mode, `${label}.mode`)
      if (mode !== 'off' && mode !== 'dynamic' && mode !== 'budget') {
        throw new Error(`${label}.mode must be off, dynamic, or budget.`)
      }
      return {
        valueType: 'budget',
        mode,
        budgetTokens: requireNullableNonNegativeInteger(record.budgetTokens, `${label}.budgetTokens`),
        labelZh: requireNonEmptyString(record.labelZh, `${label}.labelZh`),
      }
    }
    case 'fixed':
      return {
        valueType: 'fixed',
        code: 'fixed',
        labelZh: requireNonEmptyString(record.labelZh, `${label}.labelZh`),
      }
    default:
      throw new Error(`${label}.valueType must be a supported thinking value type.`)
  }
}

function buildRuntimeThinkingValueFromLegacyRecord(
  record: Record<string, unknown>,
  label: string,
): NonNullable<RuntimeThinkingSelection['value']> | null {
  const mode = requireNullableString(record.mode, `${label}.mode`)
  const level = requireNullableString(record.level, `${label}.level`)
  const budgetTokens = requireNullableNonNegativeInteger(record.budgetTokens, `${label}.budgetTokens`)

  if (mode === 'budget' && budgetTokens !== null) {
    return {
      valueType: 'budget',
      mode: 'budget',
      budgetTokens,
      labelZh: formatThinkingTokenCount(budgetTokens),
    }
  }

  if (level === null) {
    return null
  }

  if (level === 'fixed') {
    return {
      valueType: 'fixed',
      code: 'fixed',
      labelZh: '固定推理',
    }
  }

  const normalizedLevel = requireThinkingLevel(level, `${label}.level`)
  return {
    valueType: 'code',
    code: normalizedLevel,
    labelZh: normalizedLevel,
  }
}

function deriveLegacyRuntimeThinkingSelectionFields(
  value: NonNullable<RuntimeThinkingSelection['value']>,
): Pick<RuntimeThinkingSelection, 'mode' | 'level' | 'budgetTokens'> {
  switch (value.valueType) {
    case 'budget':
      return {
        mode: 'budget',
        level: null,
        budgetTokens: value.mode === 'budget' ? value.budgetTokens : null,
      }
    case 'fixed':
      return {
        mode: 'preset',
        level: 'fixed',
        budgetTokens: null,
      }
    case 'code':
      return {
        mode: 'preset',
        level: value.code,
        budgetTokens: null,
      }
  }
}

function requireNullableRuntimeCanonicalThinkingSelection(
  value: unknown,
  label: string,
): RuntimeCanonicalThinkingSelection | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireRuntimeCanonicalThinkingSelection(value, label)
}

function requireRuntimeCanonicalThinkingSelection(
  value: unknown,
  label: string,
): RuntimeCanonicalThinkingSelection {
  const record = requireRecord(value, label)
  const kind = requireRuntimeThinkingSelectionKind(record.kind, `${label}.kind`)
  if (kind === 'budget') {
    return {
      kind,
      budgetTokens: requireNonNegativeInteger(record.budgetTokens, `${label}.budgetTokens`),
    }
  }
  return {
    kind,
    value: requireThinkingLevel(record.value, `${label}.value`),
  }
}

function requireNullableRuntimeThinkingControlSpec(
  value: unknown,
  label: string,
): RuntimeThinkingControlSpec | null {
  if (value === null || value === undefined) {
    return null
  }
  const record = requireRecord(value, label)
  return {
    kind: requireRuntimeThinkingControlKind(record.kind, `${label}.kind`),
    selectionKind: requireRuntimeThinkingSelectionKind(record.selectionKind, `${label}.selectionKind`),
    ...(record.presetOptions === undefined
      ? {}
      : {
          presetOptions: requireRuntimeCanonicalThinkingSelectionArray(
            record.presetOptions,
            `${label}.presetOptions`,
          ),
        }),
    ...(record.fixedSelection === undefined
      ? {}
      : {
          fixedSelection: requireNullableRuntimeCanonicalThinkingSelection(
            record.fixedSelection,
            `${label}.fixedSelection`,
          ),
        }),
    ...(record.budget === undefined
      ? {}
      : {
          budget: requireNullableRuntimeThinkingControlBudgetSpec(record.budget, `${label}.budget`),
        }),
  }
}

function requireRuntimeCanonicalThinkingSelectionArray(
  value: unknown,
  label: string,
): RuntimeCanonicalThinkingSelection[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`)
  }
  return value.map((item, index) => requireRuntimeCanonicalThinkingSelection(item, `${label}[${index}]`))
}

function requireNullableRuntimeThinkingControlBudgetSpec(
  value: unknown,
  label: string,
): RuntimeThinkingControlSpec['budget'] {
  if (value === null || value === undefined) {
    return null
  }
  const record = requireRecord(value, label)
  return {
    ...(record.minTokens === undefined ? {} : { minTokens: requireNonNegativeInteger(record.minTokens, `${label}.minTokens`) }),
    ...(record.maxTokens === undefined ? {} : { maxTokens: requireNonNegativeInteger(record.maxTokens, `${label}.maxTokens`) }),
    ...(record.stepTokens === undefined ? {} : { stepTokens: requireNonNegativeInteger(record.stepTokens, `${label}.stepTokens`) }),
  }
}

function requireNullableRuntimeThinkingCapabilityProvenance(
  value: unknown,
  label: string,
): RuntimeThinkingCapabilityProvenance | null {
  if (value === null || value === undefined) {
    return null
  }
  const record = requireRecord(value, label)
  const override = requireRecord(record.override, `${label}.override`)
  return {
    routeStatus: requireNonEmptyString(record.routeStatus, `${label}.routeStatus`),
    override: {
      present: requireBoolean(override.present, `${label}.override.present`),
      applied: requireBoolean(override.applied, `${label}.override.applied`),
      source: requireNullableString(override.source, `${label}.override.source`),
      format: requireNullableString(override.format, `${label}.override.format`),
    },
  }
}

function requireNullableRuntimeThinkingVisibility(
  value: unknown,
  label: string,
): RuntimeThinkingVisibility | null {
  if (value === null || value === undefined) {
    return null
  }
  const record = requireRecord(value, label)
  return {
    reasoning: requireNonEmptyString(record.reasoning, `${label}.reasoning`),
    supportsSuppression: requireBoolean(record.supportsSuppression, `${label}.supportsSuppression`),
  }
}

function requireNullableRuntimeThinkingSelectionResult(
  value: unknown,
  label: string,
): RuntimeThinkingSelectionResult | null {
  if (value === null || value === undefined) {
    return null
  }
  const record = requireRecord(value, label)
  return {
    requestedSelection: requireNullableRuntimeThinkingSelection(record.requestedSelection, `${label}.requestedSelection`),
    appliedSelection: requireNullableRuntimeThinkingSelection(record.appliedSelection, `${label}.appliedSelection`),
    applied: requireBoolean(record.applied, `${label}.applied`),
    reasonCode: requireNonEmptyString(record.reasonCode, `${label}.reasonCode`),
    errorCode: requireNullableString(record.errorCode, `${label}.errorCode`),
    providerBuilderKey: requireNullableString(record.providerBuilderKey, `${label}.providerBuilderKey`),
    mappingReasonCode: requireNullableString(record.mappingReasonCode, `${label}.mappingReasonCode`),
    capabilityStatus: requireRuntimeThinkingCapabilityStatus(record.capabilityStatus, `${label}.capabilityStatus`),
    capabilitySource: requireRuntimeThinkingCapabilitySource(record.capabilitySource, `${label}.capabilitySource`),
    capabilitySeries: requireNullableString(record.capabilitySeries, `${label}.capabilitySeries`),
    capabilitySeriesLabelZh: requireNullableString(record.capabilitySeriesLabelZh, `${label}.capabilitySeriesLabelZh`),
    capabilityReasonCode: requireNullableString(record.capabilityReasonCode, `${label}.capabilityReasonCode`),
    ...(hasOwn(record, 'requestedThinkingLevel')
      ? { requestedThinkingLevel: requireOptionalThinkingLevel(record.requestedThinkingLevel, `${label}.requestedThinkingLevel`) }
      : {}),
    ...(hasOwn(record, 'appliedThinkingLevel')
      ? { appliedThinkingLevel: requireOptionalThinkingLevel(record.appliedThinkingLevel, `${label}.appliedThinkingLevel`) }
      : {}),
    ...(hasOwn(record, 'providerMapping')
      ? { providerMapping: requireNullableString(record.providerMapping, `${label}.providerMapping`) }
      : {}),
    ...(hasOwn(record, 'overridePresent')
      ? { overridePresent: requireBoolean(record.overridePresent, `${label}.overridePresent`) }
      : {}),
    ...(hasOwn(record, 'overrideApplied')
      ? { overrideApplied: requireBoolean(record.overrideApplied, `${label}.overrideApplied`) }
      : {}),
    ...(hasOwn(record, 'overrideSource')
      ? { overrideSource: requireNullableString(record.overrideSource, `${label}.overrideSource`) }
      : {}),
    ...(hasOwn(record, 'reasoningVisibility')
      ? { reasoningVisibility: requireNullableString(record.reasoningVisibility, `${label}.reasoningVisibility`) }
      : {}),
    ...(hasOwn(record, 'supportsSuppression')
      ? { supportsSuppression: requireNullableBoolean(record.supportsSuppression, `${label}.supportsSuppression`) }
      : {}),
    ...(record.modelSettings === undefined
      ? {}
      : { modelSettings: requireRecord(record.modelSettings, `${label}.modelSettings`) }),
  }
}

function requireNullableRuntimeReasoningSuppressionBasis(
  value: unknown,
  label: string,
): RuntimeReasoningSuppressionBasis | null {
  if (value === null || value === undefined) {
    return null
  }
  const record = requireRecord(value, label)
  const appliedThinkingLevel = hasOwn(record, 'appliedThinkingLevel')
    ? requireOptionalThinkingLevel(record.appliedThinkingLevel, `${label}.appliedThinkingLevel`)
    : undefined
  const appliedThinkingSelection = hasOwn(record, 'appliedThinkingSelection')
    ? requireNullableRuntimeThinkingSelection(record.appliedThinkingSelection, `${label}.appliedThinkingSelection`)
    : null

  return {
    shouldSuppress: requireBoolean(record.shouldSuppress, `${label}.shouldSuppress`),
    source: requireNonEmptyString(record.source, `${label}.source`),
    reasonCode: requireNullableString(record.reasonCode, `${label}.reasonCode`),
    appliedThinkingSelection,
    reasoningVisibility: requireNullableString(record.reasoningVisibility, `${label}.reasoningVisibility`),
    supportsSuppression: requireBoolean(record.supportsSuppression, `${label}.supportsSuppression`),
    capabilitySource: record.capabilitySource === null || record.capabilitySource === undefined
      ? null
      : requireRuntimeThinkingCapabilitySource(record.capabilitySource, `${label}.capabilitySource`),
    capabilitySeries: requireNullableString(record.capabilitySeries, `${label}.capabilitySeries`),
    ...(appliedThinkingLevel === undefined ? {} : { appliedThinkingLevel }),
  }
}

function requireRuntimeThinkingCapabilityStatus(
  value: unknown,
  label: string,
): RuntimeThinkingCapability['status'] {
  const normalized = requireNonEmptyString(value, label)
  switch (normalized) {
    case 'verified-supported':
    case 'verified-unsupported':
    case 'unknown-without-override':
    case 'unknown-with-override':
      return normalized
    default:
      throw new Error(`${label} must be a supported thinking capability status.`)
  }
}

function requireRuntimeThinkingCapabilitySource(
  value: unknown,
  label: string,
): RuntimeThinkingCapability['source'] {
  const normalized = requireNonEmptyString(value, label)
  switch (normalized) {
    case 'verified':
    case 'override':
    case 'unknown':
      return normalized
    default:
      throw new Error(`${label} must be a supported thinking capability source.`)
  }
}

function requireThinkingLevelArray(
  value: unknown,
  label: string,
): RuntimeThinkingLevel[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of thinking levels.`)
  }

  return value.map((item, index) => requireThinkingLevel(item, `${label}[${index}]`))
}

function requireOptionalThinkingLevel(
  value: unknown,
  label: string,
): RuntimeThinkingLevel | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireThinkingLevel(value, label)
}

function requireThinkingLevel(
  value: unknown,
  label: string,
): RuntimeThinkingLevel {
  const normalized = requireNonEmptyString(value, label)
  switch (normalized) {
    case 'off':
    case 'auto':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return normalized
    default:
      throw new Error(`${label} must be a supported thinking level.`)
  }
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`)
  }
  return value
}

function requireNullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireBoolean(value, label)
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return value
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireString(value, label)
}

function requireNullableNonNegativeInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return value
}

function requireRuntimeThinkingControlKind(
  value: unknown,
  label: string,
): RuntimeThinkingControlSpec['kind'] {
  const normalized = requireNonEmptyString(value, label)
  switch (normalized) {
    case 'fixed':
    case 'binary':
    case 'off-auto':
    case 'discrete':
    case 'budget':
      return normalized
    default:
      throw new Error(`${label} must be a supported thinking control kind.`)
  }
}

function requireRuntimeThinkingSelectionKind(
  value: unknown,
  label: string,
): RuntimeCanonicalThinkingSelection['kind'] {
  const normalized = requireNonEmptyString(value, label)
  switch (normalized) {
    case 'preset':
    case 'budget':
      return normalized
    default:
      throw new Error(`${label} must be a supported thinking selection kind.`)
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

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizeSseBuffer(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
