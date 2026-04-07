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
import type { AssistantSessionShell } from '../../workbench/types'
import {
  applyModelSelectionToComposerDraft,
  applyThinkingSelectionToComposerDraft,
  resolveThinkingSelectionForCapability,
  type CopilotChatComposerDraft,
} from './copilot-chat-helpers'
import type { CopilotModelGroup } from './model-picker'
import type {
  RuntimeThinkingCapability,
  RuntimeThinkingControlSpec,
  RuntimeThinkingSelection,
  RuntimeThinkingValue,
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

  const canRenderThinkingControl = thinkingCapability !== null
    && thinkingCapability.series !== null
    && thinkingCapability.editorType !== null
  const effectiveThinkingSelection = useMemo(
    () => (thinkingCapability === null ? draft.thinkingSelection : resolveThinkingSelectionForCapability(thinkingCapability, draft.thinkingSelection)),
    [draft.thinkingSelection, thinkingCapability],
  )
  const currentThinkingLabel = useMemo(
    () => formatThinkingSelectionLabel(effectiveThinkingSelection, thinkingCapability),
    [effectiveThinkingSelection, thinkingCapability],
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
          {canRenderThinkingControl && thinkingCapability !== null && thinkingPanelOpen && (
            <section
              id={thinkingPanelId}
              className="copilot-model-picker__panel copilot-chat__thinking-panel"
              role="dialog"
              aria-label="选择推理系列"
              data-testid="chat-thinking-panel"
            >
              <div className="copilot-chat__thinking-panel-header">
                <label className="copilot-chat__thinking-series-field">
                  <span className="copilot-chat__thinking-series-label">推理系列</span>
                  <select
                    className="copilot-chat__thinking-series-select"
                    data-testid="chat-thinking-series-select"
                    aria-label="推理系列"
                    value={thinkingCapability.series ?? ''}
                    disabled
                    title={thinkingCapability.series ?? undefined}
                    onChange={() => undefined}
                  >
                    <option value={thinkingCapability.series ?? ''}>
                      {buildThinkingSeriesLabel(thinkingCapability)}
                    </option>
                  </select>
                </label>
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
  const fixedCode = currentValue?.valueType === 'fixed' ? currentValue.code : 'fixed'

  return (
    <div className="copilot-chat__thinking-fixed" data-testid="chat-thinking-editor-fixed">
      <div className="copilot-chat__thinking-fixed-icon" aria-hidden="true">
        <Lock className="copilot-chat__thinking-fixed-icon-svg" />
      </div>
      <div className="copilot-chat__thinking-fixed-body">
        <span className="copilot-chat__thinking-fixed-copy">
          <span className="copilot-chat__thinking-fixed-value">
            {currentValue?.labelZh ?? '固定推理'}
          </span>
          <code className="copilot-chat__thinking-option-code">{fixedCode}</code>
        </span>
      </div>
      <span className="copilot-chat__thinking-locked-badge" data-testid="chat-thinking-fixed-lock">
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

  return (
    <div className="copilot-chat__thinking-option-list" data-testid="chat-thinking-editor-discrete">
      {discreteOptions.map((value) => {
        const selected = isCodeThinkingSelection(input.currentSelection, value.code)

        return (
          <button
            key={value.code}
            type="button"
            className={[
              'copilot-model-picker__option',
              'copilot-chat__thinking-option',
              selected ? 'copilot-model-picker__option--selected copilot-chat__thinking-option--selected' : '',
            ].filter((className) => className !== '').join(' ')}
            data-testid={`chat-thinking-option-${value.code}`}
            disabled={input.disabled}
            onClick={() => {
              input.onChange(buildThinkingSelectionFromValue(input.capability.series, value))
              input.onClose()
            }}
          >
            <span className="copilot-chat__thinking-option-check" aria-hidden="true">{selected ? '✓' : ''}</span>
            <span className="copilot-chat__thinking-option-body">
              <span className="copilot-chat__thinking-option-label">{value.labelZh}</span>
              <code className="copilot-chat__thinking-option-code">{value.code}</code>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function renderBudgetThinkingControl(input: {
  capability: RuntimeThinkingCapability
  currentSelection: RuntimeThinkingSelection | null
  disabled: boolean
  onChange: (thinkingSelection: RuntimeThinkingSelection | null) => void
}) {
  const budgetConfig = resolveBudgetConfig(input.capability.controlSpec ?? null)
  const currentValue = resolveThinkingSelectionValue(input.currentSelection, input.capability)
  const currentBudgetTokens = resolveBudgetTokens(currentValue, budgetConfig.min, budgetConfig.max, budgetConfig.step)

  return (
    <div className="copilot-chat__thinking-budget" data-testid="chat-thinking-editor-budget">
      <div className="copilot-chat__thinking-budget-card">
        <div className="copilot-chat__thinking-budget-header">
          <span className="copilot-chat__thinking-budget-label">预算</span>
          <span className="copilot-chat__thinking-budget-value" data-testid="chat-thinking-budget-value">
            {formatBudgetValueLabel(currentValue, currentBudgetTokens)}
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

function buildThinkingSeriesLabel(capability: RuntimeThinkingCapability): string {
  return capability.seriesLabelZh ?? capability.series ?? '未命名系列'
}

function formatThinkingSelectionLabel(
  selection: RuntimeThinkingSelection | null,
  capability: RuntimeThinkingCapability | null,
): string | null {
  const value = resolveThinkingSelectionValue(selection, capability)
  if (value === null) {
    return null
  }

  if (value.valueType === 'budget') {
    return value.mode === 'budget' && typeof value.budgetTokens === 'number'
      ? formatTokenCount(value.budgetTokens)
      : value.labelZh
  }

  return value.labelZh
}

function isThinkingSelectionActive(selection: RuntimeThinkingSelection): boolean {
  const value = resolveThinkingSelectionValue(selection, null)
  if (value === null) {
    return false
  }

  switch (value.valueType) {
    case 'fixed':
      return true
    case 'budget':
      return value.mode !== 'off'
    case 'code':
      return !isDisabledThinkingCode(value.code)
  }
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
    labelZh: `${budgetTokens} Tokens`,
  })
}

function resolveThinkingSelectionValue(
  selection: RuntimeThinkingSelection | null,
  capability: RuntimeThinkingCapability | null,
): RuntimeThinkingValue | null {
  if (selection?.value != null) {
    return selection.value
  }

  if (selection?.mode === 'budget' && typeof selection.budgetTokens === 'number') {
    return {
      valueType: 'budget',
      mode: 'budget',
      budgetTokens: selection.budgetTokens,
      labelZh: `${selection.budgetTokens} Tokens`,
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

    return {
      valueType: 'code',
      code: selection.level,
      labelZh: resolveThinkingCodeLabel(selection.level),
    }
  }

  return capability?.defaultValue ?? null
}

function isCodeThinkingSelection(selection: RuntimeThinkingSelection | null, code: string): boolean {
  const currentValue = resolveThinkingSelectionValue(selection, null)
  return currentValue?.valueType === 'code' && currentValue.code === code
}

function resolveBudgetConfig(controlSpec: RuntimeThinkingControlSpec | null | undefined) {
  const minimum = Math.max(0, Math.trunc(controlSpec?.budget?.minTokens ?? 0))
  const maximum = Math.max(minimum, Math.trunc(controlSpec?.budget?.maxTokens ?? minimum))
  const step = Math.max(1, Math.trunc(controlSpec?.budget?.stepTokens ?? 1))

  return {
    min: minimum,
    max: maximum,
    step,
  }
}

function resolveBudgetTokens(
  value: RuntimeThinkingValue | null,
  minimum: number,
  maximum: number,
  step: number,
): number {
  const rawValue = value?.valueType === 'budget' && value.mode === 'budget'
    ? value.budgetTokens
    : minimum
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return minimum
  }

  const clamped = Math.min(maximum, Math.max(minimum, Math.trunc(rawValue)))
  return minimum + (Math.round((clamped - minimum) / step) * step)
}

function formatBudgetValueLabel(
  value: RuntimeThinkingValue | null,
  currentBudgetTokens: number,
): string {
  if (value?.valueType !== 'budget') {
    return formatTokenCount(currentBudgetTokens)
  }

  if (value.mode !== 'budget' || typeof value.budgetTokens !== 'number') {
    return value.labelZh
  }

  return formatTokenCount(value.budgetTokens)
}

function resolveThinkingCodeLabel(code: string): string {
  switch (code) {
    case 'off':
    case 'none':
      return '无'
    case 'auto':
    case 'dynamic':
      return '自动'
    case 'low':
      return THINKING_LEVEL_LABELS.low
    case 'medium':
      return THINKING_LEVEL_LABELS.medium
    case 'high':
      return THINKING_LEVEL_LABELS.high
    case 'xhigh':
      return THINKING_LEVEL_LABELS.xhigh
    case 'minimal':
      return '极简'
    case 'disabled':
    case 'false':
      return '关闭'
    case 'true':
    case 'enabled':
      return '开启'
    case 'max':
      return '最大'
    case 'fixed':
      return '固定推理'
    default:
      return code
  }
}

function isDisabledThinkingCode(code: string): boolean {
  return code === 'off'
    || code === 'none'
    || code === 'disabled'
    || code === 'false'
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
