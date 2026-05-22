import { useRef, type ChangeEventHandler, type KeyboardEventHandler } from 'react'

import {
  THINKING_BUDGET_FIXED_ANCHORS,
  THINKING_BUDGET_FIXED_ANCHOR_PROGRESS,
  formatThinkingTokenCount,
  getThinkingBudgetProgressFromTokens,
  getThinkingBudgetTokensFromProgress,
} from '../workbench/thinking-display'
import { useGSAP, gsap } from '../workbench/animation-utils'

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

function findEdgeNavigableThinkingPillOptionIndex(
  options: readonly ThinkingPillOption[],
  boundary: 'start' | 'end',
  readOnly: boolean,
): number | null {
  const startIndex = boundary === 'start' ? 0 : options.length - 1
  const step = boundary === 'start' ? 1 : -1

  for (
    let candidateIndex = startIndex;
    candidateIndex >= 0 && candidateIndex < options.length;
    candidateIndex += step
  ) {
    const candidate = options[candidateIndex]
    if (candidate !== undefined && isNavigableThinkingPillOption(candidate, readOnly)) {
      return candidateIndex
    }
  }

  return null
}

interface ThinkingPillRenderContext {
  options: readonly ThinkingPillOption[]
  optionRefs: React.MutableRefObject<Array<HTMLDivElement | null>>
  activeIndex: number
  compact: boolean
  readOnly: boolean
  handleOptionKeyDown: (index: number) => React.KeyboardEventHandler<HTMLDivElement>
}

/** Extracted to reduce cognitive complexity of ThinkingPillGroup. */
function renderThinkingPillOption(option: ThinkingPillOption, index: number, ctx: ThinkingPillRenderContext) {
  const interactive = isNavigableThinkingPillOption(option, ctx.readOnly)
  const ariaDisabled = ctx.readOnly || option.disabled === true || typeof option.onSelect !== 'function'
  const pillClassName = [
    'thinking-pill',
    option.selected ? 'thinking-pill--selected' : '',
    option.muted ? 'thinking-pill--muted' : '',
    ctx.compact ? 'thinking-pill--compact' : '',
    ariaDisabled ? 'thinking-pill--disabled' : '',
  ].filter((value) => value !== '').join(' ')

  const { key: pillKey, ...restProps } = {
    key: option.key,
    ref: (element: HTMLDivElement | null) => { ctx.optionRefs.current[index] = element },
    role: 'radio' as const,
    tabIndex: index === ctx.activeIndex ? 0 : -1,
    className: pillClassName,
    'data-testid': option.testId,
    title: option.title,
  }

  if (option.selected && ariaDisabled) {
    return (
      <div key={pillKey} {...restProps} aria-checked="true" aria-disabled="true" onKeyDown={ctx.handleOptionKeyDown(index)}>
        <span className="thinking-pill__label">{option.labelZh}</span>
      </div>
    )
  }

  if (option.selected) {
    return (
      <div
        key={pillKey}
        {...restProps}
        aria-checked="true"
        onClick={interactive ? option.onSelect : undefined}
        onKeyDown={ctx.handleOptionKeyDown(index)}
      >
        <span className="thinking-pill__label">{option.labelZh}</span>
      </div>
    )
  }

  if (ariaDisabled) {
    return (
      <div key={pillKey} {...restProps} aria-checked="false" aria-disabled="true" onKeyDown={ctx.handleOptionKeyDown(index)}>
        <span className="thinking-pill__label">{option.labelZh}</span>
      </div>
    )
  }

  return (
    <div key={pillKey} {...restProps} aria-checked="false" onClick={option.onSelect} onKeyDown={ctx.handleOptionKeyDown(index)}>
      <span className="thinking-pill__label">{option.labelZh}</span>
    </div>
  )
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
    : (firstFocusableIndex >= 0 ? firstFocusableIndex : -1)

  const handleOptionKeyDown = (index: number): KeyboardEventHandler<HTMLDivElement> => (event) => {
    const currentOption = options[index]
    if (currentOption === undefined || !isNavigableThinkingPillOption(currentOption, readOnly)) {
      return
    }

    let targetIndex: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      targetIndex = findNextNavigableThinkingPillOptionIndex(options, index, -1, readOnly)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      targetIndex = findNextNavigableThinkingPillOptionIndex(options, index, 1, readOnly)
    } else if (event.key === 'Home') {
      targetIndex = findEdgeNavigableThinkingPillOptionIndex(options, 'start', readOnly)
    } else if (event.key === 'End') {
      targetIndex = findEdgeNavigableThinkingPillOptionIndex(options, 'end', readOnly)
    } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar') {
      event.preventDefault()
      currentOption.onSelect?.()
      return
    } else {
      return
    }

    if (targetIndex === null) {
      return
    }

    event.preventDefault()
    optionRefs.current[targetIndex]?.focus()
    options[targetIndex]?.onSelect?.()
  }

  const renderCtx: ThinkingPillRenderContext = {
    options, optionRefs, activeIndex, compact, readOnly, handleOptionKeyDown,
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
      {options.map((option, index) => renderThinkingPillOption(option, index, renderCtx))}
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
  const trackFillRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    if (trackFillRef.current) {
      gsap.to(trackFillRef.current, {
        width: `${progress}%`,
        duration: 0.2,
        ease: 'power2.out',
      })
    }
  }, { dependencies: [progress] })

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
          <div ref={trackFillRef} className="thinking-budget-slider__track-fill" style={{ width: `${progress}%` }} />

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
