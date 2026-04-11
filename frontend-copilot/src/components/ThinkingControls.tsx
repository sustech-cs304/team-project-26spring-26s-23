import { useRef, type ChangeEventHandler, type KeyboardEventHandler } from 'react'

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

function isNavigableThinkingPillOption(option: ThinkingPillOption, readOnly: boolean) {
  return !readOnly && option.disabled !== true && typeof option.onSelect === 'function'
}

function findNextNavigableThinkingPillOptionIndex(
  options: readonly ThinkingPillOption[],
  startIndex: number,
  direction: -1 | 1,
  readOnly: boolean,
): number | null {
  if (options.length < 2) {
    return null
  }

  for (let offset = 1; offset < options.length; offset += 1) {
    const candidateIndex = (startIndex + direction * offset + options.length) % options.length
    const candidate = options[candidateIndex]
    if (candidate !== undefined && isNavigableThinkingPillOption(candidate, readOnly)) {
      return candidateIndex
    }
  }

  return null
}

export function ThinkingPillGroup({
  options,
  ariaLabel,
  className,
  compact = false,
  readOnly = false,
}: ThinkingPillGroupProps) {
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])
  const selectedFocusableIndex = options.findIndex((option) => option.selected === true && option.disabled !== true)
  const firstFocusableIndex = options.findIndex((option) => option.disabled !== true)
  const activeIndex = selectedFocusableIndex >= 0
    ? selectedFocusableIndex
    : (firstFocusableIndex >= 0 ? firstFocusableIndex : 0)

  const handleOptionKeyDown = (index: number): KeyboardEventHandler<HTMLDivElement> => (event) => {
    let direction: -1 | 1 | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      direction = -1
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      direction = 1
    }

    if (direction === null || readOnly) {
      return
    }

    const nextIndex = findNextNavigableThinkingPillOptionIndex(options, index, direction, readOnly)
    if (nextIndex === null) {
      return
    }

    event.preventDefault()
    optionRefs.current[nextIndex]?.focus()
    options[nextIndex]?.onSelect?.()
  }

  return (
    <div
      className={[
        'thinking-pill-group',
        compact ? 'thinking-pill-group--compact' : '',
        readOnly ? 'thinking-pill-group--read-only' : '',
        className ?? '',
      ].filter((value) => value !== '').join(' ')}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option, index) => {
        const interactive = isNavigableThinkingPillOption(option, readOnly)
        const ariaDisabled = readOnly || option.disabled === true || typeof option.onSelect !== 'function'
        const className = [
          'thinking-pill',
          option.selected ? 'thinking-pill--selected' : '',
          option.muted ? 'thinking-pill--muted' : '',
          compact ? 'thinking-pill--compact' : '',
          ariaDisabled ? 'thinking-pill--disabled' : '',
        ].filter((value) => value !== '').join(' ')

        if (option.selected === true && ariaDisabled) {
          return (
            <div
              key={option.key}
              ref={(element) => {
                optionRefs.current[index] = element
              }}
              role="radio"
              aria-checked="true"
              aria-disabled="true"
              tabIndex={index === activeIndex ? 0 : -1}
              className={className}
              data-testid={option.testId}
              title={option.title}
              onKeyDown={handleOptionKeyDown(index)}
            >
              <span className="thinking-pill__label">{option.labelZh}</span>
            </div>
          )
        }

        if (option.selected === true) {
          return (
            <div
              key={option.key}
              ref={(element) => {
                optionRefs.current[index] = element
              }}
              role="radio"
              aria-checked="true"
              tabIndex={index === activeIndex ? 0 : -1}
              className={className}
              data-testid={option.testId}
              title={option.title}
              onClick={interactive ? option.onSelect : undefined}
              onKeyDown={handleOptionKeyDown(index)}
            >
              <span className="thinking-pill__label">{option.labelZh}</span>
            </div>
          )
        }

        if (ariaDisabled) {
          return (
            <div
              key={option.key}
              ref={(element) => {
                optionRefs.current[index] = element
              }}
              role="radio"
              aria-checked="false"
              aria-disabled="true"
              tabIndex={index === activeIndex ? 0 : -1}
              className={className}
              data-testid={option.testId}
              title={option.title}
              onKeyDown={handleOptionKeyDown(index)}
            >
              <span className="thinking-pill__label">{option.labelZh}</span>
            </div>
          )
        }

        return (
          <div
            key={option.key}
            ref={(element) => {
              optionRefs.current[index] = element
            }}
            role="radio"
            aria-checked="false"
            tabIndex={index === activeIndex ? 0 : -1}
            className={className}
            data-testid={option.testId}
            title={option.title}
            onClick={option.onSelect}
            onKeyDown={handleOptionKeyDown(index)}
          >
            <span className="thinking-pill__label">{option.labelZh}</span>
          </div>
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
