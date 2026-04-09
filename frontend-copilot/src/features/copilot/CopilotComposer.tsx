import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import { ArrowUp, Lightbulb, Square } from 'lucide-react'

import { THINKING_LEVEL_LABELS } from '../../workbench/thinking-capabilities'
import type { AssistantSessionShell, ThinkingLevelIntent } from '../../workbench/types'
import {
  applyModelSelectionToComposerDraft,
  applyThinkingLevelSelectionToComposerDraft,
  describeThinkingCapabilityUnavailableReason,
  type CopilotChatComposerDraft,
} from './copilot-chat-helpers'
import type { CopilotModelGroup } from './model-picker'
import type { RuntimeThinkingCapability } from './thread-run-contract'
import { ModelPicker } from './components/ModelPicker'
import { ToolPicker } from './components/ToolPicker'

interface CopilotComposerProps {
  capabilities: AssistantSessionShell['capabilities']
  modelGroups: CopilotModelGroup[]
  thinkingCapability: RuntimeThinkingCapability | null
  draft: CopilotChatComposerDraft
  onDraftChange: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  sendStatus: 'idle' | 'sending'
  canCancel: boolean
  sendDisabledReason: string | null
  composerInputRef: RefObject<HTMLTextAreaElement>
  composerHeight: number
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

export function CopilotComposer({
  capabilities,
  modelGroups,
  thinkingCapability,
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
  sendStatus,
  canCancel,
  sendDisabledReason,
  composerInputRef,
  composerHeight,
  onResizeStart,
}: CopilotComposerProps) {
  const hasAvailableModels = modelGroups.some((group) => group.models.length > 0)
  const isSending = sendStatus === 'sending'
  const controlsDisabled = isSending
  const thinkingSupported = thinkingCapability?.supported === true
  const thinkingOptions = useMemo(
    () => (thinkingSupported && thinkingCapability !== null
      ? buildRuntimeThinkingLevelOptions(thinkingCapability)
      : []),
    [thinkingCapability, thinkingSupported],
  )
  const thinkingValue = draft.thinkingLevelIntent ?? thinkingCapability?.defaultLevel ?? 'off'
  const unsupportedThinkingHint = draft.selectedModelRoute !== null && thinkingCapability !== null && !thinkingSupported
    ? describeThinkingCapabilityUnavailableReason(thinkingCapability) ?? '当前模型不支持'
    : null
  const thinkingSourceHint = thinkingCapability?.source === 'override'
    ? '候选来源：设置页 override'
    : null
  const thinkingControlRef = useRef<HTMLDivElement | null>(null)
  const thinkingPanelId = useId()
  const [thinkingPanelOpen, setThinkingPanelOpen] = useState(false)
  const currentThinkingLabel = useMemo(
    () => thinkingOptions.find((option) => option.value === thinkingValue)?.label ?? '思考',
    [thinkingOptions, thinkingValue],
  )
  const thinkingTriggerAriaProps = thinkingSupported
    ? {
        'aria-haspopup': 'dialog' as const,
        'aria-controls': thinkingPanelId,
        'aria-expanded': thinkingPanelOpen,
      }
    : {}

  useEffect(() => {
    if (!thinkingPanelOpen) {
      return undefined
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (thinkingControlRef.current?.contains(event.target as Node)) {
        return
      }

      setThinkingPanelOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setThinkingPanelOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [thinkingPanelOpen])

  useEffect(() => {
    if (controlsDisabled || !thinkingSupported) {
      setThinkingPanelOpen(false)
    }
  }, [controlsDisabled, thinkingSupported])

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
            onDraftChange((current) => applyModelSelectionToComposerDraft(current, {
              modelId: model.selectionValue,
              modelRoute: model.route,
            }))
          }}
        />
        <div
          className="copilot-chat__thinking-control"
          data-testid="chat-thinking-control"
          ref={thinkingControlRef}
        >
          <button
            type="button"
            className={[
              'copilot-chat__thinking-trigger',
              controlsDisabled ? 'copilot-chat__thinking-trigger--disabled' : '',
              thinkingSupported && thinkingValue !== 'off' ? 'copilot-chat__thinking-trigger--active' : '',
            ].filter((className) => className !== '').join(' ')}
            data-testid="chat-thinking-trigger"
            aria-label={unsupportedThinkingHint ?? `思考档位：${currentThinkingLabel}`}
            title={unsupportedThinkingHint ?? '思考档位'}
            disabled={controlsDisabled}
            {...thinkingTriggerAriaProps}
            onClick={() => {
              if (!thinkingSupported) {
                setThinkingPanelOpen(false)
                return
              }

              setThinkingPanelOpen((current) => !current)
            }}
          >
            <Lightbulb className="copilot-chat__thinking-trigger-icon" aria-hidden="true" />
          </button>
          {thinkingSupported && thinkingPanelOpen && (
            <section
              id={thinkingPanelId}
              className="copilot-model-picker__panel copilot-chat__thinking-panel"
              role="dialog"
              aria-label="选择思考档位"
              data-testid="chat-thinking-panel"
            >
              <p className="copilot-panel__eyebrow">推理强度</p>
              {thinkingSourceHint !== null && (
                <p className="copilot-chat__thinking-hint" data-testid="chat-thinking-override-hint">
                  {thinkingSourceHint}
                </p>
              )}
              <div className="copilot-chat__thinking-option-list">
                {thinkingOptions.map((option) => {
                  const selected = option.value === thinkingValue
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={[
                        'copilot-model-picker__option',
                        'copilot-chat__thinking-option',
                        selected ? 'copilot-model-picker__option--selected copilot-chat__thinking-option--selected' : '',
                      ].filter((className) => className !== '').join(' ')}
                      data-testid={`chat-thinking-option-${option.value}`}
                      onClick={() => {
                        onDraftChange((current) => applyThinkingLevelSelectionToComposerDraft(current, {
                          modelRoute: draft.selectedModelRoute,
                          thinkingLevelIntent: option.value as ThinkingLevelIntent,
                        }))
                        setThinkingPanelOpen(false)
                      }}
                    >
                      <span className="copilot-chat__thinking-option-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                      <span className="copilot-model-picker__option-body">
                        <span className="copilot-model-picker__option-name">{option.label}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </div>
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

    </form>
  )
}

function buildRuntimeThinkingLevelOptions(capability: RuntimeThinkingCapability) {
  return capability.supportedLevels.map((level) => ({
    value: level,
    label: THINKING_LEVEL_LABELS[level],
  }))
}
