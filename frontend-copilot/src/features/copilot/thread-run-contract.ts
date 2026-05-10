import type { ModelRouteRef } from '../../workbench/types'
import type {
  FetchLike,
  RuntimeAgentsListResponse,
  RuntimeCapabilitiesGetResponse,
  RuntimeCanonicalThinkingSelection,
  RuntimeErrorPayload,
  RuntimeMessagePayload,
  RuntimeMethodRequest,
  RuntimeModelRoute,
  RuntimeReasoningSuppressionBasis,
  RuntimeRunCancelResponse,
  RuntimeRunEvent,
  RuntimeRunStartResponse,
  RuntimeThinkingCapability,
  RuntimeThinkingCapabilityGetResponse,
  RuntimeThinkingControlSpec,
  RuntimeThinkingSelection,
  RuntimeThinkingSelectionResult,
  RuntimeThinkingValue,
  RuntimeThreadCreateResponse,
  RuntimeThreadGetResponse,
  RuntimeToolPermissionPolicy,
} from './_contracts/types'

export type {
  FetchLike,
  RuntimeAgentDirectoryEntry,
  RuntimeAgentsListResponse,
  RuntimeBoundAgent,
  RuntimeCapabilitiesGetResponse,
  RuntimeCanonicalThinkingSelection,
  RuntimeInlineFormField,
  RuntimeInlineFormFieldOption,
  RuntimeInlineFormFieldType,
  RuntimeInlineFormRequest,
  RuntimeMessagePayload,
  RuntimeMethodRequest,
  RuntimeModelRoute,
  RuntimeReasoningDeltaEvent,
  RuntimeReasoningSuppressionBasis,
  RuntimeResolvedModelRoute,
  RuntimeRunCancelResponse,
  RuntimeRunCancelledEvent,
  RuntimeRunCompletedEvent,
  RuntimeRunDiagnosticEvent,
  RuntimeRunEvent,
  RuntimeRunEventBase,
  RuntimeRunFailedEvent,
  RuntimeRunMetadataEvent,
  RuntimeRunStartResponse,
  RuntimeRunStartedEvent,
  RuntimeRunTerminalEvent,
  RuntimeRunThinkingMetadata,
  RuntimeRunView,
  RuntimeTextDeltaEvent,
  RuntimeThinkingBudgetValue,
  RuntimeThinkingCapability,
  RuntimeThinkingCapabilityGetResponse,
  RuntimeThinkingCapabilityProvenance,
  RuntimeThinkingCapabilityProvenanceOverride,
  RuntimeThinkingCapabilitySource,
  RuntimeThinkingCapabilityStatus,
  RuntimeThinkingCodeValue,
  RuntimeThinkingControlBudgetSpec,
  RuntimeThinkingControlKind,
  RuntimeThinkingControlSpec,
  RuntimeThinkingEditorType,
  RuntimeThinkingFixedValue,
  RuntimeThinkingLevel,
  RuntimeThinkingSelection,
  RuntimeThinkingSelectionKind,
  RuntimeThinkingSelectionResult,
  RuntimeThinkingValue,
  RuntimeThinkingVisibility,
  RuntimeThreadCreateResponse,
  RuntimeThreadGetResponse,
  RuntimeToolDirectoryEntry,
  RuntimeToolEvent,
  RuntimeToolEventApproval,
  RuntimeToolEventPhase,
  RuntimeToolEventSecurity,
  RuntimeToolPermissionMode,
  RuntimeToolPermissionPolicy,
  RuntimeToolPresentationGroup,
} from './_contracts/types'

import {
  isTerminalRuntimeRunEvent,
  parseRuntimeRunEventStream,
} from './runtime-message-stream'
import { formatThinkingTokenCount } from '../../workbench/thinking-display'

const RUNTIME_CONNECTIVITY_ERROR_MESSAGE = '无法连接到本地运行时，可能由后端异常、CORS 或网络拒绝导致，请查看运行时控制台日志。'

export class RuntimeRequestError extends Error {
  readonly code: string | null
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(message: string, input: { code?: string; status: number; details?: Record<string, unknown> }) {
    super(message)
    this.name = 'RuntimeRequestError'
    this.code = input.code ?? null
    this.status = input.status
    this.details = { ...(input.details ?? {}) }
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
      modelRoute: serializeRuntimeModelRouteForRequest(input.modelRoute),
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
  thinkingCapabilityOverride?: Record<string, unknown> | null
  enabledTools: string[]
  toolPermissionPolicy?: RuntimeToolPermissionPolicy | null
  debugModeEnabled?: boolean
  requestOptions?: Record<string, unknown>
  fetchFn?: FetchLike
  signal?: AbortSignal
}): Promise<RuntimeRunStartResponse> {
  const thinkingSelection = serializeRuntimeThinkingSelection(input.thinkingSelection)

  return postRuntimeMethod<RuntimeRunStartResponse>({
    runtimeUrl: input.runtimeUrl,
    method: 'run/start',
    body: {
      threadId: input.threadId,
      ...(input.agent === undefined ? {} : { agent: input.agent }),
      message: input.message,
      policy: {
        modelRoute: serializeRuntimeModelRouteForRequest(input.modelRoute),
        ...(thinkingSelection === null
          ? {}
          : { thinkingSelection }),
        ...(input.thinkingCapabilityOverride === undefined || input.thinkingCapabilityOverride === null
          ? {}
          : { thinkingCapabilityOverride: input.thinkingCapabilityOverride }),
        enabledTools: input.enabledTools,
        ...(input.toolPermissionPolicy === undefined || input.toolPermissionPolicy === null
          ? {}
          : { toolPermissionPolicy: input.toolPermissionPolicy }),
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
  let response: Awaited<ReturnType<FetchLike>>
  try {
    response = await fetchFn(buildRuntimeEndpoint(input.runtimeUrl), {
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
  } catch (error) {
    if (isAbortLikeError(error) || input.signal?.aborted === true) {
      throw createAbortError()
    }
    throwMappedRuntimeTransportError(error)
  }

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
    throwMappedRuntimeTransportError(error)
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
  let response: Awaited<ReturnType<FetchLike>>
  try {
    response = await fetchFn(buildRuntimeEndpoint(input.runtimeUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildRuntimeRequest(input)),
      signal: input.signal,
    })
  } catch (error) {
    if (isAbortLikeError(error) || input.signal?.aborted === true) {
      throw createAbortError()
    }
    throwMappedRuntimeTransportError(error)
  }

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
    details: isRecord(payload.error?.details) ? payload.error?.details : {},
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
  const thinkingSeriesDecision = cloneRuntimeThinkingSelectionResult(
    response.run.thinkingSeriesDecision,
  )

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
      thinkingCapabilitySnapshot: cloneRuntimeThinkingCapability(response.run.thinkingCapabilitySnapshot),
      thinkingSeriesDecision,
      ...(response.run.requestedThinkingLevel === undefined
        ? {}
        : { requestedThinkingLevel: response.run.requestedThinkingLevel }),
      ...(response.run.appliedThinkingLevel === undefined
        ? {}
        : { appliedThinkingLevel: response.run.appliedThinkingLevel }),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function serializeRuntimeModelRouteForRequest(route: RuntimeModelRoute): {
  routeRef: ModelRouteRef
  catalogRevision?: string
} {
  const routeRef = serializeRuntimeModelRouteRef(route)
  if (routeRef === null) {
    throw new Error('Runtime model route request must include a stable routeRef.')
  }

  return {
    routeRef,
    ...(typeof route.catalogRevision === 'string' && route.catalogRevision.trim() !== ''
      ? { catalogRevision: route.catalogRevision.trim() }
      : {}),
  }
}

function serializeRuntimeModelRouteRef(route: RuntimeModelRoute): ModelRouteRef | null {
  const routeRef = route.routeRef
  if (routeRef === undefined || routeRef === null) {
    return null
  }

  return {
    routeKind: routeRef.routeKind,
    profileId: routeRef.profileId,
    modelId: routeRef.modelId,
  }
}

export function cloneRuntimeThinkingSelection(
  selection: RuntimeThinkingSelection | null | undefined,
): RuntimeThinkingSelection | null {
  if (selection == null) {
    return null
  }

  const clonedValue = cloneRuntimeThinkingValue(selection.value)
    ?? buildRuntimeThinkingValueFromLegacySelection(selection)
  if (clonedValue === null) {
    return null
  }

  return {
    series: selection.series,
    value: clonedValue,
    ...deriveLegacyThinkingSelectionFields(clonedValue),
  }
}

function cloneRuntimeThinkingValue(
  value: RuntimeThinkingValue | null | undefined,
): RuntimeThinkingValue | null {
  if (value == null) {
    return null
  }

  switch (value.valueType) {
    case 'code':
      return {
        valueType: 'code',
        code: value.code,
        labelZh: value.labelZh,
      }
    case 'budget':
      return {
        valueType: 'budget',
        mode: value.mode,
        budgetTokens: value.budgetTokens,
        labelZh: value.labelZh,
      }
    case 'fixed':
      return {
        valueType: 'fixed',
        code: value.code,
        labelZh: value.labelZh,
      }
  }
}

function deriveLegacyThinkingSelectionFields(
  value: RuntimeThinkingValue,
): Pick<RuntimeThinkingSelection, 'mode' | 'level' | 'budgetTokens'> {
  switch (value.valueType) {
    case 'budget':
      return {
        mode: 'budget',
        level: null,
        budgetTokens: value.mode === 'budget' ? value.budgetTokens : null,
      }
    case 'fixed':
    case 'code':
      return {
        mode: 'preset',
        level: value.code,
        budgetTokens: null,
      }
  }
}

function buildRuntimeThinkingValueFromLegacySelection(
  selection: Pick<RuntimeThinkingSelection, 'mode' | 'level' | 'budgetTokens'>,
): RuntimeThinkingValue | null {
  if (selection.mode === 'budget' && typeof selection.budgetTokens === 'number') {
    return {
      valueType: 'budget',
      mode: 'budget',
      budgetTokens: selection.budgetTokens,
      labelZh: formatThinkingTokenCount(selection.budgetTokens),
    }
  }

  if (typeof selection.level === 'string' && selection.level.trim() !== '') {
    if (selection.level === 'fixed') {
      return {
        valueType: 'fixed',
        code: 'fixed',
        labelZh: '固定推理',
      }
    }

    return {
      valueType: 'code',
      code: selection.level,
      labelZh: selection.level,
    }
  }

  return null
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
    series: capability.series,
    seriesLabelZh: capability.seriesLabelZh,
    editorType: capability.editorType,
    allowedValues: capability.allowedValues.map((value) => cloneRuntimeThinkingValue(value)!),
    defaultValue: cloneRuntimeThinkingValue(capability.defaultValue),
    providerBuilderKey: capability.providerBuilderKey,
    reasonCode: capability.reasonCode,
    routeFingerprint: {
      providerProfileId: capability.routeFingerprint.providerProfileId,
      provider: capability.routeFingerprint.provider,
      endpointType: capability.routeFingerprint.endpointType,
      baseUrl: capability.routeFingerprint.baseUrl,
      modelId: capability.routeFingerprint.modelId,
    },
    ...(capability.supported === undefined ? {} : { supported: capability.supported }),
    ...(capability.controlSpec === undefined
      ? {}
      : { controlSpec: cloneRuntimeThinkingControlSpec(capability.controlSpec) }),
    ...(capability.defaultSelection === undefined
      ? {}
      : { defaultSelection: cloneRuntimeCanonicalThinkingSelection(capability.defaultSelection) }),
    ...(capability.supportedLevels === undefined
      ? {}
      : { supportedLevels: [...capability.supportedLevels] }),
    ...(capability.defaultLevel === undefined ? {} : { defaultLevel: capability.defaultLevel }),
    ...(capability.providerHint === undefined ? {} : { providerHint: capability.providerHint }),
    ...(capability.provenance === undefined
      ? {}
      : {
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
        }),
    ...(capability.visibility === undefined
      ? {}
      : {
          visibility: capability.visibility === null
            ? null
            : {
                reasoning: capability.visibility.reasoning,
                supportsSuppression: capability.visibility.supportsSuppression,
              },
        }),
    ...(capability.overrideLevels === undefined ? {} : { overrideLevels: [...capability.overrideLevels] }),
  }
}

export function cloneRuntimeThinkingSelectionResult(
  result: RuntimeThinkingSelectionResult | null | undefined,
): RuntimeThinkingSelectionResult | null {
  if (result == null) {
    return null
  }

  return {
    requestedSelection: cloneRuntimeThinkingSelection(result.requestedSelection),
    appliedSelection: cloneRuntimeThinkingSelection(result.appliedSelection),
    applied: result.applied,
    reasonCode: result.reasonCode,
    errorCode: result.errorCode,
    providerBuilderKey: result.providerBuilderKey,
    mappingReasonCode: result.mappingReasonCode,
    capabilityStatus: result.capabilityStatus,
    capabilitySource: result.capabilitySource,
    capabilitySeries: result.capabilitySeries,
    capabilitySeriesLabelZh: result.capabilitySeriesLabelZh,
    capabilityReasonCode: result.capabilityReasonCode,
    ...(result.requestedThinkingLevel === undefined ? {} : { requestedThinkingLevel: result.requestedThinkingLevel }),
    ...(result.appliedThinkingLevel === undefined ? {} : { appliedThinkingLevel: result.appliedThinkingLevel }),
    ...(result.providerMapping === undefined ? {} : { providerMapping: result.providerMapping }),
    ...(result.overridePresent === undefined ? {} : { overridePresent: result.overridePresent }),
    ...(result.overrideApplied === undefined ? {} : { overrideApplied: result.overrideApplied }),
    ...(result.overrideSource === undefined ? {} : { overrideSource: result.overrideSource }),
    ...(result.reasoningVisibility === undefined ? {} : { reasoningVisibility: result.reasoningVisibility }),
    ...(result.supportsSuppression === undefined ? {} : { supportsSuppression: result.supportsSuppression }),
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
    appliedThinkingSelection: cloneRuntimeThinkingSelection(basis.appliedThinkingSelection),
    reasoningVisibility: basis.reasoningVisibility,
    supportsSuppression: basis.supportsSuppression,
    capabilitySource: basis.capabilitySource,
    capabilitySeries: basis.capabilitySeries,
    ...(basis.appliedThinkingLevel === undefined ? {} : { appliedThinkingLevel: basis.appliedThinkingLevel }),
  }
}

function serializeRuntimeThinkingSelection(
  selection: RuntimeThinkingSelection | null | undefined,
): {
  series: string
  value: {
    valueType: 'code' | 'budget' | 'fixed'
    code?: string
    mode?: 'off' | 'dynamic' | 'budget'
    budgetTokens?: number | null
    labelZh?: string
  }
} | null {
  if (selection == null) {
    return null
  }

  const serializedValue = serializeRuntimeThinkingValue(selection)
  if (serializedValue === null) {
    return null
  }

  return {
    series: selection.series,
    value: serializedValue,
  }
}

function serializeRuntimeThinkingValue(
  selection: RuntimeThinkingSelection,
): {
  valueType: 'code' | 'budget' | 'fixed'
  code?: string
  mode?: 'off' | 'dynamic' | 'budget'
  budgetTokens?: number | null
  labelZh?: string
} | null {
  const directValue = (selection as RuntimeThinkingSelection & {
    value?: {
      valueType?: 'code' | 'budget' | 'fixed'
      code?: string
      mode?: 'off' | 'dynamic' | 'budget'
      budgetTokens?: number | null
      labelZh?: string
    }
  }).value

  if (isRuntimeThinkingValueRecord(directValue)) {
    return {
      valueType: directValue.valueType,
      ...(directValue.code === undefined ? {} : { code: directValue.code }),
      ...(directValue.mode === undefined ? {} : { mode: directValue.mode }),
      ...(directValue.budgetTokens === undefined ? {} : { budgetTokens: directValue.budgetTokens }),
      ...(directValue.labelZh === undefined ? {} : { labelZh: directValue.labelZh }),
    }
  }

  if (selection.mode === 'budget' && typeof selection.budgetTokens === 'number') {
    return {
      valueType: 'budget',
      mode: 'budget',
      budgetTokens: selection.budgetTokens,
    }
  }

  if (typeof selection.level === 'string' && selection.level.trim() !== '') {
    return {
      valueType: 'code',
      code: selection.level,
      labelZh: selection.level,
    }
  }

  return null
}

function isRuntimeThinkingValueRecord(
  value: unknown,
): value is {
  valueType: 'code' | 'budget' | 'fixed'
  code?: string
  mode?: 'off' | 'dynamic' | 'budget'
  budgetTokens?: number | null
  labelZh?: string
} {
  if (!value || typeof value !== 'object') {
    return false
  }

  const valueType = 'valueType' in value ? value.valueType : undefined
  return valueType === 'code' || valueType === 'budget' || valueType === 'fixed'
}

function throwMappedRuntimeTransportError(error: unknown): never {
  const runtimeTransportError = buildRuntimeTransportError(error)
  throw runtimeTransportError ?? error
}

function buildRuntimeTransportError(error: unknown): RuntimeRequestError | null {
  if (error instanceof RuntimeRequestError) {
    return error
  }

  if (!isRuntimeConnectivityFailure(error)) {
    return null
  }

  return new RuntimeRequestError(RUNTIME_CONNECTIVITY_ERROR_MESSAGE, {
    status: 0,
  })
}

function isRuntimeConnectivityFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  if (isAbortLikeError(error)) {
    return false
  }

  const normalizedMessage = error.message.trim().toLowerCase()
  return error instanceof TypeError
    || normalizedMessage.includes('failed to fetch')
    || normalizedMessage.includes('networkerror')
    || normalizedMessage.includes('load failed')
    || normalizedMessage.includes('cors')
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
