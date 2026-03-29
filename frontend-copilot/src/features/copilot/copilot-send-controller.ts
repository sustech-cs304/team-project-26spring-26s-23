import type { Dispatch, RefObject, SetStateAction } from 'react'

import type { AssistantSessionShell } from '../../workbench/types'
import { sendRuntimeMessage } from './chat-contract'
import {
  buildRuntimeMessageSendInput,
  createAssistantTurn,
  createErrorTurn,
  createUserTurn,
  formatRequestOptionsError,
  formatRuntimeMessageSendError,
  parseRequestOptionsText,
  type CopilotChatComposerDraft,
  type CopilotConversationTurn,
} from './copilot-chat-helpers'
import { isCopilotConnectableState } from './copilot-panel-diagnostics'
import type { CopilotBootstrapState } from './types'

export function getCopilotSendDisabledReason(input: {
  state: CopilotBootstrapState
  sessionShell: AssistantSessionShell | null
  sendStatus: 'idle' | 'sending'
  composerDraft: CopilotChatComposerDraft
}): string | null {
  if (!isCopilotConnectableState(input.state)) {
    return '当前运行态未就绪，无法发送消息。'
  }

  if (input.sessionShell === null) {
    return '请先创建会话。'
  }

  if (input.sendStatus === 'sending') {
    return '当前消息仍在发送中。'
  }

  if (input.composerDraft.messageText.trim() === '') {
    return '请输入消息内容。'
  }

  if (input.composerDraft.model.trim() === '') {
    return '请提供本次发送要使用的模型 ID。'
  }

  return null
}

export async function orchestrateCopilotSend(input: {
  state: CopilotBootstrapState
  sessionShell: AssistantSessionShell | null
  composerDraft: CopilotChatComposerDraft
  sendStatus: 'idle' | 'sending'
  composerInputRef: RefObject<HTMLTextAreaElement>
  sendMessage: typeof sendRuntimeMessage
  setSendStatus: Dispatch<SetStateAction<'idle' | 'sending'>>
  setSendError: Dispatch<SetStateAction<string | null>>
  setComposerDraft: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  setConversation: Dispatch<SetStateAction<CopilotConversationTurn[]>>
}) {
  if (!isCopilotConnectableState(input.state) || input.sessionShell === null || input.sendStatus === 'sending') {
    return
  }

  const trimmedMessage = input.composerDraft.messageText.trim()
  if (trimmedMessage === '') {
    input.setSendError('请输入消息内容后再发送。')
    return
  }

  if (input.composerDraft.model.trim() === '') {
    input.setSendError('请提供本次发送要使用的模型 ID。')
    return
  }

  let requestOptions: Record<string, unknown>
  try {
    requestOptions = parseRequestOptionsText(input.composerDraft.requestOptionsText)
  } catch (error) {
    input.setSendError(formatRequestOptionsError(error))
    return
  }

  const runtimeInput = buildRuntimeMessageSendInput({
    runtimeUrl: input.state.runtimeUrl,
    sessionShell: input.sessionShell,
    draft: {
      ...input.composerDraft,
      messageText: trimmedMessage,
    },
    requestOptions,
  })

  input.setSendStatus('sending')
  input.setSendError(null)
  input.setComposerDraft((current) => ({
    ...current,
    messageText: '',
  }))
  if (input.composerInputRef.current !== null) {
    input.composerInputRef.current.value = ''
  }

  try {
    const response = await input.sendMessage(runtimeInput)
    input.setConversation((current) => [
      ...current,
      createUserTurn(trimmedMessage),
      createAssistantTurn(response),
    ])
  } catch (error) {
    const formattedError = formatRuntimeMessageSendError(error)
    input.setSendError(formattedError)
    input.setConversation((current) => [
      ...current,
      createUserTurn(trimmedMessage),
      createErrorTurn(formattedError),
    ])
  } finally {
    input.setSendStatus('idle')
    requestAnimationFrame(() => {
      input.composerInputRef.current?.focus()
    })
  }
}
