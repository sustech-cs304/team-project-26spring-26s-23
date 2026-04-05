import type { RuntimeModelRoute } from './thread-run-contract'
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
  resolvedModelRoute: RuntimeModelRoute | null
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
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
  runState: Pick<CopilotRunState, 'phase' | 'segments'>,
): CopilotAssistantPlaceholderState {
  if (runState.segments.some(isRenderableAssistantSegment)) {
    return {
      shouldRender: false,
      dismissReason: 'assistant',
    }
  }

  if (runState.segments.some((segment) => segment.kind === 'reasoning')) {
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

export function buildCopilotRunSegmentViewModel(
  runState: Pick<CopilotRunState, 'segments' | 'activeModelRoute' | 'resolvedModelId' | 'resolvedModelRoute'>,
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
  runState: Pick<CopilotRunState, 'activeModelRoute' | 'resolvedModelId' | 'resolvedModelRoute'>,
): CopilotRunSegmentViewItem[] {
  switch (segment.kind) {
    case 'assistant':
      return projectAssistantSegment(segment, runState)
    case 'reasoning':
      return [projectReasoningSegment(segment)]
    case 'tool':
      return [projectToolSegment(segment)]
    case 'diagnostic':
      return [projectDiagnosticSegment(segment)]
    case 'terminal': {
      const terminalItem = projectTerminalSegment(segment)
      return terminalItem === null ? [] : [terminalItem]
    }
  }
}

function projectAssistantSegment(
  segment: Extract<CopilotRunSegment, { kind: 'assistant' }>,
  runState: Pick<CopilotRunState, 'activeModelRoute' | 'resolvedModelId' | 'resolvedModelRoute'>,
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
    title: resolvedModelId ?? resolvedModelRoute?.snapshot.modelId ?? '助手响应',
    content: segment.text,
    status: mapSegmentStatus(segment.status),
    resolvedModelId,
    resolvedModelRoute,
    resolvedToolIds: [...segment.resolvedToolIds],
    requestOptions: { ...segment.requestOptions },
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
): CopilotTerminalMessageItem | null {
  switch (segment.terminalPhase) {
    case 'completed':
      return null
    case 'cancelled':
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
      }
    case 'failed':
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
        failure: segment.failure === null
          ? null
          : {
              code: segment.failure.code,
              message: segment.failure.message,
              details: { ...segment.failure.details },
            },
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
    segment.resolvedModelRoute?.snapshot.modelId ?? null,
    runState.resolvedModelRoute?.snapshot.modelId ?? null,
    runState.activeModelRoute?.snapshot.modelId ?? null,
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
): RuntimeModelRoute | null {
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

function cloneRuntimeModelRoute(route: RuntimeModelRoute | null): RuntimeModelRoute | null {
  if (route === null) {
    return null
  }

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

function isRenderableAssistantSegment(segment: CopilotRunSegment): boolean {
  return segment.kind === 'assistant' && segment.text !== ''
}

function formatFailureMessage(failure: CopilotRunFailureSummary | null): string {
  if (failure === null) {
    return 'run_failed: Runtime run failed.'
  }

  return `${failure.code}: ${failure.message}`
}

function formatCancelledReason(reason: string): string {
  const trimmedReason = reason.trim()
  return trimmedReason === '' ? '本次响应已取消。' : `本次响应已取消：${trimmedReason}`
}

function formatCopilotReasoningElapsedSeconds(elapsedMs: number): string {
  return (Math.floor(Math.max(0, elapsedMs) / 100) / 10).toFixed(1)
}
