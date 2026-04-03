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

export function buildCopilotMessageListItems(input: {
  history: CopilotMessageListItem[]
  runState: CopilotRunState
}): CopilotMessageListItem[] {
  return [...input.history, ...buildCopilotRunSegmentViewModel(input.runState)]
}

export function buildCopilotRunSegmentViewModel(
  runState: Pick<CopilotRunState, 'segments'>,
): CopilotRunSegmentViewItem[] {
  return runState.segments.flatMap((segment) => projectSegmentToViewItems(segment))
}

function projectSegmentToViewItems(segment: CopilotRunSegment): CopilotRunSegmentViewItem[] {
  switch (segment.kind) {
    case 'assistant':
      return projectAssistantSegment(segment)
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
): CopilotRunSegmentViewItem[] {
  if (segment.text === '') {
    return []
  }

  return [{
    id: segment.id,
    kind: 'assistant',
    runId: segment.runId,
    sequence: segment.startedSequence,
    title: '助手响应',
    content: segment.text,
    status: mapSegmentStatus(segment.status),
    resolvedModelId: segment.resolvedModelId,
    resolvedModelRoute: cloneRuntimeModelRoute(segment.resolvedModelRoute),
    resolvedToolIds: [...segment.resolvedToolIds],
    requestOptions: { ...segment.requestOptions },
  }]
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
