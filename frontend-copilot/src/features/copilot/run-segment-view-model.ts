import {
  cloneRuntimeReasoningSuppressionBasis as cloneRuntimeReasoningSuppressionBasisValue,
  cloneRuntimeThinkingCapability as cloneRuntimeThinkingCapabilityValue,
  cloneRuntimeThinkingSelection as cloneRuntimeThinkingSelectionValue,
  type RuntimeModelRoute,
  type RuntimeResolvedModelRoute,
} from './thread-run-contract'
import {
  createCopilotErrorDetailSource,
  type CopilotErrorDetailSource,
} from './error-detail-overlay-view-model'
import type {
  CopilotRunDiagnosticSummary,
  CopilotRunFailureSummary,
  CopilotRunSegment,
  CopilotToolSegmentPhase,
} from './run-segment-types'
import type { CopilotRunState } from './types'

export interface CopilotUserMessageItem {
  id: string
  kind: 'user'
  title: string
  content: string
  status: 'completed'
}

interface CopilotRunSegmentViewItemBase {
  id: string
  runId: string
  sequence: number
  status: 'streaming' | 'completed' | 'failed' | 'cancelled'
}

export interface CopilotAssistantMessageItem extends CopilotRunSegmentViewItemBase {
  kind: 'assistant'
  title: string
  content: string
  resolvedModelId: string | null
  resolvedModelRoute: RuntimeResolvedModelRoute | RuntimeModelRoute | null
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
  requestedThinkingSelection?: CopilotRunState['requestedThinkingSelection']
  appliedThinkingSelection?: CopilotRunState['appliedThinkingSelection']
  requestedThinkingLevel?: CopilotRunState['requestedThinkingLevel']
  appliedThinkingLevel?: CopilotRunState['appliedThinkingLevel']
  thinkingCapabilitySnapshot?: CopilotRunState['thinkingCapabilitySnapshot']
  reasoningTraceState?: CopilotRunState['reasoningTraceState']
  reasoningSuppressionBasis?: CopilotRunState['reasoningSuppressionBasis']
  availabilityInterpretation?: Record<string, unknown> | null
  availabilityDrift?: Record<string, unknown> | null
  historicalSnapshot?: Record<string, unknown> | null
}

export interface CopilotReasoningMessageItem extends CopilotRunSegmentViewItemBase {
  kind: 'reasoning'
  title: string
  content: string
  observedStartedAt: number
  observedFinishedAt: number | null
  isCollapsedByDefault: true
}

export interface CopilotToolMessageItem extends CopilotRunSegmentViewItemBase {
  kind: 'tool'
  title: string
  content: string
  toolCallId: string
  toolId: string
  toolPhase: CopilotToolSegmentPhase
  inputSummary: string | null
  resultSummary: string | null
  errorSummary: string | null
  approval: Extract<CopilotRunSegment, { kind: 'tool' }>['approval']
}

export interface CopilotDiagnosticMessageItem extends CopilotRunSegmentViewItemBase {
  kind: 'diagnostic'
  title: string
  content: string
  diagnostic: CopilotRunDiagnosticSummary
}

export interface CopilotTerminalMessageItem extends CopilotRunSegmentViewItemBase {
  kind: 'terminal'
  title: string
  content: string
  terminalPhase: 'failed' | 'cancelled'
  cancelReason: string | null
  failure: CopilotRunFailureSummary | null
  resolvedModelId: string | null
  resolvedModelRoute: RuntimeResolvedModelRoute | RuntimeModelRoute | null
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
  errorDetail?: CopilotErrorDetailSource | null
  requestedThinkingSelection?: CopilotRunState['requestedThinkingSelection']
  appliedThinkingSelection?: CopilotRunState['appliedThinkingSelection']
  requestedThinkingLevel?: CopilotRunState['requestedThinkingLevel']
  appliedThinkingLevel?: CopilotRunState['appliedThinkingLevel']
  thinkingCapabilitySnapshot?: CopilotRunState['thinkingCapabilitySnapshot']
  reasoningTraceState?: CopilotRunState['reasoningTraceState']
  reasoningSuppressionBasis?: CopilotRunState['reasoningSuppressionBasis']
  availabilityInterpretation?: Record<string, unknown> | null
  availabilityDrift?: Record<string, unknown> | null
  historicalSnapshot?: Record<string, unknown> | null
}

export type CopilotRunSegmentViewItem =
  | CopilotAssistantMessageItem
  | CopilotReasoningMessageItem
  | CopilotToolMessageItem
  | CopilotDiagnosticMessageItem
  | CopilotTerminalMessageItem

export type CopilotMessageListItem = CopilotUserMessageItem | CopilotRunSegmentViewItem

export function createUserMessageListItem(content: string): CopilotUserMessageItem {
  return {
    id: `user:${content}:${Math.random().toString(36).slice(2)}`,
    kind: 'user',
    title: '',
    content,
    status: 'completed',
  }
}

export interface CopilotAssistantPlaceholderState {
  shouldRender: boolean
  dismissReason: 'assistant' | 'reasoning' | 'tool' | 'terminal' | 'inactive' | null
}

export function buildCopilotMessageListItems(input: {
  history: CopilotMessageListItem[]
  runState: CopilotRunState
}): CopilotMessageListItem[] {
  return [...input.history, ...buildCopilotRunSegmentViewModel(input.runState)]
}

export function resolveCopilotAssistantPlaceholderState(
  runState: Pick<
    CopilotRunState,
    'phase' | 'segments' | 'reasoningSuppressed' | 'reasoningTraceState' | 'reasoningSuppressionBasis'
  >,
): CopilotAssistantPlaceholderState {
  if (runState.segments.some(isRenderableAssistantSegment)) {
    return {
      shouldRender: false,
      dismissReason: 'assistant',
    }
  }

  if (
    !isReasoningSuppressedForRun(runState)
    && runState.segments.some((segment) => segment.kind === 'reasoning')
  ) {
    return {
      shouldRender: false,
      dismissReason: 'reasoning',
    }
  }

  if (runState.segments.some((segment) => segment.kind === 'tool')) {
    return {
      shouldRender: false,
      dismissReason: 'tool',
    }
  }

  if (runState.segments.some((segment) => segment.kind === 'terminal')) {
    return {
      shouldRender: false,
      dismissReason: 'terminal',
    }
  }

  if (runState.phase === 'starting' || runState.phase === 'streaming') {
    return {
      shouldRender: true,
      dismissReason: null,
    }
  }

  return {
    shouldRender: false,
    dismissReason: 'inactive',
  }
}

type CopilotRunThinkingProjectionState = Partial<Pick<
  CopilotRunState,
  | 'requestedThinkingSelection'
  | 'appliedThinkingSelection'
  | 'requestedThinkingLevel'
  | 'appliedThinkingLevel'
  | 'thinkingCapabilitySnapshot'
  | 'reasoningTraceState'
  | 'reasoningSuppressionBasis'
  | 'reasoningSuppressed'
>>

type CopilotRunResolvedRouteProjectionState = Pick<
  CopilotRunState,
  | 'activeModelRoute'
  | 'resolvedModelId'
  | 'resolvedModelRoute'
  | 'resolvedToolIds'
  | 'requestOptions'
>

type CopilotRunSegmentProjectionState = Pick<
  CopilotRunState,
  | 'segments'
> & CopilotRunResolvedRouteProjectionState & CopilotRunThinkingProjectionState

export function buildCopilotRunSegmentViewModel(
  runState: CopilotRunSegmentProjectionState,
): CopilotRunSegmentViewItem[] {
  return runState.segments.flatMap((segment) => projectSegmentToViewItems(segment, runState))
}

export function formatCopilotReasoningDurationLabel(
  reasoning: Pick<CopilotReasoningMessageItem, 'title' | 'observedStartedAt' | 'observedFinishedAt'>,
  observedNow: number,
): string {
  return `${reasoning.title} ${formatCopilotReasoningElapsedSeconds(resolveCopilotReasoningElapsedMs(reasoning, observedNow))}s`
}

export function resolveCopilotReasoningElapsedMs(
  reasoning: Pick<CopilotReasoningMessageItem, 'observedStartedAt' | 'observedFinishedAt'>,
  observedNow: number,
): number {
  const observedEndedAt = reasoning.observedFinishedAt ?? observedNow

  return Math.max(0, observedEndedAt - reasoning.observedStartedAt)
}

function projectSegmentToViewItems(
  segment: CopilotRunSegment,
  runState: CopilotRunSegmentProjectionState,
): CopilotRunSegmentViewItem[] {
  switch (segment.kind) {
    case 'assistant':
      return projectAssistantSegment(segment, runState)
    case 'reasoning':
      return shouldProjectReasoningSegment(runState) ? [projectReasoningSegment(segment)] : []
    case 'tool':
      return [projectToolSegment(segment)]
    case 'diagnostic':
      return [projectDiagnosticSegment(segment)]
    case 'terminal': {
      const terminalItem = projectTerminalSegment(segment, runState)
      return terminalItem === null ? [] : [terminalItem]
    }
  }
}

function projectAssistantSegment(
  segment: Extract<CopilotRunSegment, { kind: 'assistant' }>,
  runState: CopilotRunResolvedRouteProjectionState & CopilotRunThinkingProjectionState,
): CopilotRunSegmentViewItem[] {
  if (!isRenderableAssistantSegment(segment)) {
    return []
  }

  const resolvedModelId = resolveAssistantModelId(segment, runState)
  const resolvedModelRoute = resolveAssistantModelRoute(segment, runState)

  return [{
    id: segment.id,
    kind: 'assistant',
    runId: segment.runId,
    sequence: segment.startedSequence,
    title: resolvedModelId ?? readModelIdFromRoute(resolvedModelRoute) ?? '助手响应',
    content: segment.text,
    status: mapSegmentStatus(segment.status),
    resolvedModelId,
    resolvedModelRoute,
    resolvedToolIds: [...segment.resolvedToolIds],
    requestOptions: { ...segment.requestOptions },
    requestedThinkingSelection: cloneRuntimeThinkingSelection(runState.requestedThinkingSelection),
    appliedThinkingSelection: cloneRuntimeThinkingSelection(runState.appliedThinkingSelection),
    requestedThinkingLevel: runState.requestedThinkingLevel,
    appliedThinkingLevel: runState.appliedThinkingLevel,
    thinkingCapabilitySnapshot: cloneRuntimeThinkingCapability(runState.thinkingCapabilitySnapshot),
    reasoningTraceState: runState.reasoningTraceState,
    reasoningSuppressionBasis: cloneRuntimeReasoningSuppressionBasis(runState.reasoningSuppressionBasis),
  }]
}

function projectReasoningSegment(
  segment: Extract<CopilotRunSegment, { kind: 'reasoning' }>,
): CopilotReasoningMessageItem {
  return {
    id: segment.id,
    kind: 'reasoning',
    runId: segment.runId,
    sequence: segment.startedSequence,
    title: '思考',
    content: segment.text,
    observedStartedAt: segment.observedStartedAt,
    observedFinishedAt: segment.observedFinishedAt,
    status: mapSegmentStatus(segment.status),
    isCollapsedByDefault: true,
  }
}

function projectToolSegment(
  segment: Extract<CopilotRunSegment, { kind: 'tool' }>,
): CopilotToolMessageItem {
  return {
    id: segment.id,
    kind: 'tool',
    runId: segment.runId,
    sequence: segment.startedSequence,
    title: segment.title,
    content: segment.summary,
    status: mapSegmentStatus(segment.status),
    toolCallId: segment.toolCallId,
    toolId: segment.toolId,
    toolPhase: segment.toolPhase,
    inputSummary: segment.inputSummary,
    resultSummary: segment.resultSummary,
    errorSummary: segment.errorSummary,
    approval: segment.approval === null ? null : { ...segment.approval },
  }
}

function projectDiagnosticSegment(
  segment: Extract<CopilotRunSegment, { kind: 'diagnostic' }>,
): CopilotDiagnosticMessageItem {
  return {
    id: segment.id,
    kind: 'diagnostic',
    runId: segment.runId,
    sequence: segment.startedSequence,
    title: '运行诊断',
    content: segment.diagnostic.message,
    status: 'completed',
    diagnostic: {
      code: segment.diagnostic.code,
      message: segment.diagnostic.message,
      stage: segment.diagnostic.stage,
      details: { ...segment.diagnostic.details },
    },
  }
}

function projectTerminalSegment(
  segment: Extract<CopilotRunSegment, { kind: 'terminal' }>,
  runState: CopilotRunSegmentProjectionState,
): CopilotTerminalMessageItem | null {
  switch (segment.terminalPhase) {
    case 'completed':
      return null
    case 'cancelled': {
      const terminalContext = resolveTerminalContext(segment, runState)
      return {
        id: segment.id,
        kind: 'terminal',
        runId: segment.runId,
        sequence: segment.startedSequence,
        title: '已取消',
        content: formatCancelledReason(segment.cancelReason ?? ''),
        status: 'cancelled',
        terminalPhase: 'cancelled',
        cancelReason: segment.cancelReason,
        failure: null,
        resolvedModelId: terminalContext.resolvedModelId,
        resolvedModelRoute: terminalContext.resolvedModelRoute,
        resolvedToolIds: terminalContext.resolvedToolIds,
        requestOptions: terminalContext.requestOptions,
        errorDetail: null,
        requestedThinkingSelection: cloneRuntimeThinkingSelection(runState.requestedThinkingSelection),
        appliedThinkingSelection: cloneRuntimeThinkingSelection(runState.appliedThinkingSelection),
        requestedThinkingLevel: runState.requestedThinkingLevel,
        appliedThinkingLevel: runState.appliedThinkingLevel,
        thinkingCapabilitySnapshot: cloneRuntimeThinkingCapability(runState.thinkingCapabilitySnapshot),
        reasoningTraceState: runState.reasoningTraceState,
        reasoningSuppressionBasis: cloneRuntimeReasoningSuppressionBasis(runState.reasoningSuppressionBasis),
      }
    }
    case 'failed': {
      const terminalContext = resolveTerminalContext(segment, runState)
      const failure = segment.failure === null
        ? null
        : {
            code: segment.failure.code,
            message: segment.failure.message,
            details: { ...segment.failure.details },
          }
      return {
        id: segment.id,
        kind: 'terminal',
        runId: segment.runId,
        sequence: segment.startedSequence,
        title: '发送失败',
        content: formatFailureMessage(segment.failure),
        status: 'failed',
        terminalPhase: 'failed',
        cancelReason: null,
        failure,
        resolvedModelId: terminalContext.resolvedModelId,
        resolvedModelRoute: terminalContext.resolvedModelRoute,
        resolvedToolIds: terminalContext.resolvedToolIds,
        requestOptions: terminalContext.requestOptions,
        errorDetail: failure === null
          ? null
          : createCopilotErrorDetailSource({
              source: 'streaming',
              title: '发送失败',
              summaryMessage: formatFailureMessage(failure),
              rawMessage: failure.message,
              code: failure.code,
              stage: 'streaming',
              requestedMethod: 'run/stream',
              details: failure.details,
              resolvedModelId: terminalContext.resolvedModelId,
              resolvedModelRoute: terminalContext.resolvedModelRoute,
              resolvedToolIds: terminalContext.resolvedToolIds,
              requestOptions: terminalContext.requestOptions,
            }),
        requestedThinkingSelection: cloneRuntimeThinkingSelection(runState.requestedThinkingSelection),
        appliedThinkingSelection: cloneRuntimeThinkingSelection(runState.appliedThinkingSelection),
        requestedThinkingLevel: runState.requestedThinkingLevel,
        appliedThinkingLevel: runState.appliedThinkingLevel,
        thinkingCapabilitySnapshot: cloneRuntimeThinkingCapability(runState.thinkingCapabilitySnapshot),
        reasoningTraceState: runState.reasoningTraceState,
        reasoningSuppressionBasis: cloneRuntimeReasoningSuppressionBasis(runState.reasoningSuppressionBasis),
      }
    }
  }
}

function mapSegmentStatus(
  status: CopilotRunSegment['status'],
): CopilotRunSegmentViewItem['status'] {
  switch (status) {
    case 'pending':
    case 'streaming':
      return 'streaming'
    case 'completed':
    case 'failed':
    case 'cancelled':
      return status
  }
}

function resolveAssistantModelId(
  segment: Extract<CopilotRunSegment, { kind: 'assistant' }>,
  runState: Pick<CopilotRunState, 'activeModelRoute' | 'resolvedModelId' | 'resolvedModelRoute'>,
): string | null {
  const modelIdCandidates = [
    segment.resolvedModelId,
    runState.resolvedModelId,
    readModelIdFromRoute(segment.resolvedModelRoute),
    readModelIdFromRoute(runState.resolvedModelRoute),
    readModelIdFromRoute(runState.activeModelRoute),
  ]

  for (const candidate of modelIdCandidates) {
    const trimmedCandidate = candidate?.trim() ?? ''
    if (trimmedCandidate !== '') {
      return trimmedCandidate
    }
  }

  return null
}

function resolveAssistantModelRoute(
  segment: Extract<CopilotRunSegment, { kind: 'assistant' }>,
  runState: Pick<CopilotRunState, 'activeModelRoute' | 'resolvedModelId' | 'resolvedModelRoute'>,
): RuntimeResolvedModelRoute | RuntimeModelRoute | null {
  const routeCandidates = [
    segment.resolvedModelRoute,
    runState.resolvedModelRoute,
    runState.activeModelRoute,
  ]

  for (const route of routeCandidates) {
    const clonedRoute = cloneRuntimeModelRoute(route)
    if (clonedRoute !== null) {
      return clonedRoute
    }
  }

  return null
}

function cloneRuntimeModelRoute(
  route: RuntimeResolvedModelRoute | RuntimeModelRoute | null,
): RuntimeResolvedModelRoute | RuntimeModelRoute | null {
  if (route === null) {
    return null
  }

  if ('providerId' in route) {
    return {
      routeRef: {
        routeKind: route.routeRef.routeKind,
        profileId: route.routeRef.profileId,
        modelId: route.routeRef.modelId,
      },
      providerProfileId: route.providerProfileId,
      provider: route.provider,
      providerId: route.providerId,
      adapterId: route.adapterId,
      runtimeStatus: route.runtimeStatus,
      catalogRevision: route.catalogRevision,
      endpointFamily: route.endpointFamily,
      endpointType: route.endpointType,
      baseUrl: route.baseUrl,
      modelId: route.modelId,
      authKind: route.authKind,
    }
  }

  return {
    ...(route.routeRef === undefined || route.routeRef === null
      ? {}
      : {
          routeRef: {
            routeKind: route.routeRef.routeKind,
            profileId: route.routeRef.profileId,
            modelId: route.routeRef.modelId,
          },
        }),
    ...(route.catalogRevision === undefined ? {} : { catalogRevision: route.catalogRevision }),
  }
}

function readModelIdFromRoute(
  route: RuntimeResolvedModelRoute | RuntimeModelRoute | null | undefined,
): string | null {
  if (route === null || route === undefined) {
    return null
  }

  return 'providerId' in route ? route.modelId : route.routeRef?.modelId ?? null
}

function resolveTerminalContext(
  segment: Extract<CopilotRunSegment, { kind: 'terminal' }>,
  runState: CopilotRunSegmentProjectionState,
): Pick<CopilotTerminalMessageItem, 'resolvedModelId' | 'resolvedModelRoute' | 'resolvedToolIds' | 'requestOptions'> {
  const resolvedModelRoute = cloneRuntimeModelRoute(
    segment.resolvedModelRoute
    ?? runState.resolvedModelRoute
    ?? runState.activeModelRoute,
  )
  const resolvedModelId = [
    segment.resolvedModelId,
    runState.resolvedModelId,
    readModelIdFromRoute(segment.resolvedModelRoute),
    readModelIdFromRoute(runState.resolvedModelRoute),
    readModelIdFromRoute(runState.activeModelRoute),
  ].find((candidate) => (candidate?.trim() ?? '') !== '') ?? null
  const requestOptions = Object.keys(segment.requestOptions).length > 0
    ? { ...segment.requestOptions }
    : { ...runState.requestOptions }
  const resolvedToolIds = dedupeToolIds([
    ...segment.resolvedToolIds,
    ...runState.resolvedToolIds,
    ...runState.segments.flatMap((runSegment) => runSegment.kind === 'tool' ? [runSegment.toolId] : []),
  ])

  return {
    resolvedModelId,
    resolvedModelRoute,
    resolvedToolIds,
    requestOptions,
  }
}

function dedupeToolIds(toolIds: string[]): string[] {
  const seen = new Set<string>()
  const nextToolIds: string[] = []

  for (const toolId of toolIds) {
    const trimmedToolId = toolId.trim()
    if (trimmedToolId === '' || seen.has(trimmedToolId)) {
      continue
    }

    seen.add(trimmedToolId)
    nextToolIds.push(trimmedToolId)
  }

  return nextToolIds
}

function cloneRuntimeThinkingCapability(
  capability: CopilotRunState['thinkingCapabilitySnapshot'] | undefined,
): CopilotRunState['thinkingCapabilitySnapshot'] | undefined {
  return cloneRuntimeThinkingCapabilityValue(capability)
}

function cloneRuntimeThinkingSelection(
  selection: CopilotRunState['requestedThinkingSelection'] | undefined,
): CopilotRunState['requestedThinkingSelection'] | undefined {
  return cloneRuntimeThinkingSelectionValue(selection)
}

function cloneRuntimeReasoningSuppressionBasis(
  basis: CopilotRunState['reasoningSuppressionBasis'] | undefined,
): CopilotRunState['reasoningSuppressionBasis'] | undefined {
  return cloneRuntimeReasoningSuppressionBasisValue(basis)
}

function shouldProjectReasoningSegment(
  runState: Partial<Pick<
    CopilotRunState,
    'reasoningSuppressed' | 'reasoningTraceState' | 'reasoningSuppressionBasis'
  >>,
): boolean {
  return !isReasoningSuppressedForRun(runState)
}

function isReasoningSuppressedForRun(
  runState: Partial<Pick<
    CopilotRunState,
    'reasoningSuppressed' | 'reasoningTraceState' | 'reasoningSuppressionBasis'
  >>,
): boolean {
  return runState.reasoningSuppressed === true
    || runState.reasoningTraceState === 'suppressed'
    || runState.reasoningSuppressionBasis?.shouldSuppress === true
}

function isRenderableAssistantSegment(segment: CopilotRunSegment): boolean {
  return segment.kind === 'assistant' && segment.text !== ''
}

function formatFailureMessage(failure: CopilotRunFailureSummary | null): string {
  if (failure === null) {
    return '当前响应失败，请重试。'
  }

  switch (failure.code) {
    case 'tool_execution_failed':
      return '工具执行失败，请重试。'
    case 'authentication_required': {
      const explicitMessage = failure.message.trim()
      return explicitMessage === '' ? '认证失败，请检查 SUSTech CAS 凭证。' : explicitMessage
    }
    default:
      return '当前响应失败，请重试。'
  }
}

function formatCancelledReason(reason: string): string {
  const trimmedReason = reason.trim()
  return trimmedReason === '' ? '本次响应已取消。' : `本次响应已取消：${trimmedReason}`
}

function formatCopilotReasoningElapsedSeconds(elapsedMs: number): string {
  return (Math.floor(Math.max(0, elapsedMs) / 100) / 10).toFixed(1)
}
