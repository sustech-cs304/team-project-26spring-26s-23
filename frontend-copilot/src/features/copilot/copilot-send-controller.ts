import type { Dispatch, RefObject, SetStateAction } from 'react'

import type { AssistantSessionShell } from '../../workbench/types'
import { sendRuntimeMessage, type RuntimeModelRoute } from './chat-contract'
import {
  appendAssistantDelta,
  buildRuntimeMessageSendInput,
  cancelAssistantTurn,
  completeAssistantTurn,
  createPendingAssistantTurn,
  createUserTurn,
  failAssistantTurn,
  formatRequestOptionsError,
  formatRuntimeMessageSendError,
  parseRequestOptionsText,
  type CopilotChatComposerDraft,
  type CopilotConversationTurn,
} from './copilot-chat-helpers'
import { getRuntimeModelRouteStreamingSupportReason } from './model-picker'
import { isCopilotConnectableState } from './copilot-panel-diagnostics'
import type {
  CopilotBootstrapState,
  CopilotRunDiagnosticSummary,
  CopilotRunState,
} from './types'

export function createIdleCopilotRunState(): CopilotRunState {
  return {
    phase: 'idle',
    runId: null,
    sessionId: null,
    assistantMessageId: null,
    activeModelRoute: null,
    resolvedModelId: null,
    resolvedModelRoute: null,
    resolvedToolIds: [],
    requestOptions: {},
    diagnostic: null,
    failure: null,
    cancelReason: null,
  }
}

export function getCopilotSendDisabledReason(input: {
  state: CopilotBootstrapState
  sessionShell: AssistantSessionShell | null
  runState: CopilotRunState
  composerDraft: CopilotChatComposerDraft
  hasAvailableModels: boolean
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

  if (!input.hasAvailableModels) {
    return '尚未配置模型，请先前往设置页添加模型服务商和模型。'
  }

  if (input.composerDraft.messageText.trim() === '') {
    return '请输入消息内容。'
  }

  if (input.composerDraft.selectedModelRoute === null || input.composerDraft.selectedModelId.trim() === '') {
    return '请先选择本次发送要使用的模型路由。'
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
  hasAvailableModels: boolean
  composerInputRef: RefObject<HTMLTextAreaElement>
  sendMessage: typeof sendRuntimeMessage
  setRunState: Dispatch<SetStateAction<CopilotRunState>>
  setSendError: Dispatch<SetStateAction<string | null>>
  setComposerDraft: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  setConversation: Dispatch<SetStateAction<CopilotConversationTurn[]>>
  signal?: AbortSignal
}) {
  if (!isCopilotConnectableState(input.state) || input.sessionShell === null) {
    return
  }

  if (input.runState.phase === 'starting' || input.runState.phase === 'streaming') {
    return
  }

  if (!input.hasAvailableModels) {
    input.setSendError('尚未配置模型，请先前往设置页添加模型服务商和模型。')
    return
  }

  const trimmedMessage = input.composerDraft.messageText.trim()
  if (trimmedMessage === '') {
    input.setSendError('请输入消息内容后再发送。')
    return
  }

  if (input.composerDraft.selectedModelRoute === null || input.composerDraft.selectedModelId.trim() === '') {
    input.setSendError('请先选择本次发送要使用的模型路由。')
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
    })
  } catch (error) {
    input.setSendError(formatRuntimeMessageSendError(error))
    return
  }

  input.setConversation((current) => [...current, createUserTurn(trimmedMessage)])
  input.setSendError(null)
  input.setRunState({
    ...createIdleCopilotRunState(),
    phase: 'starting',
    sessionId: input.sessionShell.sessionId,
    activeModelRoute: cloneRuntimeModelRoute(runtimeInput.modelRoute),
    requestOptions: { ...requestOptions },
  })
  input.setComposerDraft((current) => ({
    ...current,
    messageText: '',
  }))
  if (input.composerInputRef.current !== null) {
    input.composerInputRef.current.value = ''
  }

  let assistantMessageId: string | null = null
  let diagnostic: CopilotRunDiagnosticSummary | null = null
  let didReachTerminal = false

  try {
    for await (const event of input.sendMessage({
      ...runtimeInput,
      signal: input.signal,
    })) {
      switch (event.type) {
        case 'run_started': {
          const nextAssistantMessageId = event.payload.assistantMessageId
          assistantMessageId = nextAssistantMessageId
          input.setRunState((current) => ({
            ...current,
            phase: 'streaming',
            runId: event.runId,
            sessionId: event.sessionId,
            assistantMessageId: nextAssistantMessageId,
          }))
          input.setConversation((current) => [
            ...current,
            createPendingAssistantTurn({
              assistantMessageId: nextAssistantMessageId,
              diagnostic,
            }),
          ])
          break
        }
        case 'text_delta': {
          const nextAssistantMessageId = event.payload.assistantMessageId
          assistantMessageId = nextAssistantMessageId
          input.setConversation((current) => appendAssistantDelta(current, {
            assistantMessageId: nextAssistantMessageId,
            delta: event.payload.delta,
          }))
          break
        }
        case 'run_diagnostic': {
          diagnostic = {
            code: event.payload.code,
            message: event.payload.message,
            stage: event.payload.stage,
            details: { ...event.payload.details },
          }
          input.setRunState((current) => ({
            ...current,
            diagnostic,
            runId: event.runId,
            sessionId: event.sessionId,
          }))
          break
        }
        case 'run_completed': {
          assistantMessageId = event.payload.assistantMessageId
          didReachTerminal = true
          input.setConversation((current) => completeAssistantTurn(current, event, diagnostic))
          input.setRunState((current) => ({
            ...current,
            phase: 'completed',
            runId: event.runId,
            sessionId: event.sessionId,
            assistantMessageId,
            resolvedModelId: event.payload.resolvedModelId,
            resolvedModelRoute: cloneRuntimeModelRoute(event.payload.resolvedModelRoute),
            resolvedToolIds: [...event.payload.resolvedToolIds],
            requestOptions: { ...event.payload.requestOptions },
            diagnostic,
            failure: null,
            cancelReason: null,
          }))
          break
        }
        case 'run_failed': {
          didReachTerminal = true
          const failureMessage = `${event.payload.code}: ${event.payload.message}`
          input.setSendError(failureMessage)
          input.setConversation((current) => failAssistantTurn(current, {
            assistantMessageId,
            content: failureMessage,
            diagnostic,
          }))
          input.setRunState((current) => ({
            ...current,
            phase: 'failed',
            runId: event.runId,
            sessionId: event.sessionId,
            assistantMessageId,
            diagnostic,
            failure: {
              code: event.payload.code,
              message: event.payload.message,
              details: { ...event.payload.details },
            },
            cancelReason: null,
          }))
          break
        }
        case 'run_cancelled': {
          assistantMessageId = event.payload.assistantMessageId
          didReachTerminal = true
          input.setConversation((current) => cancelAssistantTurn(current, {
            assistantMessageId,
            reason: event.payload.reason,
            diagnostic,
          }))
          input.setRunState((current) => ({
            ...current,
            phase: 'cancelled',
            runId: event.runId,
            sessionId: event.sessionId,
            assistantMessageId,
            diagnostic,
            failure: null,
            cancelReason: event.payload.reason,
          }))
          break
        }
        case 'tool_event_reserved': {
          break
        }
      }
    }
  } catch (error) {
    if (isAbortError(error) || input.signal?.aborted === true) {
      input.setSendError(null)
      input.setConversation((current) => cancelAssistantTurn(current, {
        assistantMessageId,
        reason: 'cancelled',
        diagnostic,
      }))
      input.setRunState((current) => ({
        ...current,
        phase: 'cancelled',
        assistantMessageId,
        diagnostic,
        failure: null,
        cancelReason: 'cancelled',
      }))
    } else {
      const formattedError = formatRuntimeMessageSendError(error)
      input.setSendError(formattedError)
      input.setConversation((current) => failAssistantTurn(current, {
        assistantMessageId,
        content: formattedError,
        diagnostic,
      }))
      input.setRunState((current) => ({
        ...current,
        phase: 'failed',
        assistantMessageId,
        diagnostic,
        failure: {
          code: 'stream_transport_failed',
          message: formattedError,
          details: {},
        },
        cancelReason: null,
      }))
    }
  } finally {
    if (!didReachTerminal) {
      input.setRunState((current) => {
        if (current.phase === 'starting' || current.phase === 'streaming') {
          return {
            ...current,
            phase: current.cancelReason !== null ? 'cancelled' : current.failure !== null ? 'failed' : current.phase,
          }
        }
        return current
      })
    }
    requestAnimationFrame(() => {
      input.composerInputRef.current?.focus()
    })
  }
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

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
}
