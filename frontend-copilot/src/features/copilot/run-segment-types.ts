import type {
  RuntimeModelRoute,
  RuntimeResolvedModelRoute,
  RuntimeToolEventPhase,
} from './thread-run-contract'

export interface CopilotRunDiagnosticSummary {
  code: string
  message: string
  stage: string
  details: Record<string, unknown>
}

export interface CopilotRunFailureSummary {
  code: string
  message: string
  details: Record<string, unknown>
}

export type CopilotRunSegmentKind = 'assistant' | 'reasoning' | 'tool' | 'diagnostic' | 'terminal'
export type CopilotRunSegmentStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled'
export type CopilotToolSegmentPhase = RuntimeToolEventPhase | 'cancelled'

interface CopilotRunSegmentBase {
  id: string
  kind: CopilotRunSegmentKind
  runId: string
  startedSequence: number
  lastSequence: number
  status: CopilotRunSegmentStatus
}

export interface CopilotAssistantSegment extends CopilotRunSegmentBase {
  kind: 'assistant'
  assistantMessageId: string
  text: string
  firstContentSequence: number | null
  resolvedModelId: string | null
  resolvedModelRoute: RuntimeResolvedModelRoute | RuntimeModelRoute | null
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
}

export interface CopilotReasoningSegment extends CopilotRunSegmentBase {
  kind: 'reasoning'
  text: string
  observedStartedAt: number
  observedFinishedAt: number | null
  isCollapsedByDefault: true
}

export interface CopilotToolSegment extends CopilotRunSegmentBase {
  kind: 'tool'
  toolCallId: string
  toolId: string
  toolPhase: CopilotToolSegmentPhase
  title: string
  summary: string
  inputSummary: string | null
  resultSummary: string | null
  errorSummary: string | null
}

export interface CopilotDiagnosticSegment extends CopilotRunSegmentBase {
  kind: 'diagnostic'
  diagnostic: CopilotRunDiagnosticSummary
}

export interface CopilotTerminalSegment extends CopilotRunSegmentBase {
  kind: 'terminal'
  terminalPhase: Extract<CopilotRunSegmentStatus, 'completed' | 'failed' | 'cancelled'>
  assistantMessageId: string | null
  cancelReason: string | null
  failure: CopilotRunFailureSummary | null
  resolvedModelId: string | null
  resolvedModelRoute: RuntimeResolvedModelRoute | RuntimeModelRoute | null
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
}

export type CopilotRunSegment =
  | CopilotAssistantSegment
  | CopilotReasoningSegment
  | CopilotToolSegment
  | CopilotDiagnosticSegment
  | CopilotTerminalSegment
