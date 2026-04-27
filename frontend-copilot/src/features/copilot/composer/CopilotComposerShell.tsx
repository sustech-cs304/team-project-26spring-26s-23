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

import type { SettingsWorkspaceToolPermissionPolicyState } from '../../../../electron/settings-workspace/state-schema'
import { resolveThinkingValueLabel } from '../../../workbench/thinking-display'
import { getCopilotChatCopy } from '../../../workbench/locale'
import type { AssistantSessionShell } from '../../../workbench/types'
import {
  applyModelSelectionToComposerDraft,
  applyThinkingSelectionToComposerDraft,
  describeThinkingCapabilityUnavailableReason,
  resolveThinkingSelectionForCapability,
  type CopilotChatComposerDraft,
} from '../copilot-chat-helpers'
import type { CopilotModelGroup } from '../model-picker'
import type {
  RuntimeThinkingCapability,
  RuntimeThinkingSelection,
} from '../thread-run-contract'
import { ModelPicker } from '../components/ModelPicker'
import { ToolPicker } from '../components/ToolPicker'
import {
  buildComposerSurfaceHeightClassName,
  buildThinkingSeriesLabel,
  isThinkingSelectionActive,
  renderThinkingControlBody,
  resolveThinkingSelectionValue,
} from './CopilotComposerThinkingEditors'

export interface CopilotComposerShellProps {
  language?: string
  capabilities: AssistantSessionShell['capabilities']
  modelGroups: CopilotModelGroup[]
  thinkingCapability: RuntimeThinkingCapability | null
  draft: CopilotChatComposerDraft
  toolPermissionPolicy?: SettingsWorkspaceToolPermissionPolicyState | null
  onDraftChange: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  sendStatus: 'idle' | 'sending'
  canCancel: boolean
  sendDisabledReason: string | null
  controlsLockedReason?: string | null
  interactionLocked?: boolean
  composerInputRef: RefObject<HTMLTextAreaElement>
  composerHeight: number
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

export function CopilotComposerShell({
  language = 'zh-CN',
  capabilities,
  modelGroups,
  thinkingCapability,
  draft,
  toolPermissionPolicy = null,
  onDraftChange,
  onSubmit,
  onCancel,
  sendStatus,
  canCancel,
  sendDisabledReason,
  controlsLockedReason = null,
  interactionLocked = false,
  composerInputRef,
  composerHeight,
  onResizeStart,
}: CopilotComposerShellProps) {
  const copy = getCopilotChatCopy(language)
  const hasAvailableModels = modelGroups.some((group) => group.models.length > 0)
  const isSending = sendStatus === 'sending'
  const controlsLocked = controlsLockedReason !== null
  const controlsDisabled = isSending || interactionLocked || controlsLocked
  const inputDisabled = interactionLocked || controlsLocked
  const thinkingControlRef = useRef<HTMLDivElement | null>(null)
  const thinkingPanelId = useId()
  const [thinkingPanelOpen, setThinkingPanelOpen] = useState(false)

  const canRenderThinkingControl = thinkingCapability !== null
    && thinkingCapability.supported !== false
    && thinkingCapability.series !== null
    && thinkingCapability.editorType !== null
  const effectiveThinkingSelection = useMemo(
    () => (thinkingCapability === null ? draft.thinkingSelection : resolveThinkingSelectionForCapability(thinkingCapability, draft.thinkingSelection)),
    [draft.thinkingSelection, thinkingCapability],
  )
  const currentThinkingValue = useMemo(
    () => resolveThinkingSelectionValue(effectiveThinkingSelection, thinkingCapability),
    [effectiveThinkingSelection, thinkingCapability],
  )
  const currentThinkingLabel = useMemo(
    () => resolveThinkingValueLabel(currentThinkingValue),
    [currentThinkingValue],
  )
  const thinkingTriggerPlaceholder = copy.composer.thinkingPlaceholder
  const thinkingTriggerLabel = currentThinkingLabel === null ? thinkingTriggerPlaceholder : currentThinkingLabel
  const unavailableThinkingReason = useMemo(
    () => describeThinkingCapabilityUnavailableReason(thinkingCapability),
    [thinkingCapability],
  )
  const thinkingTriggerTitle = canRenderThinkingControl
    ? thinkingTriggerLabel
    : unavailableThinkingReason ?? copy.composer.thinkingPlaceholder
  const thinkingTriggerActive = effectiveThinkingSelection === null
    ? false
    : isThinkingSelectionActive(effectiveThinkingSelection)
  const thinkingTriggerAriaProps = canRenderThinkingControl
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
    if (controlsDisabled || !canRenderThinkingControl) {
      setThinkingPanelOpen(false)
    }
  }, [canRenderThinkingControl, controlsDisabled])

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

  const handleThinkingSelectionChange = (thinkingSelection: RuntimeThinkingSelection | null) => {
    onDraftChange((current) => applyThinkingSelectionToComposerDraft(current, {
      modelRoute: current.selectedModelRoute,
      thinkingSelection,
    }))
  }

  return (
    <form className="copilot-chat__composer" data-testid="chat-composer-dock" onSubmit={onSubmit}>
      <div className="copilot-chat__composer-toolbar" data-testid="chat-composer-toolbar">
        <ModelPicker
          language={language}
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
              'copilot-model-picker__trigger',
              'copilot-chat__thinking-trigger',
              controlsDisabled ? 'copilot-chat__thinking-trigger--disabled' : '',
              thinkingTriggerActive ? 'copilot-chat__thinking-trigger--active' : '',
            ].filter((className) => className !== '').join(' ')}
            data-testid="chat-thinking-trigger"
            aria-label={thinkingTriggerTitle}
            title={thinkingTriggerTitle}
            disabled={controlsDisabled}
            {...thinkingTriggerAriaProps}
            onClick={() => {
              if (!canRenderThinkingControl) {
                setThinkingPanelOpen(false)
                return
              }
 
              setThinkingPanelOpen((current) => !current)
            }}
          >
            <span className="copilot-chat__thinking-trigger-main">
              <Lightbulb className="copilot-chat__thinking-trigger-icon" aria-hidden="true" />
              <span className="copilot-chat__thinking-trigger-label" data-testid="chat-thinking-trigger-label">
                {thinkingTriggerLabel}
              </span>
            </span>
          </button>
          {canRenderThinkingControl && thinkingCapability !== null && thinkingPanelOpen && (
            <section
              id={thinkingPanelId}
              className="copilot-model-picker__panel copilot-chat__thinking-panel"
              role="dialog"
              aria-label={copy.composer.thinkingSettingsAriaLabel}
              data-testid="chat-thinking-panel"
            >
              <div className="copilot-chat__thinking-panel-header">
                <div className="copilot-chat__thinking-panel-summary">
                  <span className="copilot-chat__thinking-panel-title" data-testid="chat-thinking-series-title">
                    {buildThinkingSeriesLabel(thinkingCapability)}
                  </span>
                  <span className="copilot-chat__thinking-panel-current-shell">
                    <span className="copilot-chat__thinking-panel-current-label">{copy.composer.currentValueLabel}</span>
                    <span className="copilot-chat__thinking-panel-current-value" data-testid="chat-thinking-current-value">
                      {currentThinkingLabel ?? copy.composer.unsetValue}
                    </span>
                  </span>
                </div>
              </div>
              {renderThinkingControlBody({
                capability: thinkingCapability,
                currentSelection: effectiveThinkingSelection,
                disabled: controlsDisabled,
                onChange: handleThinkingSelectionChange,
                onClose: () => setThinkingPanelOpen(false),
              })}
            </section>
          )}
        </div>
        <ToolPicker
          language={language}
          tools={capabilities.allAvailableTools}
          selectedToolIds={draft.enabledTools}
          recommendedToolIds={capabilities.recommendedToolsForAgent}
          toolPermissionPolicy={toolPermissionPolicy}
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
        aria-label={copy.composer.resizeHandleAriaLabel}
        onMouseDown={interactionLocked ? undefined : onResizeStart}
      />

      <div
        className={`copilot-chat__composer-surface ${buildComposerSurfaceHeightClassName(composerHeight)}`}
        data-testid="chat-composer-surface"
      >
        <div className="copilot-panel__field-group copilot-chat__composer-field">
          <textarea
            ref={composerInputRef}
            className="copilot-chat__composer-input"
            name="messageText"
            aria-label={copy.composer.messageInputAriaLabel}
            value={draft.messageText}
            disabled={inputDisabled}
            onChange={(event) => {
              const nextValue = event.currentTarget.value
              onDraftChange((current) => ({
                ...current,
                messageText: nextValue,
              }))
            }}
            onKeyDown={handleMessageInputKeyDown}
            placeholder={copy.composer.messageInputPlaceholder}
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
          title={isSending ? copy.composer.cancelCurrentResponse : sendDisabledReason ?? copy.composer.sendMessage}
          aria-label={isSending ? copy.composer.cancelCurrentResponse : sendDisabledReason ?? copy.composer.sendMessage}
          onClick={isSending ? onCancel : undefined}
        >
          {isSending
            ? <Square className="copilot-chat__send-button-icon" aria-hidden="true" />
            : <ArrowUp className="copilot-chat__send-button-icon" aria-hidden="true" />}
        </button>
      </div>

      {controlsLockedReason !== null && (
        <p className="copilot-chat__composer-note" data-testid="chat-composer-note">{controlsLockedReason}</p>
      )}

    </form>
  )
}

