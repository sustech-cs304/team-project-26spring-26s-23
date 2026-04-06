import {
  cloneRuntimeReasoningSuppressionBasis as cloneRuntimeReasoningSuppressionBasisValue,
  cloneRuntimeThinkingCapability as cloneRuntimeThinkingCapabilityValue,
  cloneRuntimeThinkingSelection as cloneRuntimeThinkingSelectionValue,
  cloneRuntimeThinkingSelectionResult as cloneRuntimeThinkingSelectionResultValue,
  type RuntimeModelRoute,
  type RuntimeRunCompletedEvent,
  type RuntimeRunEvent,
  type RuntimeRunFailedEvent,
  type RuntimeRunMetadataEvent,
  type RuntimeRunThinkingMetadata,
  type RuntimeRunView,
  type RuntimeThinkingCapability,
  type RuntimeToolEvent,
} from './thread-run-contract'
import type {
  CopilotAssistantSegment,
  CopilotDiagnosticSegment,
  CopilotReasoningSegment,
  CopilotRunDiagnosticSummary,
  CopilotRunFailureSummary,
  CopilotRunSegment,
  CopilotTerminalSegment,
  CopilotToolSegment,
} from './run-segment-types'
import type { CopilotRunState } from './types'

export function createIdleCopilotRunState(): CopilotRunState {
  return {
    phase: 'idle',
    runId: null,
    threadId: null,
    activeModelRoute: null,
    resolvedModelId: null,
    resolvedModelRoute: null,
    resolvedToolIds: [],
    requestOptions: {},
    requestedThinkingSelection: null,
    appliedThinkingSelection: null,
    requestedThinkingLevel: null,
    appliedThinkingLevel: null,
    thinkingCapabilitySnapshot: null,
    thinkingSelectionResult: null,
    reasoningSuppressionBasis: null,
    reasoningSuppressed: false,
    reasoningTraceState: 'not_observed',
    diagnostic: null,
    failure: null,
    cancelReason: null,
    segments: [],
  }
}

export function createStartingCopilotRunState(input: {
  threadId: string
  activeModelRoute: RuntimeModelRoute
  requestOptions: Record<string, unknown>
}): CopilotRunState {
  return {
    ...createIdleCopilotRunState(),
    phase: 'starting',
    threadId: input.threadId,
    activeModelRoute: cloneRuntimeModelRoute(input.activeModelRoute),
    requestOptions: { ...input.requestOptions },
  }
}

export function registerCopilotRunStartResponse(
  state: CopilotRunState,
  input: Pick<RuntimeRunView, 'runId' | 'threadId'> & Partial<RuntimeRunThinkingMetadata>,
): CopilotRunState {
  return applyRunThinkingMetadataToState(
    {
      ...state,
      runId: input.runId,
      threadId: input.threadId,
    },
    input,
  )
}

function applyRunThinkingMetadataToState(
  state: CopilotRunState,
  metadata: Partial<RuntimeRunThinkingMetadata>,
): CopilotRunState {
  const requestedThinkingSelection = metadata.requestedThinkingSelection === undefined
    ? state.requestedThinkingSelection
    : cloneRuntimeThinkingSelection(metadata.requestedThinkingSelection)
  const appliedThinkingSelection = metadata.appliedThinkingSelection === undefined
    ? state.appliedThinkingSelection
    : cloneRuntimeThinkingSelection(metadata.appliedThinkingSelection)
  const requestedThinkingLevel = metadata.requestedThinkingLevel === undefined
    ? state.requestedThinkingLevel
    : metadata.requestedThinkingLevel
  const appliedThinkingLevel = metadata.appliedThinkingLevel === undefined
    ? state.appliedThinkingLevel
    : metadata.appliedThinkingLevel
  const thinkingCapabilitySnapshot = metadata.thinkingCapabilitySnapshot === undefined
    ? state.thinkingCapabilitySnapshot
    : cloneRuntimeThinkingCapability(metadata.thinkingCapabilitySnapshot)
  const thinkingSelectionResult = metadata.thinkingSelectionResult === undefined
    ? state.thinkingSelectionResult
    : cloneRuntimeThinkingSelectionResult(metadata.thinkingSelectionResult)
  const reasoningSuppressionBasis = metadata.reasoningSuppressionBasis === undefined
    ? state.reasoningSuppressionBasis
    : cloneRuntimeReasoningSuppressionBasis(metadata.reasoningSuppressionBasis)
  const reasoningSuppressed = shouldSuppressReasoning({
    previousSuppressed: state.reasoningSuppressed,
    appliedThinkingSelection,
    appliedThinkingLevel,
    reasoningSuppressionBasis,
  })
  const reasoningTraceState = resolveReasoningTraceStateAfterMetadata({
    previousTraceState: state.reasoningTraceState,
    reasoningSuppressed,
    segments: state.segments,
  })

  return {
    ...state,
    requestedThinkingSelection,
    appliedThinkingSelection,
    requestedThinkingLevel,
    appliedThinkingLevel,
    thinkingCapabilitySnapshot,
    thinkingSelectionResult,
    reasoningSuppressionBasis,
    reasoningSuppressed,
    reasoningTraceState,
    segments: reasoningSuppressed ? stripReasoningSegments(state.segments) : state.segments,
  }
}

function applyRunMetadataToState(
  state: CopilotRunState,
  event: RuntimeRunMetadataEvent,
): CopilotRunState {
  return applyRunThinkingMetadataToState(
    {
      ...state,
      runId: event.runId,
      threadId: event.sessionId,
    },
    event.payload,
  )
}

export function applyRuntimeRunEventToCopilotRunState(
  state: CopilotRunState,
  event: RuntimeRunEvent,
): CopilotRunState {
  switch (event.type) {
    case 'run_started':
      return applyRunThinkingMetadataToState(
        {
          ...state,
          phase: 'streaming',
          runId: event.runId,
          threadId: event.sessionId,
        },
        event.payload,
      )
    case 'run_metadata':
      return applyRunMetadataToState(state, event)
    case 'text_delta': {
      const observedAt = Date.now()
      const segmentsWithCompletedReasoning = completeStreamingReasoningSegments(
        state.segments,
        event.sequence,
        observedAt,
      )
      return {
        ...state,
        phase: 'streaming',
        runId: event.runId,
        threadId: event.sessionId,
        segments: appendAssistantDeltaSegment(segmentsWithCompletedReasoning, event),
      }
    }
    case 'reasoning_delta': {
      if (shouldSuppressReasoning({
        previousSuppressed: state.reasoningSuppressed,
        appliedThinkingSelection: state.appliedThinkingSelection,
        appliedThinkingLevel: state.appliedThinkingLevel,
        reasoningSuppressionBasis: state.reasoningSuppressionBasis,
      })) {
        return {
          ...state,
          phase: 'streaming',
          runId: event.runId,
          threadId: event.sessionId,
          reasoningSuppressed: true,
          reasoningTraceState: 'suppressed',
          segments: stripReasoningSegments(state.segments),
        }
      }

      const observedAt = Date.now()
      return {
        ...state,
        phase: 'streaming',
        runId: event.runId,
        threadId: event.sessionId,
        reasoningSuppressed: false,
        reasoningTraceState: 'visible',
        segments: appendReasoningDeltaSegment(state.segments, event, observedAt),
      }
    }
    case 'tool_event': {
      const observedAt = Date.now()
      const segmentsWithCompletedReasoning = completeStreamingReasoningSegments(
        state.segments,
        event.sequence,
        observedAt,
      )
      return {
        ...state,
        phase: 'streaming',
        runId: event.runId,
        threadId: event.sessionId,
        segments: upsertToolSegment(segmentsWithCompletedReasoning, event),
      }
    }
    case 'run_diagnostic': {
      const diagnostic = buildDiagnosticSummary(event.payload)
      const observedAt = Date.now()
      const segmentsWithCompletedReasoning = completeStreamingReasoningSegments(
        state.segments,
        event.sequence,
        observedAt,
      )
      return {
        ...state,
        runId: event.runId,
        threadId: event.sessionId,
        diagnostic,
        segments: appendDiagnosticSegment(segmentsWithCompletedReasoning, event.runId, event.sequence, diagnostic),
      }
    }
    case 'run_completed':
      return applyRunCompletedToState(state, event)
    case 'run_failed':
      return applyRunFailedToState(state, event)
    case 'run_cancelled':
      return applyRunCancelledToState(state, {
        runId: event.runId,
        threadId: event.sessionId,
        sequence: event.sequence,
        assistantMessageId: event.payload.assistantMessageId,
        reason: event.payload.reason,
      })
  }
}

export function markCopilotRunCancelled(
  state: CopilotRunState,
  input: {
    reason: string
  },
): CopilotRunState {
  const runId = state.runId ?? 'local-cancelled-run'
  const threadId = state.threadId ?? ''

  return applyRunCancelledToState(state, {
    runId,
    threadId,
    sequence: resolveNextSyntheticSequence(state.segments),
    assistantMessageId: null,
    reason: input.reason,
  })
}

export function markCopilotRunTransportFailed(
  state: CopilotRunState,
  input: {
    code: string
    message: string
    details?: Record<string, unknown>
  },
): CopilotRunState {
  const runId = state.runId ?? 'local-failed-run'
  const threadId = state.threadId ?? ''
  const failure: CopilotRunFailureSummary = {
    code: input.code,
    message: input.message,
    details: { ...(input.details ?? {}) },
  }

  const observedAt = Date.now()

  return {
    ...state,
    phase: 'failed',
    runId,
    threadId,
    failure,
    cancelReason: null,
    segments: appendTerminalSegment(
      failStreamingSegments(state.segments, observedAt),
      buildFailedTerminalSegment({
        runId,
        sequence: resolveNextSyntheticSequence(state.segments),
        failure,
      }),
    ),
  }
}

function applyRunCompletedToState(
  state: CopilotRunState,
  event: RuntimeRunCompletedEvent,
): CopilotRunState {
  const observedAt = Date.now()

  return {
    ...state,
    phase: 'completed',
    runId: event.runId,
    threadId: event.sessionId,
    resolvedModelId: event.payload.resolvedModelId,
    resolvedModelRoute: cloneRuntimeModelRoute(event.payload.resolvedModelRoute),
    resolvedToolIds: [...event.payload.resolvedToolIds],
    requestOptions: { ...event.payload.requestOptions },
    failure: null,
    cancelReason: null,
    segments: appendTerminalSegment(
      completeAssistantSegments(state.segments, event, observedAt),
      buildCompletedTerminalSegment({
        runId: event.runId,
        sequence: event.sequence,
        assistantMessageId: event.payload.assistantMessageId,
        resolvedModelId: event.payload.resolvedModelId,
        resolvedModelRoute: event.payload.resolvedModelRoute,
        resolvedToolIds: event.payload.resolvedToolIds,
        requestOptions: event.payload.requestOptions,
      }),
    ),
  }
}

function applyRunFailedToState(
  state: CopilotRunState,
  event: RuntimeRunFailedEvent,
): CopilotRunState {
  const failure = buildFailureSummary(event.payload)
  const observedAt = Date.now()

  return {
    ...state,
    phase: 'failed',
    runId: event.runId,
    threadId: event.sessionId,
    failure,
    cancelReason: null,
    segments: appendTerminalSegment(
      failStreamingSegments(state.segments, observedAt),
      buildFailedTerminalSegment({
        runId: event.runId,
        sequence: event.sequence,
        failure,
      }),
    ),
  }
}

function applyRunCancelledToState(
  state: CopilotRunState,
  input: {
    runId: string
    threadId: string
    sequence: number
    assistantMessageId: string | null
    reason: string
  },
): CopilotRunState {
  const observedAt = Date.now()

  return {
    ...state,
    phase: 'cancelled',
    runId: input.runId,
    threadId: input.threadId,
    failure: null,
    cancelReason: input.reason,
    segments: appendTerminalSegment(
      cancelStreamingSegments(state.segments, observedAt),
      buildCancelledTerminalSegment(input),
    ),
  }
}

function appendAssistantDeltaSegment(
  segments: CopilotRunSegment[],
  event: Extract<RuntimeRunEvent, { type: 'text_delta' }>,
): CopilotRunSegment[] {
  const lastSegment = segments[segments.length - 1]
  if (
    lastSegment?.kind === 'assistant'
    && (lastSegment.status === 'pending' || lastSegment.status === 'streaming')
  ) {
    return segments.map((segment, index) => {
      if (index !== segments.length - 1 || segment.kind !== 'assistant') {
        return segment
      }

      return {
        ...segment,
        text: `${segment.text}${event.payload.delta}`,
        firstContentSequence: segment.firstContentSequence ?? event.sequence,
        lastSequence: event.sequence,
        status: 'streaming',
      } satisfies CopilotAssistantSegment
    })
  }

  return [
    ...segments,
    {
      id: `assistant:${event.runId}:${countAssistantSegments(segments) + 1}`,
      kind: 'assistant',
      runId: event.runId,
      assistantMessageId: event.payload.assistantMessageId,
      text: event.payload.delta,
      firstContentSequence: event.sequence,
      startedSequence: event.sequence,
      lastSequence: event.sequence,
      status: 'streaming',
      resolvedModelId: null,
      resolvedModelRoute: null,
      resolvedToolIds: [],
      requestOptions: {},
    } satisfies CopilotAssistantSegment,
  ]
}

function appendReasoningDeltaSegment(
  segments: CopilotRunSegment[],
  event: Extract<RuntimeRunEvent, { type: 'reasoning_delta' }>,
  observedAt: number,
): CopilotRunSegment[] {
  const lastSegment = segments[segments.length - 1]
  if (
    lastSegment?.kind === 'reasoning'
    && (lastSegment.status === 'pending' || lastSegment.status === 'streaming')
  ) {
    return segments.map((segment, index) => {
      if (index !== segments.length - 1 || segment.kind !== 'reasoning') {
        return segment
      }

      return {
        ...segment,
        text: `${segment.text}${event.payload.delta}`,
        lastSequence: event.sequence,
        status: 'streaming',
      }
    })
  }

  return [
    ...segments,
    {
      id: `reasoning:${event.runId}:${countReasoningSegments(segments) + 1}`,
      kind: 'reasoning',
      runId: event.runId,
      text: event.payload.delta,
      observedStartedAt: observedAt,
      observedFinishedAt: null,
      isCollapsedByDefault: true,
      startedSequence: event.sequence,
      lastSequence: event.sequence,
      status: 'streaming',
    } satisfies CopilotReasoningSegment,
  ]
}

function upsertToolSegment(
  segments: CopilotRunSegment[],
  event: RuntimeToolEvent,
): CopilotRunSegment[] {
  const segmentId = `tool:${event.runId}:${event.payload.toolCallId}`
  const existingIndex = segments.findIndex((segment) => segment.id === segmentId)
  const existingSegment = existingIndex >= 0 ? segments[existingIndex] : null
  const nextSegment: CopilotToolSegment = {
    id: segmentId,
    kind: 'tool',
    runId: event.runId,
    startedSequence: existingSegment?.startedSequence ?? event.sequence,
    lastSequence: event.sequence,
    status: mapToolPhaseToSegmentStatus(event.payload.phase),
    toolCallId: event.payload.toolCallId,
    toolId: event.payload.toolId,
    toolPhase: event.payload.phase,
    title: event.payload.title,
    summary: event.payload.summary,
    inputSummary: event.payload.inputSummary ?? null,
    resultSummary: event.payload.resultSummary ?? null,
    errorSummary: event.payload.errorSummary ?? null,
  }

  if (existingIndex >= 0) {
    return segments.map((segment, index) => (index === existingIndex ? nextSegment : segment))
  }

  return [...segments, nextSegment]
}

function appendDiagnosticSegment(
  segments: CopilotRunSegment[],
  runId: string,
  sequence: number,
  diagnostic: CopilotRunDiagnosticSummary,
): CopilotRunSegment[] {
  return [
    ...segments,
    {
      id: `diagnostic:${runId}:${sequence}`,
      kind: 'diagnostic',
      runId,
      startedSequence: sequence,
      lastSequence: sequence,
      status: 'completed',
      diagnostic,
    } satisfies CopilotDiagnosticSegment,
  ]
}

function completeAssistantSegments(
  segments: CopilotRunSegment[],
  event: RuntimeRunCompletedEvent,
  observedAt: number,
): CopilotRunSegment[] {
  const lastAssistantSegmentId = resolveLastAssistantSegmentId(segments)
  const segmentsWithCompletedReasoning = completeStreamingReasoningSegments(segments, event.sequence, observedAt)
  if (lastAssistantSegmentId === null) {
    return [
      ...segmentsWithCompletedReasoning,
      {
        id: `assistant:${event.runId}:1`,
        kind: 'assistant',
        runId: event.runId,
        assistantMessageId: event.payload.assistantMessageId,
        text: event.payload.assistantText,
        firstContentSequence: event.sequence,
        startedSequence: event.sequence,
        lastSequence: event.sequence,
        status: 'completed',
        resolvedModelId: event.payload.resolvedModelId,
        resolvedModelRoute: cloneRuntimeModelRoute(event.payload.resolvedModelRoute),
        resolvedToolIds: [...event.payload.resolvedToolIds],
        requestOptions: { ...event.payload.requestOptions },
      } satisfies CopilotAssistantSegment,
    ]
  }

  return segmentsWithCompletedReasoning.map((segment): CopilotRunSegment => {
    if (segment.kind === 'reasoning') {
      return segment
    }

    if (segment.kind !== 'assistant') {
      return segment
    }

    const isLastAssistantSegment = segment.id === lastAssistantSegmentId
    return {
      ...segment,
      status: 'completed',
      lastSequence: isLastAssistantSegment ? event.sequence : segment.lastSequence,
      text: isLastAssistantSegment && segment.text === '' ? event.payload.assistantText : segment.text,
      resolvedModelId: isLastAssistantSegment ? event.payload.resolvedModelId : segment.resolvedModelId,
      resolvedModelRoute: isLastAssistantSegment
        ? cloneRuntimeModelRoute(event.payload.resolvedModelRoute)
        : segment.resolvedModelRoute,
      resolvedToolIds: isLastAssistantSegment ? [...event.payload.resolvedToolIds] : [...segment.resolvedToolIds],
      requestOptions: isLastAssistantSegment ? { ...event.payload.requestOptions } : { ...segment.requestOptions },
    } satisfies CopilotAssistantSegment
  })
}

function completeStreamingReasoningSegments(
  segments: CopilotRunSegment[],
  sequence: number,
  observedAt: number,
): CopilotRunSegment[] {
  return segments.map((segment): CopilotRunSegment => {
    if (segment.kind !== 'reasoning' || (segment.status !== 'pending' && segment.status !== 'streaming')) {
      return segment
    }

    return {
      ...segment,
      status: 'completed',
      lastSequence: sequence,
      observedFinishedAt: segment.observedFinishedAt ?? observedAt,
    }
  })
}

function cancelStreamingSegments(segments: CopilotRunSegment[], observedAt: number): CopilotRunSegment[] {
  return segments.map((segment): CopilotRunSegment => {
    if (segment.kind === 'tool' && (segment.status === 'pending' || segment.status === 'streaming')) {
      return {
        ...segment,
        status: 'cancelled',
        toolPhase: 'cancelled',
      } satisfies CopilotToolSegment
    }

    if (segment.kind === 'assistant' && (segment.status === 'pending' || segment.status === 'streaming')) {
      return {
        ...segment,
        status: 'cancelled',
      } satisfies CopilotAssistantSegment
    }

    if (segment.kind === 'reasoning' && (segment.status === 'pending' || segment.status === 'streaming')) {
      return {
        ...segment,
        status: 'cancelled',
        observedFinishedAt: segment.observedFinishedAt ?? observedAt,
      } satisfies CopilotReasoningSegment
    }

    return segment
  })
}

function failStreamingSegments(segments: CopilotRunSegment[], observedAt: number): CopilotRunSegment[] {
  return segments.map((segment): CopilotRunSegment => {
    if (segment.kind === 'tool' && (segment.status === 'pending' || segment.status === 'streaming')) {
      return {
        ...segment,
        status: 'failed',
        toolPhase: segment.toolPhase === 'started' ? 'failed' : segment.toolPhase,
      } satisfies CopilotToolSegment
    }

    if (segment.kind === 'assistant' && (segment.status === 'pending' || segment.status === 'streaming')) {
      return {
        ...segment,
        status: 'failed',
      } satisfies CopilotAssistantSegment
    }

    if (segment.kind === 'reasoning' && (segment.status === 'pending' || segment.status === 'streaming')) {
      return {
        ...segment,
        status: 'failed',
        observedFinishedAt: segment.observedFinishedAt ?? observedAt,
      } satisfies CopilotReasoningSegment
    }

    return segment
  })
}

function appendTerminalSegment(
  segments: CopilotRunSegment[],
  terminalSegment: CopilotTerminalSegment,
): CopilotRunSegment[] {
  return [
    ...segments.filter((segment) => segment.kind !== 'terminal'),
    terminalSegment,
  ]
}

function stripReasoningSegments(segments: CopilotRunSegment[]): CopilotRunSegment[] {
  return segments.filter((segment) => segment.kind !== 'reasoning')
}

function buildCompletedTerminalSegment(input: {
  runId: string
  sequence: number
  assistantMessageId: string
  resolvedModelId: string
  resolvedModelRoute: RuntimeModelRoute
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
}): CopilotTerminalSegment {
  return {
    id: `terminal:${input.runId}:completed`,
    kind: 'terminal',
    runId: input.runId,
    startedSequence: input.sequence,
    lastSequence: input.sequence,
    status: 'completed',
    terminalPhase: 'completed',
    assistantMessageId: input.assistantMessageId,
    cancelReason: null,
    failure: null,
    resolvedModelId: input.resolvedModelId,
    resolvedModelRoute: cloneRuntimeModelRoute(input.resolvedModelRoute),
    resolvedToolIds: [...input.resolvedToolIds],
    requestOptions: { ...input.requestOptions },
  }
}

function buildFailedTerminalSegment(input: {
  runId: string
  sequence: number
  failure: CopilotRunFailureSummary
}): CopilotTerminalSegment {
  return {
    id: `terminal:${input.runId}:failed`,
    kind: 'terminal',
    runId: input.runId,
    startedSequence: input.sequence,
    lastSequence: input.sequence,
    status: 'failed',
    terminalPhase: 'failed',
    assistantMessageId: null,
    cancelReason: null,
    failure: {
      code: input.failure.code,
      message: input.failure.message,
      details: { ...input.failure.details },
    },
    resolvedModelId: null,
    resolvedModelRoute: null,
    resolvedToolIds: [],
    requestOptions: {},
  }
}

function buildCancelledTerminalSegment(input: {
  runId: string
  sequence: number
  assistantMessageId: string | null
  reason: string
}): CopilotTerminalSegment {
  return {
    id: `terminal:${input.runId}:cancelled`,
    kind: 'terminal',
    runId: input.runId,
    startedSequence: input.sequence,
    lastSequence: input.sequence,
    status: 'cancelled',
    terminalPhase: 'cancelled',
    assistantMessageId: input.assistantMessageId,
    cancelReason: input.reason,
    failure: null,
    resolvedModelId: null,
    resolvedModelRoute: null,
    resolvedToolIds: [],
    requestOptions: {},
  }
}

function buildDiagnosticSummary(input: {
  code: string
  message: string
  stage: string
  details: Record<string, unknown>
}): CopilotRunDiagnosticSummary {
  return {
    code: input.code,
    message: input.message,
    stage: input.stage,
    details: { ...input.details },
  }
}

function buildFailureSummary(input: {
  code: string
  message: string
  details: Record<string, unknown>
}): CopilotRunFailureSummary {
  return {
    code: input.code,
    message: input.message,
    details: { ...input.details },
  }
}

function resolveLastAssistantSegmentId(segments: CopilotRunSegment[]): string | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (segment?.kind === 'assistant') {
      return segment.id
    }
  }

  return null
}

function countAssistantSegments(segments: CopilotRunSegment[]): number {
  return segments.filter((segment) => segment.kind === 'assistant').length
}

function countReasoningSegments(segments: CopilotRunSegment[]): number {
  return segments.filter((segment) => segment.kind === 'reasoning').length
}

function resolveNextSyntheticSequence(segments: CopilotRunSegment[]): number {
  const lastSequence = segments.reduce((currentMax, segment) => (
    segment.lastSequence > currentMax ? segment.lastSequence : currentMax
  ), 0)
  return lastSequence + 1
}

function mapToolPhaseToSegmentStatus(
  phase: RuntimeToolEvent['payload']['phase'],
): CopilotToolSegment['status'] {
  switch (phase) {
    case 'started':
      return 'streaming'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
  }
}

function cloneRuntimeThinkingSelection(
  selection: CopilotRunState['requestedThinkingSelection'],
): CopilotRunState['requestedThinkingSelection'] {
  return cloneRuntimeThinkingSelectionValue(selection)
}

function cloneRuntimeThinkingCapability(
  capability: RuntimeThinkingCapability | null,
): RuntimeThinkingCapability | null {
  return cloneRuntimeThinkingCapabilityValue(capability)
}

function cloneRuntimeThinkingSelectionResult(
  result: CopilotRunState['thinkingSelectionResult'],
): CopilotRunState['thinkingSelectionResult'] {
  return cloneRuntimeThinkingSelectionResultValue(result)
}

function cloneRuntimeReasoningSuppressionBasis(
  basis: CopilotRunState['reasoningSuppressionBasis'],
): CopilotRunState['reasoningSuppressionBasis'] {
  return cloneRuntimeReasoningSuppressionBasisValue(basis)
}

function shouldSuppressReasoning(input: {
  previousSuppressed: boolean
  appliedThinkingSelection: CopilotRunState['appliedThinkingSelection']
  appliedThinkingLevel: CopilotRunState['appliedThinkingLevel']
  reasoningSuppressionBasis: CopilotRunState['reasoningSuppressionBasis']
}): boolean {
  const appliedThinkingDisabled = input.appliedThinkingSelection?.level === 'off'
    || (input.appliedThinkingSelection === null && input.appliedThinkingLevel === 'off')

  return input.previousSuppressed
    || input.reasoningSuppressionBasis?.shouldSuppress === true
    || appliedThinkingDisabled
}

function resolveReasoningTraceStateAfterMetadata(input: {
  previousTraceState: CopilotRunState['reasoningTraceState']
  reasoningSuppressed: boolean
  segments: CopilotRunSegment[]
}): CopilotRunState['reasoningTraceState'] {
  if (input.previousTraceState === 'suppressed') {
    return 'suppressed'
  }

  const hasVisibleReasoning = hasReasoningSegments(input.segments)
    || input.previousTraceState === 'visible'

  if (input.reasoningSuppressed) {
    return hasVisibleReasoning ? 'suppressed' : 'not_observed'
  }

  return hasVisibleReasoning ? 'visible' : 'not_observed'
}

function hasReasoningSegments(segments: CopilotRunSegment[]): boolean {
  return segments.some((segment) => segment.kind === 'reasoning')
}

function cloneRuntimeModelRoute(route: RuntimeModelRoute): RuntimeModelRoute {
  return {
    providerProfileId: route.providerProfileId,
    snapshot: {
      provider: route.snapshot.provider,
      endpointType: route.snapshot.endpointType,
      baseUrl: route.snapshot.baseUrl,
      modelId: route.snapshot.modelId,
    },
  }
}
