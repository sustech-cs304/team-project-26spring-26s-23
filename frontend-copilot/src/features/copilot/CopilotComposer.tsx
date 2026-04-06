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
import { ArrowUp, Lightbulb, Lock, Square } from 'lucide-react'

import { THINKING_LEVEL_LABELS } from '../../workbench/thinking-capabilities'
import type { AssistantSessionShell, ThinkingLevelIntent } from '../../workbench/types'
import {
  applyModelSelectionToComposerDraft,
  applyThinkingSelectionToComposerDraft,
  resolveThinkingSelectionForCapability,
  type CopilotChatComposerDraft,
} from './copilot-chat-helpers'
import type { CopilotModelGroup } from './model-picker'
import type {
  RuntimeCanonicalThinkingSelection,
  RuntimeThinkingCapability,
  RuntimeThinkingControlSpec,
  RuntimeThinkingLevel,
  RuntimeThinkingSelection,
} from './thread-run-contract'
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
  const thinkingControlRef = useRef<HTMLDivElement | null>(null)
  const thinkingPanelId = useId()
  const [thinkingPanelOpen, setThinkingPanelOpen] = useState(false)

  const thinkingControlSpec = thinkingCapability?.controlSpec ?? null
  const canRenderThinkingControl = thinkingCapability !== null && thinkingControlSpec !== null
  const effectiveThinkingSelection = useMemo(
    () => (thinkingCapability === null ? draft.thinkingSelection : resolveThinkingSelectionForCapability(thinkingCapability, draft.thinkingSelection)),
    [draft.thinkingSelection, thinkingCapability],
  )
  const currentThinkingLabel = useMemo(
    () => formatThinkingSelectionLabel(effectiveThinkingSelection, thinkingControlSpec),
    [effectiveThinkingSelection, thinkingControlSpec],
  )
  const thinkingSourceHint = thinkingCapability !== null && isOverrideThinkingCapability(thinkingCapability)
    ? 'override'
    : null
  const thinkingTriggerLabel = currentThinkingLabel === null ? '思考' : currentThinkingLabel
  const thinkingTriggerTitle = canRenderThinkingControl
    ? thinkingTriggerLabel
    : '思考'
  const thinkingTriggerActive = effectiveThinkingSelection === null
    ? false
    : isThinkingSelectionActive(effectiveThinkingSelection)

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
      modelRoute: draft.selectedModelRoute,
      thinkingSelection,
    }))
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
              modelId: model.id,
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
              thinkingTriggerActive ? 'copilot-chat__thinking-trigger--active' : '',
            ].filter((className) => className !== '').join(' ')}
            data-testid="chat-thinking-trigger"
            aria-label={`思考设置：${thinkingTriggerTitle}`}
            title={thinkingTriggerTitle}
            aria-controls={canRenderThinkingControl ? thinkingPanelId : undefined}
            disabled={controlsDisabled}
            onClick={() => {
              if (!canRenderThinkingControl) {
                setThinkingPanelOpen(false)
                return
              }

              setThinkingPanelOpen((current) => !current)
            }}
          >
            <Lightbulb className="copilot-chat__thinking-trigger-icon" aria-hidden="true" />
          </button>
          {thinkingCapability !== null && thinkingControlSpec !== null && thinkingPanelOpen && (
            <section
              id={thinkingPanelId}
              className="copilot-model-picker__panel copilot-chat__thinking-panel"
              role="dialog"
              aria-label="选择思考档位"
              data-testid="chat-thinking-panel"
            >
              <div className="copilot-chat__thinking-panel-header">
                <p className="copilot-panel__eyebrow">{resolveThinkingEyebrow(thinkingControlSpec)}</p>
                {thinkingSourceHint !== null && (
                  <span
                    className="copilot-chat__thinking-source-badge"
                    data-testid="chat-thinking-override-hint"
                  >
                    {thinkingSourceHint}
                  </span>
                )}
              </div>
              {renderThinkingControlBody({
                capability: thinkingCapability,
                controlSpec: thinkingControlSpec,
                currentSelection: effectiveThinkingSelection,
                disabled: controlsDisabled,
                onChange: handleThinkingSelectionChange,
                onClose: () => setThinkingPanelOpen(false),
              })}
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

function renderThinkingControlBody(input: {
  capability: RuntimeThinkingCapability
  controlSpec: RuntimeThinkingControlSpec
  currentSelection: RuntimeThinkingSelection | null
  disabled: boolean
  onChange: (thinkingSelection: RuntimeThinkingSelection | null) => void
  onClose: () => void
}) {
  switch (input.controlSpec.kind) {
    case 'fixed':
      return renderFixedThinkingControl(input)
    case 'budget':
      return renderBudgetThinkingControl(input)
    case 'binary':
    case 'off-auto':
    case 'discrete':
      return renderPresetThinkingControl(input)
  }
}

function renderFixedThinkingControl(input: {
  capability: RuntimeThinkingCapability
  controlSpec: RuntimeThinkingControlSpec
  currentSelection: RuntimeThinkingSelection | null
}) {
  return (
    <div className="copilot-chat__thinking-fixed" data-testid="chat-thinking-kind-fixed">
      <div className="copilot-chat__thinking-fixed-icon" aria-hidden="true">
        <Lock className="copilot-chat__thinking-fixed-icon-svg" />
      </div>
      <div className="copilot-chat__thinking-fixed-body">
        <span className="copilot-chat__thinking-fixed-value">
          {formatThinkingSelectionLabel(input.currentSelection, input.controlSpec) ?? '锁定'}
        </span>
      </div>
      <span className="copilot-chat__thinking-locked-badge" data-testid="chat-thinking-fixed-lock">
        锁定
      </span>
    </div>
  )
}

function renderPresetThinkingControl(input: {
  capability: RuntimeThinkingCapability
  controlSpec: RuntimeThinkingControlSpec
  currentSelection: RuntimeThinkingSelection | null
  disabled: boolean
  onChange: (thinkingSelection: RuntimeThinkingSelection | null) => void
  onClose: () => void
}) {
  const presetOptions = getPresetLevelOptions(input.controlSpec)

  return (
    <div
      className="copilot-chat__thinking-option-list"
      data-testid={`chat-thinking-kind-${input.controlSpec.kind}`}
    >
      {presetOptions.map((level) => {
        const selected = isPresetThinkingSelection(input.currentSelection, level)
        return (
          <button
            key={level}
            type="button"
            className={[
              'copilot-model-picker__option',
              'copilot-chat__thinking-option',
              selected ? 'copilot-model-picker__option--selected copilot-chat__thinking-option--selected' : '',
            ].filter((className) => className !== '').join(' ')}
            data-testid={`chat-thinking-option-${level}`}
            disabled={input.disabled}
            onClick={() => {
              input.onChange(buildPresetThinkingSelection(input.capability.series, level))
              input.onClose()
            }}
          >
            <span className="copilot-chat__thinking-option-check" aria-hidden="true">{selected ? '✓' : ''}</span>
            <span className="copilot-model-picker__option-body">
              <span className="copilot-model-picker__option-name">{THINKING_LEVEL_LABELS[level]}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function renderBudgetThinkingControl(input: {
  capability: RuntimeThinkingCapability
  controlSpec: RuntimeThinkingControlSpec
  currentSelection: RuntimeThinkingSelection | null
  disabled: boolean
  onChange: (thinkingSelection: RuntimeThinkingSelection | null) => void
}) {
  const budgetConfig = resolveBudgetConfig(input.controlSpec)
  const currentBudgetTokens = resolveBudgetTokens(input.currentSelection, budgetConfig.min, budgetConfig.max, budgetConfig.step)
  const offSelected = isPresetThinkingSelection(input.currentSelection, 'off')
  const hasOffPreset = getPresetLevelOptions(input.controlSpec).includes('off')

  return (
    <div className="copilot-chat__thinking-budget" data-testid="chat-thinking-kind-budget">
      {hasOffPreset && (
        <button
          type="button"
          className={[
            'copilot-model-picker__option',
            'copilot-chat__thinking-option',
            offSelected ? 'copilot-model-picker__option--selected copilot-chat__thinking-option--selected' : '',
          ].filter((className) => className !== '').join(' ')}
          data-testid="chat-thinking-option-off"
          disabled={input.disabled}
          onClick={() => {
            input.onChange(buildPresetThinkingSelection(input.capability.series, 'off'))
          }}
        >
          <span className="copilot-chat__thinking-option-check" aria-hidden="true">{offSelected ? '✓' : ''}</span>
          <span className="copilot-model-picker__option-body">
            <span className="copilot-model-picker__option-name">{THINKING_LEVEL_LABELS.off}</span>
          </span>
        </button>
      )}
      <div className="copilot-chat__thinking-budget-card">
        <div className="copilot-chat__thinking-budget-header">
          <span className="copilot-chat__thinking-budget-label">预算</span>
          <span className="copilot-chat__thinking-budget-value" data-testid="chat-thinking-budget-value">
            {formatTokenCount(currentBudgetTokens)}
          </span>
        </div>
        <input
          className="copilot-chat__thinking-budget-input"
          data-testid="chat-thinking-budget-input"
          type="range"
          aria-label="推理预算"
          title="推理预算"
          min={budgetConfig.min}
          max={budgetConfig.max}
          step={budgetConfig.step}
          value={currentBudgetTokens}
          disabled={input.disabled}
          onChange={(event) => {
            input.onChange(buildBudgetThinkingSelection(input.capability.series, Number(event.currentTarget.value)))
          }}
        />
        <div className="copilot-chat__thinking-budget-scale" aria-hidden="true">
          <span>{formatTokenCount(budgetConfig.min)}</span>
          <span>{formatTokenCount(budgetConfig.max)}</span>
        </div>
      </div>
    </div>
  )
}

function resolveThinkingEyebrow(controlSpec: RuntimeThinkingControlSpec): string {
  switch (controlSpec.kind) {
    case 'fixed':
      return '固定推理'
    case 'budget':
      return '推理预算'
    case 'binary':
    case 'off-auto':
    case 'discrete':
      return '推理强度'
  }
}

function formatThinkingSelectionLabel(
  selection: RuntimeThinkingSelection | null,
  controlSpec: RuntimeThinkingControlSpec | null,
): string | null {
  if (selection === null || controlSpec === null) {
    return null
  }

  if (selection.mode === 'budget' && typeof selection.budgetTokens === 'number') {
    return formatTokenCount(selection.budgetTokens)
  }

  if (isThinkingLevel(selection.level)) {
    return THINKING_LEVEL_LABELS[selection.level]
  }

  return null
}

function isThinkingSelectionActive(selection: RuntimeThinkingSelection): boolean {
  if (selection.mode === 'budget') {
    return typeof selection.budgetTokens === 'number' && selection.budgetTokens > 0
  }

  return isThinkingLevel(selection.level) && selection.level !== 'off'
}

function getPresetLevelOptions(controlSpec: RuntimeThinkingControlSpec): RuntimeThinkingLevel[] {
  const levels = (controlSpec.presetOptions ?? []).flatMap((option) => (
    option.kind === 'preset' && isThinkingLevel(option.value) ? [option.value] : []
  ))

  if (levels.length > 0) {
    return Array.from(new Set(levels))
  }

  if (controlSpec.fixedSelection?.kind === 'preset' && isThinkingLevel(controlSpec.fixedSelection.value)) {
    return [controlSpec.fixedSelection.value]
  }

  return []
}

function buildPresetThinkingSelection(
  series: string,
  level: RuntimeThinkingLevel,
): RuntimeThinkingSelection {
  return {
    series,
    mode: 'preset',
    level,
    budgetTokens: null,
  }
}

function buildBudgetThinkingSelection(series: string, budgetTokens: number): RuntimeThinkingSelection {
  return {
    series,
    mode: 'budget',
    level: null,
    budgetTokens,
  }
}

function isPresetThinkingSelection(
  selection: RuntimeThinkingSelection | null,
  level: RuntimeThinkingLevel,
): boolean {
  return selection?.mode === 'preset' && selection.level === level
}

function resolveBudgetConfig(controlSpec: RuntimeThinkingControlSpec) {
  const minimum = Math.max(0, Math.trunc(controlSpec.budget?.minTokens ?? 0))
  const maximum = Math.max(minimum, Math.trunc(controlSpec.budget?.maxTokens ?? minimum))
  const step = Math.max(1, Math.trunc(controlSpec.budget?.stepTokens ?? 1))

  return {
    min: minimum,
    max: maximum,
    step,
  }
}

function resolveBudgetTokens(
  selection: RuntimeThinkingSelection | null,
  minimum: number,
  maximum: number,
  step: number,
): number {
  const rawValue = selection?.mode === 'budget' ? selection.budgetTokens : minimum
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return minimum
  }

  const clamped = Math.min(maximum, Math.max(minimum, Math.trunc(rawValue)))
  return minimum + (Math.round((clamped - minimum) / step) * step)
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${trimTrailingZero((value / 1_000_000).toFixed(1))}M`
  }

  if (value >= 1_000) {
    return `${trimTrailingZero((value / 1_000).toFixed(value >= 100_000 ? 0 : 1))}K`
  }

  return String(value)
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0$/, '')
}

function isOverrideThinkingCapability(capability: RuntimeThinkingCapability): boolean {
  return capability.source === 'override' || capability.status === 'unknown-with-override'
}

function isThinkingLevel(value: RuntimeCanonicalThinkingSelection['value'] | RuntimeThinkingSelection['level']): value is ThinkingLevelIntent {
  return value === 'off'
    || value === 'auto'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
}
