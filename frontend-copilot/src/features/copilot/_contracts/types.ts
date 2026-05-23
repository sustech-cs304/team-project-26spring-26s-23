/** Runtime contract type definitions extracted from thread-run-contract.ts. */

import type { ModelRouteRef } from '../../../workbench/types'

export interface RuntimeAgentDirectoryEntry {
  agentId: string
  status: string
  recommendedTools: string[]
  displayName: string | null
  description: string | null
  iconKey: string | null
}

export interface RuntimeAgentsListResponse {
  ok: true
  directoryVersion: string
  defaultAgentId: string
  agents: RuntimeAgentDirectoryEntry[]
}

export interface RuntimeBoundAgent {
  agentId: string
  status: string
  displayName: string | null
  description: string | null
  iconKey: string | null
}

export interface RuntimeThreadCreateResponse {
  ok: true
  threadId: string
  boundAgent: RuntimeBoundAgent
  createdAt: string
  updatedAt: string
  recommendedTools: string[]
  capabilities: Record<string, unknown>
}

export interface RuntimeToolPresentationGroup {
  id: string
  label: string
  labelZh: string
  labelEn: string
  order: number
  sourceKind: string
}

export interface RuntimeToolDirectoryEntry {
  toolId: string
  kind: string
  availability: string
  displayName: string | null
  description: string | null
  prompt?: string | null
  displayNameZh?: string | null
  displayNameEn?: string | null
  descriptionZh?: string | null
  descriptionEn?: string | null
  group?: RuntimeToolPresentationGroup | null
}

export interface RuntimeThreadGetResponse {
  ok: true
  threadId: string
  boundAgent: RuntimeBoundAgent
  createdAt: string
  updatedAt: string
  capabilitiesVersion: string
  tools: RuntimeToolDirectoryEntry[]
  recommendedTools: string[]
  toolSelectionMode: string
  latestRunId: string | null
}

export type RuntimeThinkingCapabilityStatus =
  | 'verified-supported'
  | 'verified-unsupported'
  | 'unknown-without-override'
  | 'unknown-with-override'

export type RuntimeThinkingCapabilitySource = 'verified' | 'override' | 'unknown'
export type RuntimeThinkingLevel = 'off' | 'auto' | 'low' | 'medium' | 'high' | 'xhigh'
export type RuntimeThinkingControlKind = 'fixed' | 'binary' | 'off-auto' | 'discrete' | 'budget'
export type RuntimeThinkingSelectionKind = 'preset' | 'budget'
export type RuntimeThinkingEditorType = 'discrete' | 'budget' | 'fixed'

export interface RuntimeThinkingCodeValue {
  valueType: 'code'
  code: string
  labelZh: string
}

export interface RuntimeThinkingBudgetValue {
  valueType: 'budget'
  mode: 'off' | 'dynamic' | 'budget'
  budgetTokens: number | null
  labelZh: string
}

export interface RuntimeThinkingFixedValue {
  valueType: 'fixed'
  code: 'fixed'
  labelZh: string
}

export type RuntimeThinkingValue =
  | RuntimeThinkingCodeValue
  | RuntimeThinkingBudgetValue
  | RuntimeThinkingFixedValue

export interface RuntimeCanonicalThinkingSelection {
  kind: RuntimeThinkingSelectionKind
  value?: RuntimeThinkingLevel
  budgetTokens?: number
}

export interface RuntimeThinkingControlBudgetSpec {
  minTokens?: number
  maxTokens?: number
  stepTokens?: number
}

export interface RuntimeThinkingControlSpec {
  kind: RuntimeThinkingControlKind
  selectionKind: RuntimeThinkingSelectionKind
  presetOptions?: RuntimeCanonicalThinkingSelection[]
  fixedSelection?: RuntimeCanonicalThinkingSelection | null
  budget?: RuntimeThinkingControlBudgetSpec | null
}

export interface RuntimeThinkingCapabilityProvenanceOverride {
  present: boolean
  applied: boolean
  source: string | null
  format: string | null
}

export interface RuntimeThinkingCapabilityProvenance {
  routeStatus: string
  override: RuntimeThinkingCapabilityProvenanceOverride
}

export interface RuntimeThinkingVisibility {
  reasoning: string
  supportsSuppression: boolean
}

export interface RuntimeThinkingCapability {
  status: RuntimeThinkingCapabilityStatus
  source: RuntimeThinkingCapabilitySource
  series: string | null
  seriesLabelZh: string | null
  editorType: RuntimeThinkingEditorType | null
  allowedValues: RuntimeThinkingValue[]
  defaultValue: RuntimeThinkingValue | null
  providerBuilderKey: string | null
  reasonCode: string
  routeFingerprint: {
    providerProfileId: string
    provider: string
    endpointType: string
    baseUrl: string
    modelId: string
  }
  supported?: boolean
  controlSpec?: RuntimeThinkingControlSpec | null
  defaultSelection?: RuntimeCanonicalThinkingSelection | null
  supportedLevels?: RuntimeThinkingLevel[]
  defaultLevel?: RuntimeThinkingLevel | null
  providerHint?: string | null
  provenance?: RuntimeThinkingCapabilityProvenance | null
  visibility?: RuntimeThinkingVisibility | null
  overrideLevels?: RuntimeThinkingLevel[]
}

export interface RuntimeThinkingSelectionResult {
  requestedSelection: RuntimeThinkingSelection | null
  appliedSelection: RuntimeThinkingSelection | null
  applied: boolean
  reasonCode: string
  errorCode: string | null
  providerBuilderKey: string | null
  mappingReasonCode: string | null
  capabilityStatus: RuntimeThinkingCapabilityStatus
  capabilitySource: RuntimeThinkingCapabilitySource
  capabilitySeries: string | null
  capabilitySeriesLabelZh: string | null
  capabilityReasonCode: string | null
  modelSettings?: Record<string, unknown>
  requestedThinkingLevel?: RuntimeThinkingLevel | null
  appliedThinkingLevel?: RuntimeThinkingLevel | null
  providerMapping?: string | null
  overridePresent?: boolean
  overrideApplied?: boolean
  overrideSource?: string | null
  reasoningVisibility?: string | null
  supportsSuppression?: boolean | null
}

export interface RuntimeReasoningSuppressionBasis {
  shouldSuppress: boolean
  source: string
  reasonCode: string | null
  appliedThinkingSelection: RuntimeThinkingSelection | null
  reasoningVisibility: string | null
  supportsSuppression: boolean
  capabilitySource: RuntimeThinkingCapabilitySource | null
  capabilitySeries: string | null
  appliedThinkingLevel?: RuntimeThinkingLevel | null
}

export interface RuntimeRunThinkingMetadata {
  requestedThinkingSelection: RuntimeThinkingSelection | null
  appliedThinkingSelection: RuntimeThinkingSelection | null
  thinkingCapabilitySnapshot: RuntimeThinkingCapability | null
  thinkingSeriesDecision: RuntimeThinkingSelectionResult | null
  reasoningSuppressionBasis: RuntimeReasoningSuppressionBasis | null
  requestedThinkingLevel?: RuntimeThinkingLevel | null
  appliedThinkingLevel?: RuntimeThinkingLevel | null
}

export interface RuntimeCapabilitiesGetResponse {
  ok: true
  sessionId: string
  boundAgent: RuntimeBoundAgent
  capabilitiesVersion: string
  tools: RuntimeToolDirectoryEntry[]
  recommendedTools: string[]
  toolSelectionMode: string
}

export interface RuntimeThinkingCapabilityGetResponse {
  ok: true
  sessionId: string
  capability: RuntimeThinkingCapability
}

export interface RuntimeMessagePayload {
  role: 'user' | 'assistant'
  content: string
  structuredPayload?: Record<string, unknown> | null
}

export type RuntimeInlineFormFieldType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox'

export interface RuntimeInlineFormFieldOption {
  value: string
  label: string
}

export interface RuntimeInlineFormField {
  name: string
  label: string
  type: RuntimeInlineFormFieldType
  description?: string
  placeholder?: string
  required?: boolean
  options?: RuntimeInlineFormFieldOption[]
}

export interface RuntimeInlineFormRequest {
  formId: string
  title: string
  description?: string
  submitLabel?: string
  fields: RuntimeInlineFormField[]
}

export interface RuntimeModelRoute {
  routeRef?: ModelRouteRef | null
  catalogRevision?: string
}

export interface RuntimeResolvedModelRoute {
  routeRef: ModelRouteRef
  providerProfileId: string
  provider: string
  providerId: string
  adapterId: string
  runtimeStatus: string
  catalogRevision: string
  endpointFamily: string
  endpointType: string
  baseUrl: string
  modelId: string
  authKind: string
}

export interface RuntimeThinkingSelection {
  series: string
  value?: RuntimeThinkingValue
  mode?: string | null
  level?: string | null
  budgetTokens?: number | null
}

export type RuntimeToolPermissionMode = 'allow' | 'ask' | 'delay' | 'deny'

export interface RuntimeToolPermissionPolicy {
  schemaVersion: number
  defaultMode: RuntimeToolPermissionMode
  toolModes: Record<string, RuntimeToolPermissionMode>
  toolTimeoutSeconds?: Record<string, number>
  toolTimeoutActions?: Record<string, 'approve' | 'deny'>
}

export interface RuntimeRunView extends RuntimeRunThinkingMetadata {
  runId: string
  threadId: string
  status: string
  createdAt: string
  updatedAt: string
  startedAt: string | null
  terminalAt: string | null
  cancelRequested: boolean
}

export interface RuntimeRunStartResponse {
  ok: true
  run: RuntimeRunView
  assistantMessageId: string
  stream: {
    method: 'run/stream'
    body: {
      runId: string
    }
  }
  cancel: {
    method: 'run/cancel'
    body: {
      runId: string
    }
  }
}

export interface RuntimeRunCancelResponse {
  ok: true
  run: RuntimeRunView
  cancelAccepted: boolean
}

export interface RuntimeShellSessionStartResponse {
  ok: true
  sessionId: string
  shell: string
  cwd: string | null
  started: boolean
  stdout: string
  stderr: string
  truncated: boolean
}

export interface RuntimeShellSessionExecResponse {
  ok: true
  sessionId: string
  shell: string
  closed: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
  timeoutSeconds: number
  maxOutputChars: number
}

export interface RuntimeShellSessionCloseResponse {
  ok: true
  sessionId: string
  closed: boolean
  alreadyClosed: boolean
  exitCode?: number | null
}

export interface RuntimeRunEventBase<TType extends string, TPayload extends object> {
  type: TType
  runId: string
  sessionId: string
  sequence: number
  payload: TPayload
}

export type RuntimeRunStartedEvent = RuntimeRunEventBase<'run_started', {
  assistantMessageId: string
} & Partial<RuntimeRunThinkingMetadata>>

export type RuntimeRunMetadataEvent = RuntimeRunEventBase<'run_metadata', RuntimeRunThinkingMetadata>

export type RuntimeTextDeltaEvent = RuntimeRunEventBase<'text_delta', {
  assistantMessageId: string
  delta: string
}>

export type RuntimeReasoningDeltaEvent = RuntimeRunEventBase<'reasoning_delta', {
  delta: string
}>

export type RuntimeRunCompletedEvent = RuntimeRunEventBase<'run_completed', {
  assistantMessageId: string
  assistantText: string
  resolvedModelId: string
  resolvedModelRoute: RuntimeResolvedModelRoute
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
}>

export type RuntimeRunFailedEvent = RuntimeRunEventBase<'run_failed', {
  code: string
  message: string
  details: Record<string, unknown>
}>

export type RuntimeRunCancelledEvent = RuntimeRunEventBase<'run_cancelled', {
  assistantMessageId: string
  reason: string
}>

export type RuntimeRunDiagnosticEvent = RuntimeRunEventBase<'run_diagnostic', {
  code: string
  message: string
  details: Record<string, unknown>
  stage: string
}>

export type RuntimeToolEventPhase = 'started' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled'

export interface RuntimeToolEventSecurity {
  riskLevel: 'safe' | 'moderate' | 'high'
  approvalMethod?: 'accept_reject' | 'password'
}

export interface RuntimeToolEventApproval {
  mode: RuntimeToolPermissionMode
  timeoutAt?: string | null
  timeoutSeconds?: number | null
  timeoutAction?: 'approve' | 'deny' | null
}

export type RuntimeToolEvent = RuntimeRunEventBase<'tool_event', {
  toolCallId: string
  toolId: string
  phase: RuntimeToolEventPhase
  title: string
  summary: string
  inputSummary?: string
  resultSummary?: string
  errorSummary?: string
  security?: RuntimeToolEventSecurity
  approval?: RuntimeToolEventApproval
  formRequest?: RuntimeInlineFormRequest
}>

export type RuntimeRunEvent =
  | RuntimeRunStartedEvent
  | RuntimeRunMetadataEvent
  | RuntimeTextDeltaEvent
  | RuntimeReasoningDeltaEvent
  | RuntimeRunCompletedEvent
  | RuntimeRunFailedEvent
  | RuntimeRunCancelledEvent
  | RuntimeRunDiagnosticEvent
  | RuntimeToolEvent

export type RuntimeRunTerminalEvent =
  | RuntimeRunCompletedEvent
  | RuntimeRunFailedEvent
  | RuntimeRunCancelledEvent

export interface RuntimeErrorPayload {
  ok?: false
  error?: {
    code?: string
    message?: string
    details?: Record<string, unknown>
  }
}

export interface RuntimeMethodRequest {
  method:
    | 'agents/list'
    | 'thread/create'
    | 'thread/get'
    | 'run/start'
    | 'run/stream'
    | 'run/cancel'
    | 'capabilities/get'
    | 'thinking/capability/get'
    | 'shell-session/start'
    | 'shell-session/exec'
    | 'shell-session/close'
  body?: Record<string, unknown>
}

export type FetchLike = typeof fetch
