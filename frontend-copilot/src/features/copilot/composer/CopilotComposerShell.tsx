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

import {
  ThinkingBudgetSlider,
  ThinkingPillGroup,
  type ThinkingPillOption,
} from '../../../components/ThinkingControls'
import {
  THINKING_BUDGET_DEFAULT_SELECTION_TOKENS,
  findThinkingCodeValue,
  formatThinkingTokenCount,
  isThinkingValueActive,
  resolveThinkingValueLabel,
} from '../../../workbench/thinking-display'
import { getCopilotChatCopy } from '../../../workbench/locale'
import type { AssistantSessionShell } from '../../../workbench/types'
import {
  applyModelSelectionToComposerDraft,
  applyThinkingSelectionToComposerDraft,
  clampComposerHeight,
  describeThinkingCapabilityUnavailableReason,
  resolveThinkingSelectionForCapability,
  type CopilotChatComposerDraft,
} from '../copilot-chat-helpers'
import type { CopilotModelGroup } from '../model-picker'
import type {
  RuntimeThinkingCapability,
  RuntimeThinkingSelection,
  RuntimeThinkingValue,
} from '../thread-run-contract'
import { ModelPicker } from '../components/ModelPicker'
import { ToolPicker } from '../components/ToolPicker'

export interface CopilotComposerShellProps {
  language?: string
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

export function CopilotComposerShell({
  language = 'zh-CN',
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
}: CopilotComposerShellProps) {
  const copy = getCopilotChatCopy(language)
  const hasAvailableModels = modelGroups.some((group) => group.models.length > 0)
  const isSending = sendStatus === 'sending'
  const controlsDisabled = isSending
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
        onMouseDown={onResizeStart}
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

    </form>
  )
}

function buildComposerSurfaceHeightClassName(composerHeight: number): string {
  return `copilot-chat__composer-surface--height-${clampComposerHeight(composerHeight)}`
}

function renderThinkingControlBody(input: {
  capability: RuntimeThinkingCapability
  currentSelection: RuntimeThinkingSelection | null
  disabled: boolean
  onChange: (thinkingSelection: RuntimeThinkingSelection | null) => void
  onClose: () => void
}) {
  switch (input.capability.editorType) {
    case 'fixed':
      return renderFixedThinkingControl(input)
    case 'budget':
      return renderBudgetThinkingControl(input)
    case 'discrete':
      return renderDiscreteThinkingControl(input)
    default:
      return null
  }
}

function renderFixedThinkingControl(input: {
  capability: RuntimeThinkingCapability
  currentSelection: RuntimeThinkingSelection | null
}) {
  const currentValue = resolveThinkingSelectionValue(input.currentSelection, input.capability)

  return (
    <div className="copilot-chat__thinking-fixed" data-testid="chat-thinking-editor-fixed">
      <span className="copilot-chat__thinking-fixed-value">
        {currentValue?.labelZh ?? '固定推理'}
      </span>
      <span className="copilot-chat__thinking-fixed-badge" data-testid="chat-thinking-fixed-lock">
        锁定
      </span>
    </div>
  )
}

function renderDiscreteThinkingControl(input: {
  capability: RuntimeThinkingCapability
  currentSelection: RuntimeThinkingSelection | null
  disabled: boolean
  onChange: (thinkingSelection: RuntimeThinkingSelection | null) => void
  onClose: () => void
}) {
  const discreteOptions = input.capability.allowedValues.filter(
    (value): value is Extract<RuntimeThinkingValue, { valueType: 'code' }> => value.valueType === 'code',
  )
  const options: ThinkingPillOption[] = discreteOptions.map((value) => ({
    key: value.code,
    labelZh: value.labelZh,
    code: value.code,
    selected: isCodeThinkingSelection(input.currentSelection, value.code),
    disabled: input.disabled,
    testId: `chat-thinking-option-${value.code}`,
    onSelect: () => {
      input.onChange(buildThinkingSelectionFromValue(input.capability.series, value))
      input.onClose()
    },
  }))

  return (
    <div className="copilot-chat__thinking-option-list" data-testid="chat-thinking-editor-discrete">
      <ThinkingPillGroup
        compact
        ariaLabel="推理可选项"
        options={options}
        className="copilot-chat__thinking-pill-group"
      />
    </div>
  )
}

function renderBudgetThinkingControl(input: {
  capability: RuntimeThinkingCapability
  currentSelection: RuntimeThinkingSelection | null
  disabled: boolean
  onChange: (thinkingSelection: RuntimeThinkingSelection | null) => void
}) {
  const currentValue = resolveThinkingSelectionValue(input.currentSelection, input.capability)
  const currentBudgetMode = currentValue?.valueType === 'budget' ? currentValue.mode : 'off'
  const currentBudgetTokens = resolveBudgetTokens(currentValue, input.capability)
  const supportsExactBudgetSelection = supportsExactBudgetThinkingSelection(input.capability)
  const budgetModes = input.capability.allowedValues.filter(
    (value): value is Extract<RuntimeThinkingValue, { valueType: 'budget' }> => value.valueType === 'budget',
  )
  const budgetModeOptions: ThinkingPillOption[] = [
    ...budgetModes
      .filter((value) => value.mode === 'off' || value.mode === 'dynamic')
      .map((value) => ({
        key: `budget-${value.mode}`,
        labelZh: value.labelZh,
        code: value.mode,
        selected: currentBudgetMode === value.mode,
        disabled: input.disabled,
        testId: `chat-thinking-budget-mode-${value.mode}`,
        onSelect: () => {
          input.onChange(buildThinkingSelectionFromValue(input.capability.series, value))
        },
      })),
    ...(supportsExactBudgetSelection
      ? [{
          key: 'budget-budget',
          labelZh: '预算',
          code: 'budget_tokens',
          selected: currentBudgetMode === 'budget',
          disabled: input.disabled,
          testId: 'chat-thinking-budget-mode-budget',
          onSelect: () => {
            input.onChange(buildBudgetThinkingSelection(input.capability.series, currentBudgetTokens))
          },
        } satisfies ThinkingPillOption]
      : []),
  ]

  return (
    <div className="copilot-chat__thinking-budget" data-testid="chat-thinking-editor-budget">
      <ThinkingPillGroup
        compact
        ariaLabel="推理预算模式"
        options={budgetModeOptions}
        className="copilot-chat__thinking-pill-group"
      />
      {supportsExactBudgetSelection && currentBudgetMode === 'budget' ? (
        <ThinkingBudgetSlider
          compact
          ariaLabel="推理预算"
          budgetTokens={currentBudgetTokens}
          inputTestId="chat-thinking-budget-input"
          valueTestId="chat-thinking-budget-value"
          className="copilot-chat__thinking-budget-slider"
          onBudgetTokensChange={(budgetTokens) => {
            input.onChange(buildBudgetThinkingSelection(input.capability.series, budgetTokens))
          }}
        />
      ) : null}
    </div>
  )
}

function buildThinkingSeriesLabel(capability: RuntimeThinkingCapability): string {
  return capability.seriesLabelZh ?? capability.series ?? '未命名系列'
}

function isThinkingSelectionActive(selection: RuntimeThinkingSelection): boolean {
  return isThinkingValueActive(resolveThinkingSelectionValue(selection, null))
}

function buildThinkingSelectionFromValue(
  series: string | null,
  value: NonNullable<RuntimeThinkingSelection['value']>,
): RuntimeThinkingSelection | null {
  if (series === null) {
    return null
  }

  switch (value.valueType) {
    case 'code':
      return {
        series,
        value: {
          valueType: 'code',
          code: value.code,
          labelZh: value.labelZh,
        },
        mode: 'preset',
        level: value.code,
        budgetTokens: null,
      }
    case 'fixed':
      return {
        series,
        value: {
          valueType: 'fixed',
          code: 'fixed',
          labelZh: value.labelZh,
        },
        mode: 'preset',
        level: 'fixed',
        budgetTokens: null,
      }
    case 'budget':
      return {
        series,
        value: {
          valueType: 'budget',
          mode: value.mode,
          budgetTokens: value.budgetTokens,
          labelZh: value.labelZh,
        },
        mode: 'budget',
        level: null,
        budgetTokens: value.mode === 'budget' ? value.budgetTokens : null,
      }
  }
}

function buildBudgetThinkingSelection(
  series: string | null,
  budgetTokens: number,
): RuntimeThinkingSelection | null {
  return buildThinkingSelectionFromValue(series, {
    valueType: 'budget',
    mode: 'budget',
    budgetTokens,
    labelZh: formatThinkingTokenCount(budgetTokens),
  })
}

function resolveThinkingSelectionValue(
  selection: RuntimeThinkingSelection | null,
  capability: RuntimeThinkingCapability | null,
): RuntimeThinkingValue | null {
  if (capability?.supported === false) {
    return null
  }

  if (selection?.value != null) {
    return selection.value
  }

  if (selection?.mode === 'budget' && typeof selection.budgetTokens === 'number') {
    return {
      valueType: 'budget',
      mode: 'budget',
      budgetTokens: selection.budgetTokens,
      labelZh: formatThinkingTokenCount(selection.budgetTokens),
    }
  }

  if (typeof selection?.level === 'string' && selection.level.trim() !== '') {
    if (selection.level === 'fixed') {
      return {
        valueType: 'fixed',
        code: 'fixed',
        labelZh: '固定推理',
      }
    }

    const capabilityCodeValue = findThinkingCodeValue(capability?.allowedValues, selection.level)
    if (capabilityCodeValue !== null) {
      return capabilityCodeValue
    }

    return {
      valueType: 'code',
      code: selection.level,
      labelZh: selection.level,
    }
  }

  return capability?.defaultValue ?? null
}

function isCodeThinkingSelection(selection: RuntimeThinkingSelection | null, code: string): boolean {
  const currentValue = resolveThinkingSelectionValue(selection, null)
  return currentValue?.valueType === 'code' && currentValue.code === code
}

function resolveBudgetTokens(
  value: RuntimeThinkingValue | null,
  capability: RuntimeThinkingCapability,
): number {
  const runtimeBudget = value?.valueType === 'budget' && value.mode === 'budget'
    ? value.budgetTokens
    : null
  if (typeof runtimeBudget === 'number' && Number.isFinite(runtimeBudget)) {
    return runtimeBudget
  }

  const defaultBudget = capability.defaultValue?.valueType === 'budget' && capability.defaultValue.mode === 'budget'
    ? capability.defaultValue.budgetTokens
    : null
  if (typeof defaultBudget === 'number' && Number.isFinite(defaultBudget)) {
    return defaultBudget
  }

  return THINKING_BUDGET_DEFAULT_SELECTION_TOKENS
}

function supportsExactBudgetThinkingSelection(capability: RuntimeThinkingCapability): boolean {
  return capability.editorType === 'budget'
    && capability.controlSpec?.kind === 'budget'
    && capability.controlSpec.budget !== null
    && capability.controlSpec.budget !== undefined
}
