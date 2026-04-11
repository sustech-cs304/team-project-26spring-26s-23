import type { Dispatch, RefObject, SetStateAction } from 'react'

import type { AssistantSessionShell } from '../../workbench/types'
import {
  startRuntimeRun,
  streamRuntimeRun,
  type FetchLike,
  type RuntimeRunEvent,
  type RuntimeRunStartResponse,
} from './thread-run-contract'
import {
  buildRuntimeMessageSendInput,
  formatRequestOptionsError,
  formatRuntimeMessageSendError,
  parseRequestOptionsText,
  type CopilotChatComposerDraft,
  type RuntimeMessageSendInput,
} from './copilot-chat-helpers'
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
  createStartingCopilotRunState,
  markCopilotRunCancelled,
  markCopilotRunTransportFailed,
  registerCopilotRunStartResponse,
} from './run-segment-reducer'
import type {
  CopilotBootstrapState,
  CopilotRunState,
} from './types'

export { createIdleCopilotRunState } from './run-segment-reducer'

export interface CopilotMessageDispatchInput extends RuntimeMessageSendInput {
  debugModeEnabled?: boolean
  fetchFn?: FetchLike
  signal?: AbortSignal
  onRunStart?: (response: RuntimeRunStartResponse) => void
}

export async function* dispatchCopilotMessage(
  input: CopilotMessageDispatchInput,
): AsyncGenerator<RuntimeRunEvent> {
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

  input.onRunStart?.(runStartResponse)

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
}

export function getCopilotSendDisabledReason(input: {
  state: CopilotBootstrapState
  sessionShell: AssistantSessionShell | null
  runState: CopilotRunState
  composerDraft: CopilotChatComposerDraft
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
    return input.selectedModelOption.unavailableReason ?? '当前选择的模型不可用于聊天。'
  }

  if (!input.hasAvailableModels) {
    return '当前没有可用模型，请前往设置页调整模型配置。'
  }

  if (input.composerDraft.messageText.trim() === '') {
    return '请输入消息内容。'
  }

  if (input.composerDraft.selectedModelRoute === null || input.composerDraft.selectedModelId.trim() === '') {
    if (input.selectedModelOption !== null && !input.selectedModelOption.available) {
      return input.selectedModelOption.unavailableReason ?? '当前选择的模型不可用于聊天。'
    }

    return '请先选择模型。'
  }

  const streamingSupportReason = getRuntimeModelRouteStreamingSupportReason(input.composerDraft.selectedModelRoute)
  if (streamingSupportReason !== null) {
    return streamingSupportReason
  }

  return null
}

export async function orchestrateCopilotSend(input: {
  state: CopilotBootstrapState
  sessionShell: AssistantSessionShell | null
  composerDraft: CopilotChatComposerDraft
  runState: CopilotRunState
  hasConfiguredModels: boolean
  hasAvailableModels: boolean
  selectedModelOption: CopilotModelOption | null
  composerInputRef: RefObject<HTMLTextAreaElement>
  sendMessage: typeof dispatchCopilotMessage
  debugModeEnabled: boolean
  setRunState: Dispatch<SetStateAction<CopilotRunState>>
  setSendError: Dispatch<SetStateAction<string | null>>
  setComposerDraft: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  setConversation: Dispatch<SetStateAction<CopilotMessageListItem[]>>
  signal?: AbortSignal
  thinkingCapabilityOverride?: Record<string, unknown> | null
}) {
  if (!isCopilotConnectableState(input.state) || input.sessionShell === null) {
    return
  }

  if (input.runState.phase === 'starting' || input.runState.phase === 'streaming') {
    return
  }

  if (!input.hasConfiguredModels) {
    input.setSendError('尚未配置模型，请先前往设置页完成模型配置。')
    return
  }

  if (!input.hasAvailableModels && input.selectedModelOption !== null && !input.selectedModelOption.available) {
    input.setSendError(input.selectedModelOption.unavailableReason ?? '当前选择的模型不可用于聊天。')
    return
  }

  if (!input.hasAvailableModels) {
    input.setSendError('当前没有可用模型，请前往设置页调整模型配置。')
    return
  }

  const trimmedMessage = input.composerDraft.messageText.trim()
  if (trimmedMessage === '') {
    input.setSendError('请输入消息内容后再发送。')
    return
  }

  if (input.composerDraft.selectedModelRoute === null || input.composerDraft.selectedModelId.trim() === '') {
    if (input.selectedModelOption !== null && !input.selectedModelOption.available) {
      input.setSendError(input.selectedModelOption.unavailableReason ?? '当前选择的模型不可用于聊天。')
      return
    }

    input.setSendError('请先选择模型。')
    return
  }

  const streamingSupportReason = getRuntimeModelRouteStreamingSupportReason(input.composerDraft.selectedModelRoute)
  if (streamingSupportReason !== null) {
    input.setSendError(streamingSupportReason)
    return
  }

  let requestOptions: Record<string, unknown>
  try {
    requestOptions = parseRequestOptionsText(input.composerDraft.requestOptionsText)
  } catch (error) {
    input.setSendError(formatRequestOptionsError(error))
    return
  }

  let runtimeInput
  try {
    runtimeInput = buildRuntimeMessageSendInput({
      runtimeUrl: input.state.runtimeUrl,
      sessionShell: input.sessionShell,
      draft: {
        ...input.composerDraft,
        messageText: trimmedMessage,
      },
      requestOptions,
      thinkingCapabilityOverride: input.thinkingCapabilityOverride,
    })
  } catch (error) {
    input.setSendError(formatRuntimeMessageSendError(error))
    return
  }

  input.setConversation((current) => [
    ...current,
    ...buildCopilotRunSegmentViewModel(input.runState),
    createUserMessageListItem(trimmedMessage),
  ])
  input.setSendError(null)
  input.setRunState(createStartingCopilotRunState({
    threadId: input.sessionShell.sessionId,
    activeModelRoute: runtimeInput.modelRoute,
    requestOptions,
  }))
  input.setComposerDraft((current) => ({
    ...current,
    messageText: '',
  }))
  if (input.composerInputRef.current !== null) {
    input.composerInputRef.current.value = ''
  }

  try {
    for await (const event of input.sendMessage({
      ...runtimeInput,
      debugModeEnabled: input.debugModeEnabled,
      signal: input.signal,
      onRunStart: (response) => {
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
    if (isAbortError(error) || input.signal?.aborted === true) {
      input.setSendError(null)
      input.setRunState((current) => markCopilotRunCancelled(current, {
        reason: 'cancelled',
      }))
    } else {
      const formattedError = formatRuntimeMessageSendError(error)
      input.setSendError(null)
      input.setRunState((current) => markCopilotRunTransportFailed(current, {
        code: 'stream_transport_failed',
        message: formattedError,
        details: {},
      }))
    }
  } finally {
    requestAnimationFrame(() => {
      input.composerInputRef.current?.focus()
    })
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
}
