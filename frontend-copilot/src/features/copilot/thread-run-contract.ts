import {
  isTerminalRuntimeRunEvent,
  parseRuntimeRunEventStream,
} from './runtime-message-stream'

export interface RuntimeAgentDirectoryEntry {
  agentId: string
  status: string
  recommendedTools: string[]
  defaultModelPreference: string | null
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
  defaultModelPreference: string | null
  capabilities: Record<string, unknown>
}

export interface RuntimeSessionCreateResponse {
  ok: true
  sessionId: string
  boundAgent: RuntimeBoundAgent
  createdAt: string
  updatedAt: string
  recommendedTools: string[]
  defaultModelPreference: string | null
  capabilities: Record<string, unknown>
}

export interface RuntimeToolDirectoryEntry {
  toolId: string
  kind: string
  availability: string
  displayName: string | null
  description: string | null
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
  defaultModelPreference: string | null
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
  supported: boolean
  series: string
  controlSpec: RuntimeThinkingControlSpec | null
  defaultSelection: RuntimeCanonicalThinkingSelection | null
  supportedLevels: RuntimeThinkingLevel[]
  defaultLevel: RuntimeThinkingLevel | null
  reasonCode: string
  providerHint: string | null
  routeFingerprint: {
    providerProfileId: string
    provider: string
    endpointType: string
    baseUrl: string
    modelId: string
  }
  provenance: RuntimeThinkingCapabilityProvenance | null
  visibility: RuntimeThinkingVisibility | null
  overrideLevels: RuntimeThinkingLevel[]
}

export interface RuntimeThinkingSelectionResult {
  requestedSelection: RuntimeCanonicalThinkingSelection | null
  appliedSelection: RuntimeCanonicalThinkingSelection | null
  requestedThinkingLevel: RuntimeThinkingLevel | null
  appliedThinkingLevel: RuntimeThinkingLevel | null
  applied: boolean
  reasonCode: string
  errorCode: string | null
  mappingReasonCode: string | null
  providerMapping: string | null
  capabilityStatus: RuntimeThinkingCapabilityStatus
  capabilitySource: RuntimeThinkingCapabilitySource
  capabilitySeries: string | null
  capabilityReasonCode: string | null
  overridePresent: boolean
  overrideApplied: boolean
  overrideSource: string | null
  reasoningVisibility: string | null
  supportsSuppression: boolean | null
  modelSettings?: Record<string, unknown>
}

export interface RuntimeReasoningSuppressionBasis {
  shouldSuppress: boolean
  source: string
  reasonCode: string | null
  appliedThinkingLevel: RuntimeThinkingLevel | null
  reasoningVisibility: string | null
  supportsSuppression: boolean
  capabilitySource: RuntimeThinkingCapabilitySource | null
  capabilitySeries: string | null
}

export interface RuntimeRunThinkingMetadata {
  requestedThinkingSelection: RuntimeThinkingSelection | null
  appliedThinkingSelection: RuntimeThinkingSelection | null
  requestedThinkingLevel: RuntimeThinkingLevel | null
  appliedThinkingLevel: RuntimeThinkingLevel | null
  thinkingCapabilitySnapshot: RuntimeThinkingCapability | null
  thinkingSelectionResult: RuntimeThinkingSelectionResult | null
  reasoningSuppressionBasis: RuntimeReasoningSuppressionBasis | null
}

export interface RuntimeCapabilitiesGetResponse {
  ok: true
  sessionId: string
  boundAgent: RuntimeBoundAgent
  capabilitiesVersion: string
  tools: RuntimeToolDirectoryEntry[]
  recommendedTools: string[]
  toolSelectionMode: string
  defaultModelPreference: string | null
}

export interface RuntimeThinkingCapabilityGetResponse {
  ok: true
  sessionId: string
  capability: RuntimeThinkingCapability
}

export interface RuntimeMessagePayload {
  role: 'user' | 'assistant'
  content: string
}

export interface RuntimeModelRouteSnapshot {
  provider: string
  endpointType: string
  baseUrl: string
  modelId: string
}

export interface RuntimeModelRoute {
  providerProfileId: string
  snapshot: RuntimeModelRouteSnapshot
}

export interface RuntimeThinkingSelection {
  series: string
  mode: string | null
  level: RuntimeThinkingLevel | null
  budgetTokens: number | null
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

export interface RuntimeRunEventBase<TType extends string, TPayload extends Record<string, unknown>> {
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
  resolvedModelRoute: RuntimeModelRoute
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

export type RuntimeToolEventPhase = 'started' | 'completed' | 'failed'

export type RuntimeToolEvent = RuntimeRunEventBase<'tool_event', {
  toolCallId: string
  toolId: string
  phase: RuntimeToolEventPhase
  title: string
  summary: string
  inputSummary?: string
  resultSummary?: string
  errorSummary?: string
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

interface RuntimeErrorPayload {
  ok?: false
  error?: {
    code?: string
    message?: string
  }
}

interface RuntimeMethodRequest {
  method:
    | 'agents/list'
    | 'thread/create'
    | 'thread/get'
    | 'run/start'
    | 'run/stream'
    | 'run/cancel'
    | 'session/create'
    | 'capabilities/get'
    | 'thinking/capability/get'
    | 'message/send'
  body?: Record<string, unknown>
}

export type FetchLike = typeof fetch

export class RuntimeRequestError extends Error {
  readonly code: string | null
  readonly status: number

  constructor(message: string, input: { code?: string; status: number }) {
    super(message)
    this.name = 'RuntimeRequestError'
    this.code = input.code ?? null
    this.status = input.status
  }
}

export async function listRuntimeAgents(input: {
  runtimeUrl: string
  fetchFn?: FetchLike
}): Promise<RuntimeAgentsListResponse> {
  return postRuntimeMethod<RuntimeAgentsListResponse>({
    runtimeUrl: input.runtimeUrl,
    method: 'agents/list',
    fetchFn: input.fetchFn,
  })
}

export async function createRuntimeThread(input: {
  runtimeUrl: string
  agentId: string
  fetchFn?: FetchLike
  signal?: AbortSignal
}): Promise<RuntimeThreadCreateResponse> {
  return postRuntimeMethod<RuntimeThreadCreateResponse>({
    runtimeUrl: input.runtimeUrl,
    method: 'thread/create',
    body: {
      agentId: input.agentId,
    },
    fetchFn: input.fetchFn,
    signal: input.signal,
  })
}

export async function getRuntimeThread(input: {
  runtimeUrl: string
  threadId: string
  fetchFn?: FetchLike
  signal?: AbortSignal
}): Promise<RuntimeThreadGetResponse> {
  return postRuntimeMethod<RuntimeThreadGetResponse>({
    runtimeUrl: input.runtimeUrl,
    method: 'thread/get',
    body: {
      threadId: input.threadId,
    },
    fetchFn: input.fetchFn,
    signal: input.signal,
  })
}

export async function createRuntimeSession(input: {
  runtimeUrl: string
  agentId: string
  fetchFn?: FetchLike
  signal?: AbortSignal
}): Promise<RuntimeSessionCreateResponse> {
  const response = await createRuntimeThread(input)
  return {
    ok: true,
    sessionId: response.threadId,
    boundAgent: { ...response.boundAgent },
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    recommendedTools: [...response.recommendedTools],
    defaultModelPreference: response.defaultModelPreference,
    capabilities: { ...response.capabilities },
  }
}

export async function getRuntimeCapabilities(input: {
  runtimeUrl: string
  sessionId: string
  fetchFn?: FetchLike
  signal?: AbortSignal
}): Promise<RuntimeCapabilitiesGetResponse> {
  const response = await getRuntimeThread({
    runtimeUrl: input.runtimeUrl,
    threadId: input.sessionId,
    fetchFn: input.fetchFn,
    signal: input.signal,
  })

  return {
    ok: true,
    sessionId: response.threadId,
    boundAgent: { ...response.boundAgent },
    capabilitiesVersion: response.capabilitiesVersion,
    tools: response.tools.map((tool) => ({ ...tool })),
    recommendedTools: [...response.recommendedTools],
    toolSelectionMode: response.toolSelectionMode,
    defaultModelPreference: response.defaultModelPreference,
  }
}

export async function getRuntimeThinkingCapability(input: {
  runtimeUrl: string
  sessionId: string
  modelRoute: RuntimeModelRoute
  thinkingCapabilityOverride?: Record<string, unknown> | null
  fetchFn?: FetchLike
  signal?: AbortSignal
}): Promise<RuntimeThinkingCapabilityGetResponse> {
  return postRuntimeMethod<RuntimeThinkingCapabilityGetResponse>({
    runtimeUrl: input.runtimeUrl,
    method: 'thinking/capability/get',
    body: {
      sessionId: input.sessionId,
      modelRoute: input.modelRoute,
      ...(input.thinkingCapabilityOverride === undefined || input.thinkingCapabilityOverride === null
        ? {}
        : { thinkingCapabilityOverride: input.thinkingCapabilityOverride }),
    },
    fetchFn: input.fetchFn,
    signal: input.signal,
  })
}

export async function startRuntimeRun(input: {
  runtimeUrl: string
  threadId: string
  agent?: string
  message: RuntimeMessagePayload
  modelRoute: RuntimeModelRoute
  thinkingSelection?: RuntimeThinkingSelection | null
  thinkingLevelIntent?: 'off' | 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | null
  thinkingCapabilityOverride?: Record<string, unknown> | null
  enabledTools: string[]
  debugModeEnabled?: boolean
  requestOptions?: Record<string, unknown>
  fetchFn?: FetchLike
  signal?: AbortSignal
}): Promise<RuntimeRunStartResponse> {
  const thinkingSelection = input.thinkingSelection ?? buildCompatRuntimeThinkingSelection(
    input.thinkingLevelIntent ?? null,
  )

  return postRuntimeMethod<RuntimeRunStartResponse>({
    runtimeUrl: input.runtimeUrl,
    method: 'run/start',
    body: {
      threadId: input.threadId,
      ...(input.agent === undefined ? {} : { agent: input.agent }),
      message: input.message,
      policy: {
        modelRoute: input.modelRoute,
        ...(thinkingSelection === undefined || thinkingSelection === null
          ? {}
          : { thinkingSelection }),
        ...(input.thinkingCapabilityOverride === undefined || input.thinkingCapabilityOverride === null
          ? {}
          : { thinkingCapabilityOverride: input.thinkingCapabilityOverride }),
        enabledTools: input.enabledTools,
        ...(input.debugModeEnabled === undefined
          ? {}
          : { debugModeEnabled: input.debugModeEnabled }),
        requestOptions: input.requestOptions ?? {},
      },
    },
    fetchFn: input.fetchFn,
    signal: input.signal,
  })
}

export async function cancelRuntimeRun(input: {
  runtimeUrl: string
  runId: string
  fetchFn?: FetchLike
  signal?: AbortSignal
}): Promise<RuntimeRunCancelResponse> {
  return postRuntimeMethod<RuntimeRunCancelResponse>({
    runtimeUrl: input.runtimeUrl,
    method: 'run/cancel',
    body: {
      runId: input.runId,
    },
    fetchFn: input.fetchFn,
    signal: input.signal,
  })
}

export async function* streamRuntimeRun(input: {
  runtimeUrl: string
  runId: string
  fetchFn?: FetchLike
  signal?: AbortSignal
}): AsyncGenerator<RuntimeRunEvent> {
  const fetchFn = input.fetchFn ?? fetch
  const response = await fetchFn(buildRuntimeEndpoint(input.runtimeUrl), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildRuntimeRequest({
      method: 'run/stream',
      body: {
        runId: input.runId,
      },
    })),
    signal: input.signal,
  })

  if (!response.ok) {
    throw await buildRuntimeRequestErrorFromResponse(response)
  }

  if (response.body === null) {
    throw new Error('Runtime run stream response body is unavailable.')
  }

  let lastSequence = 0
  let runId: string | null = null
  let sessionId: string | null = null
  let sawRunStarted = false
  let sawTerminal = false

  try {
    for await (const event of parseRuntimeRunEventStream(response.body)) {
      if (sawTerminal) {
        throw new Error('Runtime event stream emitted additional events after a terminal event.')
      }

      if (event.sequence <= lastSequence) {
        throw new Error(`Runtime event sequence regressed from ${lastSequence} to ${event.sequence}.`)
      }

      if (runId !== null && event.runId !== runId) {
        throw new Error(`Runtime event stream changed runId from ${runId} to ${event.runId}.`)
      }

      if (sessionId !== null && event.sessionId !== sessionId) {
        throw new Error(`Runtime event stream changed sessionId from ${sessionId} to ${event.sessionId}.`)
      }

      if (!sawRunStarted && event.type !== 'run_started') {
        throw new Error(`Runtime event stream must begin with run_started, received ${event.type}.`)
      }

      lastSequence = event.sequence
      runId = event.runId
      sessionId = event.sessionId
      if (event.type === 'run_started') {
        sawRunStarted = true
      }
      if (isTerminalRuntimeRunEvent(event)) {
        sawTerminal = true
      }

      yield event
    }

    if (!sawRunStarted) {
      throw new Error('Runtime event stream ended before run_started was received.')
    }

    if (!sawTerminal) {
      throw new Error('Runtime event stream ended without a terminal event.')
    }
  } catch (error) {
    if (isAbortLikeError(error) || input.signal?.aborted === true) {
      throw createAbortError()
    }
    throw error
  }
}

export async function* sendRuntimeMessage(input: {
  runtimeUrl: string
  sessionId: string
  agent?: string
  message: RuntimeMessagePayload
  modelRoute: RuntimeModelRoute
  thinkingSelection?: RuntimeThinkingSelection | null
  thinkingLevelIntent?: 'off' | 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | null
  thinkingCapabilityOverride?: Record<string, unknown> | null
  enabledTools: string[]
  debugModeEnabled?: boolean
  requestOptions?: Record<string, unknown>
  fetchFn?: FetchLike
  signal?: AbortSignal
  onRunStart?: (response: RuntimeRunStartResponse) => void
}): AsyncGenerator<RuntimeRunEvent> {
  const runStartResponse = await startRuntimeRun({
    runtimeUrl: input.runtimeUrl,
    threadId: input.sessionId,
    agent: input.agent,
    message: input.message,
    modelRoute: input.modelRoute,
    thinkingSelection: input.thinkingSelection,
    thinkingLevelIntent: input.thinkingLevelIntent,
    thinkingCapabilityOverride: input.thinkingCapabilityOverride,
    enabledTools: input.enabledTools,
    debugModeEnabled: input.debugModeEnabled,
    requestOptions: input.requestOptions,
    fetchFn: input.fetchFn,
    signal: input.signal,
  })

  input.onRunStart?.(cloneRunStartResponse(runStartResponse))

  try {
    for await (const event of streamRuntimeRun({
      runtimeUrl: input.runtimeUrl,
      runId: runStartResponse.run.runId,
      fetchFn: input.fetchFn,
      signal: input.signal,
    })) {
      if (event.runId !== runStartResponse.run.runId) {
        throw new Error(
          `Runtime event stream changed runId from ${runStartResponse.run.runId} to ${event.runId}.`,
        )
      }

      yield event
    }
  } catch (error) {
    if (isAbortLikeError(error) || input.signal?.aborted === true) {
      throw createAbortError()
    }
    throw error
  }
}

async function postRuntimeMethod<TResponse>(input: {
  runtimeUrl: string
  method: RuntimeMethodRequest['method']
  body?: Record<string, unknown>
  fetchFn?: FetchLike
  signal?: AbortSignal
}): Promise<TResponse> {
  const fetchFn = input.fetchFn ?? fetch
  const response = await fetchFn(buildRuntimeEndpoint(input.runtimeUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildRuntimeRequest(input)),
    signal: input.signal,
  })

  const payload = await response.json() as TResponse | RuntimeErrorPayload

  if (!response.ok) {
    throw buildRuntimeRequestError(
      isRuntimeErrorPayload(payload) ? payload : {},
      response.status,
    )
  }

  if (isRuntimeErrorPayload(payload)) {
    throw buildRuntimeRequestError(payload, response.status)
  }

  return payload
}

function buildRuntimeRequest(input: {
  method: RuntimeMethodRequest['method']
  body?: Record<string, unknown>
}): RuntimeMethodRequest {
  if (input.body === undefined) {
    return { method: input.method }
  }

  return {
    method: input.method,
    body: input.body,
  }
}

export function buildRuntimeEndpoint(runtimeUrl: string): string {
  return runtimeUrl.endsWith('/') ? runtimeUrl : `${runtimeUrl}/`
}

function isRuntimeErrorPayload(payload: unknown): payload is RuntimeErrorPayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  return 'ok' in payload && payload.ok === false
}

async function buildRuntimeRequestErrorFromResponse(
  response: Awaited<ReturnType<FetchLike>>,
): Promise<RuntimeRequestError> {
  const payload = await readRuntimeErrorPayload(response)
  return buildRuntimeRequestError(payload, response.status)
}

async function readRuntimeErrorPayload(
  response: Awaited<ReturnType<FetchLike>>,
): Promise<RuntimeErrorPayload> {
  const contentType = getResponseHeader(response, 'content-type')
  if (!contentType.includes('application/json') && typeof response.json !== 'function') {
    return {}
  }

  try {
    const payload = await response.json() as unknown
    return isRuntimeErrorPayload(payload) ? payload : {}
  } catch {
    return {}
  }
}

function getResponseHeader(
  response: Awaited<ReturnType<FetchLike>>,
  headerName: string,
): string {
  const headerValue = response.headers?.get(headerName) ?? response.headers?.get(headerName.toLowerCase())
  return typeof headerValue === 'string' ? headerValue.toLowerCase() : ''
}

function buildRuntimeRequestError(payload: RuntimeErrorPayload, status: number): RuntimeRequestError {
  return new RuntimeRequestError(buildRuntimeErrorMessage(payload, status), {
    code: payload.error?.code,
    status,
  })
}

function buildRuntimeErrorMessage(payload: RuntimeErrorPayload, status: number): string {
  const code = payload.error?.code
  const message = payload.error?.message

  if (code && message) {
    return `${code}: ${message}`
  }

  if (code) {
    return code
  }

  if (message) {
    return message
  }

  return `Runtime request failed with HTTP ${status}.`
}

function cloneRunStartResponse(response: RuntimeRunStartResponse): RuntimeRunStartResponse {
  return {
    ok: true,
    run: {
      runId: response.run.runId,
      threadId: response.run.threadId,
      status: response.run.status,
      createdAt: response.run.createdAt,
      updatedAt: response.run.updatedAt,
      startedAt: response.run.startedAt,
      terminalAt: response.run.terminalAt,
      cancelRequested: response.run.cancelRequested,
      requestedThinkingSelection: cloneRuntimeThinkingSelection(response.run.requestedThinkingSelection),
      appliedThinkingSelection: cloneRuntimeThinkingSelection(response.run.appliedThinkingSelection),
      requestedThinkingLevel: response.run.requestedThinkingLevel,
      appliedThinkingLevel: response.run.appliedThinkingLevel,
      thinkingCapabilitySnapshot: cloneRuntimeThinkingCapability(response.run.thinkingCapabilitySnapshot),
      thinkingSelectionResult: cloneRuntimeThinkingSelectionResult(response.run.thinkingSelectionResult),
      reasoningSuppressionBasis: cloneRuntimeReasoningSuppressionBasis(
        response.run.reasoningSuppressionBasis,
      ),
    },
    assistantMessageId: response.assistantMessageId,
    stream: {
      method: 'run/stream',
      body: {
        runId: response.stream.body.runId,
      },
    },
    cancel: {
      method: 'run/cancel',
      body: {
        runId: response.cancel.body.runId,
      },
    },
  }
}

export function cloneRuntimeThinkingSelection(
  selection: RuntimeThinkingSelection | null | undefined,
): RuntimeThinkingSelection | null {
  if (selection == null) {
    return null
  }

  return {
    series: selection.series,
    mode: selection.mode,
    level: selection.level,
    budgetTokens: selection.budgetTokens,
  }
}

function cloneRuntimeCanonicalThinkingSelection(
  selection: RuntimeCanonicalThinkingSelection | null | undefined,
): RuntimeCanonicalThinkingSelection | null {
  if (selection == null) {
    return null
  }

  return {
    kind: selection.kind,
    ...(selection.value === undefined ? {} : { value: selection.value }),
    ...(selection.budgetTokens === undefined ? {} : { budgetTokens: selection.budgetTokens }),
  }
}

function cloneRuntimeThinkingControlSpec(
  controlSpec: RuntimeThinkingControlSpec | null | undefined,
): RuntimeThinkingControlSpec | null {
  if (controlSpec == null) {
    return null
  }

  return {
    kind: controlSpec.kind,
    selectionKind: controlSpec.selectionKind,
    ...(controlSpec.presetOptions === undefined ? {} : {
      presetOptions: controlSpec.presetOptions.map((option) => cloneRuntimeCanonicalThinkingSelection(option)!),
    }),
    ...(controlSpec.fixedSelection === undefined ? {} : {
      fixedSelection: cloneRuntimeCanonicalThinkingSelection(controlSpec.fixedSelection),
    }),
    ...(controlSpec.budget === undefined
      ? {}
      : controlSpec.budget === null
        ? { budget: null }
        : {
            budget: {
              ...(controlSpec.budget.minTokens === undefined ? {} : { minTokens: controlSpec.budget.minTokens }),
              ...(controlSpec.budget.maxTokens === undefined ? {} : { maxTokens: controlSpec.budget.maxTokens }),
              ...(controlSpec.budget.stepTokens === undefined ? {} : { stepTokens: controlSpec.budget.stepTokens }),
            },
          }),
  }
}

export function cloneRuntimeThinkingCapability(
  capability: RuntimeThinkingCapability | null | undefined,
): RuntimeThinkingCapability | null {
  if (capability == null) {
    return null
  }

  return {
    status: capability.status,
    source: capability.source,
    supported: capability.supported,
    series: capability.series,
    controlSpec: cloneRuntimeThinkingControlSpec(capability.controlSpec),
    defaultSelection: cloneRuntimeCanonicalThinkingSelection(capability.defaultSelection),
    supportedLevels: [...capability.supportedLevels],
    defaultLevel: capability.defaultLevel,
    reasonCode: capability.reasonCode,
    providerHint: capability.providerHint,
    routeFingerprint: {
      providerProfileId: capability.routeFingerprint.providerProfileId,
      provider: capability.routeFingerprint.provider,
      endpointType: capability.routeFingerprint.endpointType,
      baseUrl: capability.routeFingerprint.baseUrl,
      modelId: capability.routeFingerprint.modelId,
    },
    provenance: capability.provenance === null
      ? null
      : {
          routeStatus: capability.provenance.routeStatus,
          override: {
            present: capability.provenance.override.present,
            applied: capability.provenance.override.applied,
            source: capability.provenance.override.source,
            format: capability.provenance.override.format,
          },
        },
    visibility: capability.visibility === null
      ? null
      : {
          reasoning: capability.visibility.reasoning,
          supportsSuppression: capability.visibility.supportsSuppression,
        },
    overrideLevels: [...capability.overrideLevels],
  }
}

export function cloneRuntimeThinkingSelectionResult(
  result: RuntimeThinkingSelectionResult | null | undefined,
): RuntimeThinkingSelectionResult | null {
  if (result == null) {
    return null
  }

  return {
    requestedSelection: cloneRuntimeCanonicalThinkingSelection(result.requestedSelection),
    appliedSelection: cloneRuntimeCanonicalThinkingSelection(result.appliedSelection),
    requestedThinkingLevel: result.requestedThinkingLevel,
    appliedThinkingLevel: result.appliedThinkingLevel,
    applied: result.applied,
    reasonCode: result.reasonCode,
    errorCode: result.errorCode,
    mappingReasonCode: result.mappingReasonCode,
    providerMapping: result.providerMapping,
    capabilityStatus: result.capabilityStatus,
    capabilitySource: result.capabilitySource,
    capabilitySeries: result.capabilitySeries,
    capabilityReasonCode: result.capabilityReasonCode,
    overridePresent: result.overridePresent,
    overrideApplied: result.overrideApplied,
    overrideSource: result.overrideSource,
    reasoningVisibility: result.reasoningVisibility,
    supportsSuppression: result.supportsSuppression,
    ...(result.modelSettings === undefined ? {} : { modelSettings: { ...result.modelSettings } }),
  }
}

export function cloneRuntimeReasoningSuppressionBasis(
  basis: RuntimeReasoningSuppressionBasis | null | undefined,
): RuntimeReasoningSuppressionBasis | null {
  if (basis == null) {
    return null
  }

  return {
    shouldSuppress: basis.shouldSuppress,
    source: basis.source,
    reasonCode: basis.reasonCode,
    appliedThinkingLevel: basis.appliedThinkingLevel,
    reasoningVisibility: basis.reasoningVisibility,
    supportsSuppression: basis.supportsSuppression,
    capabilitySource: basis.capabilitySource,
    capabilitySeries: basis.capabilitySeries,
  }
}

function buildCompatRuntimeThinkingSelection(
  thinkingLevelIntent: RuntimeRunMetadataEvent['payload']['requestedThinkingLevel'],
): RuntimeThinkingSelection | null {
  if (thinkingLevelIntent === null) {
    return null
  }

  return {
    series: 'compat-discrete-selection-v1',
    mode: 'preset',
    level: thinkingLevelIntent,
    budgetTokens: null,
  }
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function isAbortLikeError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
}
