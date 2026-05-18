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
} from '../../../workbench/thinking-display'
import { clampComposerHeight } from '../copilot-chat-helpers'
import type {
  RuntimeThinkingCapability,
  RuntimeThinkingSelection,
  RuntimeThinkingValue,
} from '../thread-run-contract'

export function buildComposerSurfaceHeightClassName(composerHeight: number): string {
  return `copilot-chat__composer-surface--height-${clampComposerHeight(composerHeight)}`
}

export function renderThinkingControlBody(input: {
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

export function buildThinkingSeriesLabel(capability: RuntimeThinkingCapability): string {
  return capability.seriesLabelZh ?? capability.series ?? '未命名系列'
}

export function isThinkingSelectionActive(selection: RuntimeThinkingSelection): boolean {
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

export function resolveThinkingSelectionValue(
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
