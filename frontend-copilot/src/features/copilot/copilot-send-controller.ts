import type { Dispatch, RefObject, SetStateAction } from 'react'

import type { SettingsWorkspaceToolPermissionPolicyState } from '../../../electron/settings-workspace/schema'
import type { AssistantSessionShell } from '../../workbench/types'
import type { CopilotComposerAttachment } from './attachments/types'
import {
  RuntimeRequestError,
  startRuntimeRun,
  streamRuntimeRun,
  type FetchLike,
  type RuntimeRunEvent,
  type RuntimeRunStartResponse,
} from './thread-run-contract'
import {
  buildComposerMessageContentWithAttachments,
  buildRuntimeMessageSendInput,
  createCopilotTransientErrorState,
  createPreflightErrorDetail,
  createRuntimeRequestErrorDetail,
  formatRequestOptionsError,
  formatRuntimeMessageSendError,
  parseRequestOptionsText,
  type CopilotChatComposerDraft,
  type CopilotTransientErrorState,
  type RuntimeMessageSendInput,
} from './copilot-chat-helpers'
import { createCopilotErrorDetailSource } from './error-detail-overlay-view-model'
import {
  buildCopilotRunSegmentViewModel,
  createUserMessageListItem,
  type CopilotMessageListItem,
} from './run-segment-view-model'
import {
  getRuntimeModelRouteStreamingSupportReason,
  type CopilotModelOption,
} from './model-picker'
import { isCopilotConnectableState } from './copilot-panel-diagnostics'
import {
  applyRuntimeRunEventToCopilotRunState,
  createIdleCopilotRunState,
  createStartingCopilotRunState,
  markCopilotRunCancelled,
  markCopilotRunTransportFailed,
  registerCopilotRunStartResponse,
} from './run-segment-reducer'
import { appendCopilotDebugLog } from './debug-mode-log'
import type {
  CopilotBootstrapState,
  CopilotRunState,
} from './types'

export { createIdleCopilotRunState } from './run-segment-reducer'

const DEBUG_LOG_CATEGORY = 'copilot-send-controller'
const MODEL_UNAVAILABLE_MESSAGE = '当前选择的模型不可用于聊天。'

export interface CopilotMessageDispatchInput extends RuntimeMessageSendInput {
  debugModeEnabled?: boolean
  fetchFn?: FetchLike
  signal?: AbortSignal
  onRunStart?: (response: RuntimeRunStartResponse) => void
}

export async function* dispatchCopilotMessage(
  input: CopilotMessageDispatchInput,
): AsyncGenerator<RuntimeRunEvent> {
  const debugModeEnabled = input.debugModeEnabled === true
  appendCopilotDebugLog(debugModeEnabled, DEBUG_LOG_CATEGORY, 'runtime-run-start-requested', {
    sessionId: input.sessionId,
    enabledTools: [...input.enabledTools],
    toolPermissionPolicy: input.toolPermissionPolicy ?? null,
    requestOptions: input.requestOptions,
  })
  const runStartResponse = await startRuntimeRun({
    runtimeUrl: input.runtimeUrl,
    threadId: input.sessionId,
    agent: input.agent,
    message: input.message,
    modelRoute: input.modelRoute,
    thinkingSelection: input.thinkingSelection,
    thinkingCapabilityOverride: input.thinkingCapabilityOverride,
    enabledTools: input.enabledTools,
    toolPermissionPolicy: input.toolPermissionPolicy,
    debugModeEnabled: input.debugModeEnabled,
    requestOptions: input.requestOptions,
    fetchFn: input.fetchFn,
    signal: input.signal,
  })

  appendCopilotDebugLog(debugModeEnabled, DEBUG_LOG_CATEGORY, 'runtime-run-start-succeeded', {
    sessionId: input.sessionId,
    runId: runStartResponse.run.runId,
    status: runStartResponse.run.status,
  })

  input.onRunStart?.(runStartResponse)

  let sawTerminalEvent = false
  let lastEventType: RuntimeRunEvent['type'] | null = null
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

    lastEventType = event.type
    if (event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled') {
      sawTerminalEvent = true
    }

    appendCopilotDebugLog(debugModeEnabled, DEBUG_LOG_CATEGORY, 'runtime-stream-event-received',
      summarizeRuntimeRunEventForDebug(event),
    )

    yield event
  }

  appendCopilotDebugLog(debugModeEnabled, DEBUG_LOG_CATEGORY, 'runtime-stream-ended', {
    sessionId: input.sessionId,
    runId: runStartResponse.run.runId,
    sawTerminalEvent,
    lastEventType,
  })
}

export function getCopilotSendDisabledReason(input: {
  state: CopilotBootstrapState
  sessionShell: AssistantSessionShell | null
  runState: CopilotRunState
  composerDraft: CopilotChatComposerDraft
  hasAttachments?: boolean
  hasConfiguredModels: boolean
  hasAvailableModels: boolean
  selectedModelOption: CopilotModelOption | null
}): string | null {
  return getSendDisabledReasonChain(input)
}

// eslint-disable-next-line complexity -- same logic as original getCopilotSendDisabledReason, guard clause chain
function getSendDisabledReasonChain(input: {
  state: CopilotBootstrapState
  sessionShell: AssistantSessionShell | null
  runState: CopilotRunState
  composerDraft: CopilotChatComposerDraft
  hasAttachments?: boolean
  hasConfiguredModels: boolean
  hasAvailableModels: boolean
  selectedModelOption: CopilotModelOption | null
}): string | null {
  if (!isCopilotConnectableState(input.state)) {
    return '当前运行态未就绪，无法发送消息。'
  }

  if (input.sessionShell === null) {
    return '请先创建会话。'
  }

  if (input.runState.phase === 'starting' || input.runState.phase === 'streaming') {
    return '当前消息仍在发送中。'
  }

  if (!input.hasConfiguredModels) {
    return '尚未配置模型，请先前往设置页完成模型配置。'
  }

  if (!input.hasAvailableModels && input.selectedModelOption !== null && !input.selectedModelOption.available) {
    return input.selectedModelOption.unavailableReason ?? MODEL_UNAVAILABLE_MESSAGE
  }

  if (!input.hasAvailableModels) {
    return '当前没有可用模型，请前往设置页调整模型配置。'
  }

  if (input.composerDraft.messageText.trim() === '' && input.hasAttachments !== true) {
    return '请输入消息内容。'
  }

  if (input.composerDraft.selectedModelRoute === null || input.composerDraft.selectedModelId.trim() === '') {
    if (input.selectedModelOption !== null && !input.selectedModelOption.available) {
      return input.selectedModelOption.unavailableReason ?? MODEL_UNAVAILABLE_MESSAGE
    }

    return '请先选择模型。'
  }

  const streamingSupportReason = getRuntimeModelRouteStreamingSupportReason(input.composerDraft.selectedModelRoute)
  if (streamingSupportReason !== null) {
    return streamingSupportReason
  }

  return null
}

function summarizeRuntimeRunEventForDebug(event: RuntimeRunEvent): Record<string, unknown> {
  switch (event.type) {
    case 'run_started':
      return summarizeRunStartedForDebug(event)
    case 'run_completed':
      return summarizeRunCompletedForDebug(event)
    case 'run_failed':
      return summarizeRunFailedForDebug(event)
    case 'run_cancelled':
      return summarizeRunCancelledForDebug(event)
    case 'tool_event':
      return summarizeToolEventForDebug(event)
    case 'run_diagnostic':
      return summarizeRunDiagnosticForDebug(event)
    case 'text_delta':
    case 'reasoning_delta':
      return summarizeDeltaForDebug(event)
    case 'run_metadata':
      return summarizeRunMetadataForDebug(event)
  }
}

type RunStartedLike = RuntimeRunEvent & { type: 'run_started' }
type RunCompletedLike = RuntimeRunEvent & { type: 'run_completed' }
type RunFailedLike = RuntimeRunEvent & { type: 'run_failed' }
type RunCancelledLike = RuntimeRunEvent & { type: 'run_cancelled' }
type ToolEventLike = RuntimeRunEvent & { type: 'tool_event' }
type RunDiagnosticLike = RuntimeRunEvent & { type: 'run_diagnostic' }
type DeltaLike = RuntimeRunEvent & { type: 'text_delta' | 'reasoning_delta' }
type RunMetadataLike = RuntimeRunEvent & { type: 'run_metadata' }

function summarizeRunStartedForDebug(event: RunStartedLike): Record<string, unknown> {
  return {
    runId: event.runId,
    type: event.type,
    assistantMessageId: event.payload.assistantMessageId,
  }
}

function summarizeRunCompletedForDebug(event: RunCompletedLike): Record<string, unknown> {
  return {
    runId: event.runId,
    type: event.type,
    assistantMessageId: event.payload.assistantMessageId,
    resolvedToolIds: [...event.payload.resolvedToolIds],
  }
}

function summarizeRunFailedForDebug(event: RunFailedLike): Record<string, unknown> {
  return {
    runId: event.runId,
    type: event.type,
    code: event.payload.code,
    message: event.payload.message,
  }
}

function summarizeRunCancelledForDebug(event: RunCancelledLike): Record<string, unknown> {
  return {
    runId: event.runId,
    type: event.type,
    reason: event.payload.reason,
  }
}

function summarizeToolEventForDebug(event: ToolEventLike): Record<string, unknown> {
  return {
    runId: event.runId,
    type: event.type,
    toolCallId: event.payload.toolCallId,
    toolId: event.payload.toolId,
    phase: event.payload.phase,
    approval: event.payload.approval ?? null,
    errorSummary: event.payload.errorSummary ?? null,
  }
}

function summarizeRunDiagnosticForDebug(event: RunDiagnosticLike): Record<string, unknown> {
  return {
    runId: event.runId,
    type: event.type,
    code: event.payload.code,
    stage: event.payload.stage ?? null,
  }
}

function summarizeDeltaForDebug(event: DeltaLike): Record<string, unknown> {
  return {
    runId: event.runId,
    type: event.type,
    textDeltaLength: event.payload.delta.length,
  }
}

function summarizeRunMetadataForDebug(event: RunMetadataLike): Record<string, unknown> {
  return {
    runId: event.runId,
    type: event.type,
    requestedThinkingSelection: event.payload.requestedThinkingSelection ?? null,
    appliedThinkingSelection: event.payload.appliedThinkingSelection ?? null,
    requestedThinkingLevel: event.payload.requestedThinkingLevel ?? null,
    appliedThinkingLevel: event.payload.appliedThinkingLevel ?? null,
    thinkingCapabilitySnapshot: event.payload.thinkingCapabilitySnapshot ?? null,
    reasoningSuppressionBasis: event.payload.reasoningSuppressionBasis ?? null,
  }
}

function createPreflightTransientErrorState(input: {
  message: string
  code?: string | null
  rawMessage?: string | null
  details?: Record<string, unknown> | null
  composerDraft: Pick<CopilotChatComposerDraft, 'selectedModelId' | 'selectedModelRoute' | 'enabledTools'>
  selectedModelOption: CopilotModelOption | null
  requestOptions?: Record<string, unknown> | null
}): CopilotTransientErrorState {
  return createCopilotTransientErrorState({
    message: input.message,
    errorDetail: createPreflightErrorDetail({
      summaryMessage: input.message,
      rawMessage: input.rawMessage ?? input.message,
      code: input.code ?? null,
      details: input.details ?? {},
      resolvedModelId: resolveSelectedModelId({
        selectedModelOption: input.selectedModelOption,
        selectedModelId: input.composerDraft.selectedModelId,
        selectedModelRoute: input.composerDraft.selectedModelRoute,
      }),
      resolvedModelRoute: input.composerDraft.selectedModelRoute,
      resolvedToolIds: input.composerDraft.enabledTools,
      requestOptions: input.requestOptions ?? {},
    }),
  })
}

function createRunStartTransientErrorState(input: {
  error: unknown
  runtimeInput: RuntimeMessageSendInput
  selectedModelOption: CopilotModelOption | null
}): CopilotTransientErrorState {
  const summaryMessage = formatRuntimeMessageSendError(input.error)
  const rawMessage = input.error instanceof Error ? input.error.message : String(input.error)
  const resolvedModelId = resolveSelectedModelId({
    selectedModelOption: input.selectedModelOption,
    selectedModelId: '',
    selectedModelRoute: input.runtimeInput.modelRoute,
  })

  return createCopilotTransientErrorState({
    message: summaryMessage,
    errorDetail: input.error instanceof RuntimeRequestError
      ? createRuntimeRequestErrorDetail({
          error: input.error,
          stage: 'run-start',
          requestedMethod: 'run/start',
          resolvedModelId,
          resolvedModelRoute: input.runtimeInput.modelRoute,
          resolvedToolIds: input.runtimeInput.enabledTools,
          requestOptions: input.runtimeInput.requestOptions,
        })
      : createCopilotErrorDetailSource({
          source: 'run-start',
          title: '发送失败',
          summaryMessage,
          rawMessage,
          stage: 'run-start',
          requestedMethod: 'run/start',
          details: {},
          resolvedModelId,
          resolvedModelRoute: input.runtimeInput.modelRoute,
          resolvedToolIds: input.runtimeInput.enabledTools,
          requestOptions: input.runtimeInput.requestOptions,
        }),
  })
}

function createTransportFailureInput(error: unknown): {
  code: string
  message: string
  details: Record<string, unknown>
} {
  if (error instanceof RuntimeRequestError) {
    return {
      code: error.code ?? 'stream_transport_failed',
      message: error.message,
      details: { ...error.details },
    }
  }

  return {
    code: 'stream_transport_failed',
    message: error instanceof Error ? error.message : String(error),
    details: {},
  }
}

function resolveSelectedModelId(input: {
  selectedModelOption: CopilotModelOption | null
  selectedModelId: string
  selectedModelRoute: RuntimeMessageSendInput['modelRoute'] | CopilotChatComposerDraft['selectedModelRoute'] | null
}): string | null {
  const fallbackModelId = input.selectedModelId.trim()
  const resolvedModelId = input.selectedModelOption?.modelId
    ?? input.selectedModelRoute?.routeRef?.modelId
    ?? fallbackModelId

  return resolvedModelId === '' ? null : resolvedModelId
}

export async function orchestrateCopilotSend(input: {
  state: CopilotBootstrapState
  sessionShell: AssistantSessionShell | null
  composerDraft: CopilotChatComposerDraft
  attachments?: readonly CopilotComposerAttachment[]
  runState: CopilotRunState
  hasConfiguredModels: boolean
  hasAvailableModels: boolean
  selectedModelOption: CopilotModelOption | null
  composerInputRef: RefObject<HTMLTextAreaElement>
  sendMessage: typeof dispatchCopilotMessage
  debugModeEnabled: boolean
  setRunState: Dispatch<SetStateAction<CopilotRunState>>
  setSendError: Dispatch<SetStateAction<CopilotTransientErrorState | null>>
  setComposerDraft: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  setConversation: Dispatch<SetStateAction<CopilotMessageListItem[]>>
  signal?: AbortSignal
  thinkingCapabilityOverride?: Record<string, unknown> | null
  toolPermissionPolicy?: SettingsWorkspaceToolPermissionPolicyState | null
  messageOverride?: {
    content: string
    structuredPayload?: Record<string, unknown> | null
  }
  clearComposerOnSend?: boolean
}) {
  if (!isCopilotConnectableState(input.state) || input.sessionShell === null) {
    return
  }

  if (input.runState.phase === 'starting' || input.runState.phase === 'streaming') {
    return
  }

  const preflightResult = validateCopilotSendPreflight({
    hasConfiguredModels: input.hasConfiguredModels,
    hasAvailableModels: input.hasAvailableModels,
    selectedModelOption: input.selectedModelOption,
    composerDraft: input.composerDraft,
    attachments: input.attachments,
    messageOverride: input.messageOverride,
    setSendError: input.setSendError,
  })

  if (!preflightResult.ok) {
    return
  }

  const { trimmedMessage, requestOptions } = preflightResult

  let runtimeInput: RuntimeMessageSendInput
  try {
    runtimeInput = buildRuntimeMessageSendInput({
      runtimeUrl: input.state.runtimeUrl,
      sessionShell: input.sessionShell,
      draft: {
        ...input.composerDraft,
        messageText: trimmedMessage,
      },
      attachments: input.attachments,
      requestOptions,
      structuredPayload: input.messageOverride?.structuredPayload,
      toolPermissionPolicy: input.toolPermissionPolicy,
      thinkingCapabilityOverride: input.thinkingCapabilityOverride,
    })
  } catch (error) {
    input.setSendError(createPreflightTransientErrorState({
      message: formatRuntimeMessageSendError(error),
      code: 'build_runtime_input_failed',
      rawMessage: error instanceof Error ? error.message : String(error),
      composerDraft: input.composerDraft,
      selectedModelOption: input.selectedModelOption,
      requestOptions,
    }))
    return
  }

  commitSendState({
    setConversation: input.setConversation,
    runState: input.runState,
    setSendError: input.setSendError,
    setRunState: input.setRunState,
    sessionId: input.sessionShell.sessionId,
    runtimeInput,
    trimmedMessage,
    attachments: input.attachments ?? [],
    requestOptions,
    clearComposerOnSend: input.clearComposerOnSend,
    setComposerDraft: input.setComposerDraft,
    composerInputRef: input.composerInputRef,
  })

  let runStarted = false

  try {
    for await (const event of input.sendMessage({
      ...runtimeInput,
      debugModeEnabled: input.debugModeEnabled,
      signal: input.signal,
      onRunStart: (response) => {
        runStarted = true
        input.setRunState((current) => registerCopilotRunStartResponse(current, response.run))
      },
    })) {
      if (
        event.type === 'run_failed'
        || event.type === 'run_completed'
        || event.type === 'run_cancelled'
      ) {
        input.setSendError(null)
      }

      input.setRunState((current) => applyRuntimeRunEventToCopilotRunState(current, event))
    }
  } catch (error) {
    handleSendError({
      error,
      signal: input.signal,
      runStarted,
      setSendError: input.setSendError,
      setRunState: input.setRunState,
      runtimeInput,
      selectedModelOption: input.selectedModelOption,
    })
  } finally {
    requestAnimationFrame(() => {
      input.composerInputRef.current?.focus()
    })
  }
}

function commitSendState(input: {
  setConversation: Dispatch<SetStateAction<CopilotMessageListItem[]>>
  runState: CopilotRunState
  setSendError: Dispatch<SetStateAction<CopilotTransientErrorState | null>>
  setRunState: Dispatch<SetStateAction<CopilotRunState>>
  sessionId: string
  runtimeInput: RuntimeMessageSendInput
  trimmedMessage: string
  attachments: readonly CopilotComposerAttachment[]
  requestOptions: Record<string, unknown>
  clearComposerOnSend?: boolean
  setComposerDraft: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  composerInputRef: RefObject<HTMLTextAreaElement>
}) {
  input.setConversation((current) => [
    ...current,
    ...buildCopilotRunSegmentViewModel(input.runState),
    createUserMessageListItem({
      content: buildComposerMessageContentWithAttachments(input.trimmedMessage, input.attachments),
      structuredPayload: input.runtimeInput.message.structuredPayload ?? null,
    }),
  ])
  input.setSendError(null)
  input.setRunState(createStartingCopilotRunState({
    threadId: input.sessionId,
    activeModelRoute: input.runtimeInput.modelRoute,
    requestOptions: input.requestOptions,
  }))
  if (input.clearComposerOnSend !== false) {
    input.setComposerDraft((current) => ({
      ...current,
      messageText: '',
    }))
    if (input.composerInputRef.current !== null) {
      input.composerInputRef.current.value = ''
    }
  }
}

function handleSendError(input: {
  error: unknown
  signal?: AbortSignal
  runStarted: boolean
  setSendError: Dispatch<SetStateAction<CopilotTransientErrorState | null>>
  setRunState: Dispatch<SetStateAction<CopilotRunState>>
  runtimeInput: RuntimeMessageSendInput
  selectedModelOption: CopilotModelOption | null
}) {
  if (isAbortError(input.error) || input.signal?.aborted === true) {
    input.setSendError(null)
    input.setRunState((current) => markCopilotRunCancelled(current, {
      reason: 'cancelled',
    }))
  } else if (!input.runStarted) {
    input.setSendError(createRunStartTransientErrorState({
      error: input.error,
      runtimeInput: input.runtimeInput,
      selectedModelOption: input.selectedModelOption,
    }))
    input.setRunState(createIdleCopilotRunState())
  } else {
    input.setSendError(null)
    input.setRunState((current) => markCopilotRunTransportFailed(current, createTransportFailureInput(input.error)))
  }
}

interface SendPreflightInput {
  hasConfiguredModels: boolean
  hasAvailableModels: boolean
  selectedModelOption: CopilotModelOption | null
  composerDraft: CopilotChatComposerDraft
  attachments?: readonly CopilotComposerAttachment[]
  messageOverride?: { content: string }
  setSendError: Dispatch<SetStateAction<CopilotTransientErrorState | null>>
}

function validateCopilotSendPreflight(input: SendPreflightInput):
  | { ok: true; trimmedMessage: string; requestOptions: Record<string, unknown> }
  | { ok: false } {
  if (checkPreflightConfiguredModels(input)) return { ok: false }
  if (checkPreflightSpecificModelUnavailable(input)) return { ok: false }
  if (checkPreflightNoAvailableModels(input)) return { ok: false }

  const trimmedMessage = (input.messageOverride?.content ?? input.composerDraft.messageText).trim()
  if (trimmedMessage === '' && (input.attachments?.length ?? 0) === 0) {
    input.setSendError(createPreflightTransientErrorState({
      message: '请输入消息内容后再发送。',
      code: 'message_required',
      details: { field: 'messageText' },
      composerDraft: input.composerDraft,
      selectedModelOption: input.selectedModelOption,
    }))
    return { ok: false }
  }

  if (checkPreflightModelRequired(input)) return { ok: false }
  if (checkPreflightStreamingSupport(input)) return { ok: false }

  let requestOptions: Record<string, unknown>
  try {
    requestOptions = parseRequestOptionsText(input.composerDraft.requestOptionsText)
  } catch (error) {
    input.setSendError(createPreflightTransientErrorState({
      message: formatRequestOptionsError(error),
      code: 'request_options_invalid',
      rawMessage: error instanceof Error ? error.message : String(error),
      details: { requestOptionsText: input.composerDraft.requestOptionsText },
      composerDraft: input.composerDraft,
      selectedModelOption: input.selectedModelOption,
    }))
    return { ok: false }
  }

  return { ok: true, trimmedMessage, requestOptions }
}

function checkPreflightConfiguredModels(input: SendPreflightInput): boolean {
  if (!input.hasConfiguredModels) {
    input.setSendError(createPreflightTransientErrorState({
      message: '尚未配置模型，请先前往设置页完成模型配置。',
      code: 'no_configured_models',
      details: { hasConfiguredModels: false },
      composerDraft: input.composerDraft,
      selectedModelOption: input.selectedModelOption,
    }))
    return true
  }
  return false
}

function checkPreflightSpecificModelUnavailable(input: SendPreflightInput): boolean {
  if (!input.hasAvailableModels && input.selectedModelOption !== null && !input.selectedModelOption.available) {
    input.setSendError(createPreflightTransientErrorState({
      message: input.selectedModelOption.unavailableReason ?? MODEL_UNAVAILABLE_MESSAGE,
      code: 'selected_model_unavailable',
      details: {
        selectedModelId: input.selectedModelOption.modelId,
        unavailableReason: input.selectedModelOption.unavailableReason,
      },
      composerDraft: input.composerDraft,
      selectedModelOption: input.selectedModelOption,
    }))
    return true
  }
  return false
}

function checkPreflightNoAvailableModels(input: SendPreflightInput): boolean {
  if (!input.hasAvailableModels) {
    input.setSendError(createPreflightTransientErrorState({
      message: '当前没有可用模型，请前往设置页调整模型配置。',
      code: 'no_available_models',
      details: { hasAvailableModels: false },
      composerDraft: input.composerDraft,
      selectedModelOption: input.selectedModelOption,
    }))
    return true
  }
  return false
}

function checkPreflightModelRequired(input: SendPreflightInput): boolean {
  if (input.composerDraft.selectedModelRoute === null || input.composerDraft.selectedModelId.trim() === '') {
    if (input.selectedModelOption !== null && !input.selectedModelOption.available) {
      input.setSendError(createPreflightTransientErrorState({
        message: input.selectedModelOption.unavailableReason ?? MODEL_UNAVAILABLE_MESSAGE,
        code: 'selected_model_unavailable',
        details: {
          selectedModelId: input.selectedModelOption.modelId,
          unavailableReason: input.selectedModelOption.unavailableReason,
        },
        composerDraft: input.composerDraft,
        selectedModelOption: input.selectedModelOption,
      }))
      return true
    }

    input.setSendError(createPreflightTransientErrorState({
      message: '请先选择模型。',
      code: 'model_required',
      details: { field: 'selectedModelRoute' },
      composerDraft: input.composerDraft,
      selectedModelOption: input.selectedModelOption,
    }))
    return true
  }
  return false
}

function checkPreflightStreamingSupport(input: SendPreflightInput): boolean {
  const streamingSupportReason = getRuntimeModelRouteStreamingSupportReason(input.composerDraft.selectedModelRoute)
  if (streamingSupportReason !== null) {
    input.setSendError(createPreflightTransientErrorState({
      message: streamingSupportReason,
      code: 'streaming_not_supported',
      details: { reason: streamingSupportReason },
      composerDraft: input.composerDraft,
      selectedModelOption: input.selectedModelOption,
    }))
    return true
  }
  return false
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
}
