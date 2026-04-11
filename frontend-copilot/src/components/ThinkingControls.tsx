import type { ChangeEventHandler } from 'react'

import {
  THINKING_BUDGET_FIXED_ANCHORS,
  THINKING_BUDGET_FIXED_ANCHOR_PROGRESS,
  formatThinkingTokenCount,
  getThinkingBudgetProgressFromTokens,
  getThinkingBudgetTokensFromProgress,
} from '../workbench/thinking-display'

export interface ThinkingPillOption {
  key: string
  labelZh: string
  code?: string | null
  selected?: boolean
  muted?: boolean
  disabled?: boolean
  testId?: string
  title?: string
  onSelect?: () => void
}

interface ThinkingPillGroupProps {
  options: readonly ThinkingPillOption[]
  ariaLabel?: string
  className?: string
  compact?: boolean
  readOnly?: boolean
}

interface ThinkingBudgetSliderProps {
  budgetTokens: number
  disabled?: boolean
  compact?: boolean
  label?: string
  ariaLabel?: string
  className?: string
  inputTestId?: string
  valueTestId?: string
  onBudgetTokensChange: (budgetTokens: number) => void
}

export function ThinkingPillGroup({
  options,
  ariaLabel,
  className,
  compact = false,
  readOnly = false,
}: ThinkingPillGroupProps) {
  return (
    <div
      className={[
        'thinking-pill-group',
        compact ? 'thinking-pill-group--compact' : '',
        readOnly ? 'thinking-pill-group--read-only' : '',
        className ?? '',
      ].filter((value) => value !== '').join(' ')}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const clickable = !readOnly && typeof option.onSelect === 'function'

        return (
          <button
            key={option.key}
            type="button"
            className={[
              'thinking-pill',
              option.selected ? 'thinking-pill--selected' : '',
              option.muted ? 'thinking-pill--muted' : '',
              compact ? 'thinking-pill--compact' : '',
            ].filter((value) => value !== '').join(' ')}
            {...(clickable
              ? { 'aria-pressed': option.selected === true }
              : { 'aria-current': option.selected ? 'true' : undefined })}
            disabled={option.disabled || !clickable}
            data-testid={option.testId}
            title={option.title}
            onClick={option.onSelect}
          >
            <span className="thinking-pill__label">{option.labelZh}</span>
          </button>
        )
      })}
    </div>
  )
}

export function ThinkingBudgetSlider({
  budgetTokens,
  disabled = false,
  compact = false,
  label,
  ariaLabel = '推理预算',
  className,
  inputTestId,
  valueTestId,
  onBudgetTokensChange,
}: ThinkingBudgetSliderProps) {
  const progress = getThinkingBudgetProgressFromTokens(budgetTokens)
  const handleRangeChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    onBudgetTokensChange(getThinkingBudgetTokensFromProgress(Number.parseFloat(event.currentTarget.value)))
  }

  return (
    <div
      className={[
        'thinking-budget-slider',
        compact ? 'thinking-budget-slider--compact' : '',
        className ?? '',
      ].filter((value) => value !== '').join(' ')}
    >
      <div className="thinking-budget-slider__header">
        {label ? <span className="thinking-budget-slider__label">{label}</span> : <span />}
        <span
          className="thinking-budget-slider__value"
          data-testid={valueTestId}
        >
          {formatThinkingTokenCount(budgetTokens)}
        </span>
      </div>

      <div className="thinking-budget-slider__body">
        <div className="thinking-budget-slider__track-bounds" aria-hidden="true">
          <div className="thinking-budget-slider__track-bg" />
          <div className="thinking-budget-slider__track-fill" style={{ width: `${progress}%` }} />

          {THINKING_BUDGET_FIXED_ANCHORS.map((anchor, index) => {
            const anchorProgress = THINKING_BUDGET_FIXED_ANCHOR_PROGRESS[index]
            const active = progress >= anchorProgress

            return (
              <div key={anchor.tokens}>
                <span
                  className={[
                    'thinking-budget-slider__dot',
                    active ? 'thinking-budget-slider__dot--active' : '',
                  ].filter((value) => value !== '').join(' ')}
                  style={{ left: `${anchorProgress}%` }}
                />
                <span
                  className={[
                    'thinking-budget-slider__anchor',
                    active ? 'thinking-budget-slider__anchor--active' : '',
                  ].filter((value) => value !== '').join(' ')}
                  style={{ left: `${anchorProgress}%` }}
                >
                  {anchor.label}
                </span>
              </div>
            )
          })}
        </div>

        <input
          className="thinking-budget-slider__input"
          data-testid={inputTestId}
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={progress}
          aria-label={ariaLabel}
          title={ariaLabel}
          disabled={disabled}
          onChange={handleRangeChange}
        />
      </div>
    </div>
  )
}
