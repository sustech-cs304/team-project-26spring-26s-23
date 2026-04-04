import {
  type Dispatch,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import { ArrowUp, Square } from 'lucide-react'

import type { AssistantSessionShell } from '../../workbench/types'
import type { CopilotChatComposerDraft } from './copilot-chat-helpers'
import type { CopilotModelGroup } from './model-picker'
import { ModelPicker } from './components/ModelPicker'
import { ToolPicker } from './components/ToolPicker'

interface CopilotComposerProps {
  capabilities: AssistantSessionShell['capabilities']
  modelGroups: CopilotModelGroup[]
  draft: CopilotChatComposerDraft
  onDraftChange: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  sendStatus: 'idle' | 'sending'
  canCancel: boolean
  sendDisabledReason: string | null
  composerError: string | null
  runNotice: string | null
  composerInputRef: RefObject<HTMLTextAreaElement>
  composerHeight: number
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

export function CopilotComposer({
  capabilities,
  modelGroups,
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
  sendStatus,
  canCancel,
  sendDisabledReason,
  composerError,
  runNotice: _runNotice,
  composerInputRef,
  composerHeight,
  onResizeStart,
}: CopilotComposerProps) {
  const hasAvailableModels = modelGroups.some((group) => group.models.length > 0)
  const isSending = sendStatus === 'sending'
  const controlsDisabled = isSending

  const handleMessageInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.metaKey) {
      return
    }

    if (event.ctrlKey) {
      event.preventDefault()
      const textarea = event.currentTarget
      const { selectionStart, selectionEnd } = textarea
      const currentValue = draft.messageText
      const nextValue = `${currentValue.slice(0, selectionStart)}\n${currentValue.slice(selectionEnd)}`

      onDraftChange((current) => ({
        ...current,
        messageText: nextValue,
      }))

      requestAnimationFrame(() => {
        textarea.focus()
        const nextCaretPosition = selectionStart + 1
        textarea.setSelectionRange(nextCaretPosition, nextCaretPosition)
      })
      return
    }

    event.preventDefault()
    if (sendDisabledReason === null) {
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form className="copilot-chat__composer" data-testid="chat-composer-dock" onSubmit={onSubmit}>
      <div className="copilot-chat__composer-toolbar" data-testid="chat-composer-toolbar">
        <ModelPicker
          selectedModelId={draft.selectedModelId}
          groups={modelGroups}
          disabled={!hasAvailableModels || controlsDisabled}
          onSelectModel={(model) => {
            onDraftChange((current) => ({
              ...current,
              selectedModelId: model.id,
              selectedModelRoute: {
                providerProfileId: model.route.providerProfileId,
                snapshot: {
                  provider: model.route.snapshot.provider,
                  endpointType: model.route.snapshot.endpointType,
                  baseUrl: model.route.snapshot.baseUrl,
                  modelId: model.route.snapshot.modelId,
                },
              },
            }))
          }}
        />
        <ToolPicker
          tools={capabilities.allAvailableTools}
          selectedToolIds={draft.enabledTools}
          recommendedToolIds={capabilities.recommendedToolsForAgent}
          disabled={controlsDisabled}
          onChangeToolIds={(enabledTools: string[]) => {
            onDraftChange((current) => ({
              ...current,
              enabledTools,
            }))
          }}
        />
      </div>

      <div
        className="copilot-chat__composer-resize-handle"
        data-testid="chat-composer-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖动以调整输入区高度"
        onMouseDown={onResizeStart}
      />

      <div
        className="copilot-chat__composer-surface"
        data-testid="chat-composer-surface"
        style={{ height: `${composerHeight}px` }}
      >
        <div className="copilot-panel__field-group copilot-chat__composer-field">
          <textarea
            ref={composerInputRef}
            className="copilot-chat__composer-input"
            name="messageText"
            aria-label="消息内容"
            value={draft.messageText}
            onChange={(event) => {
              const nextValue = event.currentTarget.value
              onDraftChange((current) => ({
                ...current,
                messageText: nextValue,
              }))
            }}
            onKeyDown={handleMessageInputKeyDown}
            placeholder="按 Enter 发送，按 Ctrl + Enter 换行"
          />
        </div>

        <button
          type={isSending ? 'button' : 'submit'}
          className={[
            'copilot-chat__send-button',
            isSending ? 'copilot-chat__send-button--cancel' : '',
          ].filter((className) => className !== '').join(' ')}
          data-testid="chat-composer-send-button"
          disabled={isSending ? !canCancel : sendDisabledReason !== null}
          title={isSending ? '取消当前响应' : sendDisabledReason ?? '发送消息'}
          aria-label={isSending ? '取消当前响应' : sendDisabledReason ?? '发送消息'}
          onClick={isSending ? onCancel : undefined}
        >
          {isSending
            ? <Square className="copilot-chat__send-button-icon" aria-hidden="true" />
            : <ArrowUp className="copilot-chat__send-button-icon" aria-hidden="true" />}
        </button>
      </div>

      {composerError !== null && (
        <p className="copilot-panel__error" role="alert">
          {composerError}
        </p>
      )}
    </form>
  )
}
