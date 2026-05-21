/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi, afterEach } from 'vitest'

import {
  ThinkingPillGroup,
  ThinkingBudgetSlider,
  type ThinkingPillOption,
} from './ThinkingControls'

type RenderedRoot = {
  container: HTMLDivElement
  unmount: () => void
}

function renderIntoContainer(element: React.ReactElement): RenderedRoot {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return {
    container,
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

function fireKeyDown(element: Element, key: string) {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }),
    )
  })
}

function fireChange(element: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set
  if (valueSetter === undefined) {
    throw new Error('Unable to resolve native value setter')
  }
  act(() => {
    const prev = element.value
    valueSetter.call(element, value)
    const tracker = (
      element as HTMLInputElement & {
        _valueTracker?: { setValue: (v: string) => void }
      }
    )._valueTracker
    tracker?.setValue(prev)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function getPills(container: HTMLElement) {
  return container.querySelectorAll<HTMLDivElement>('[role="radio"]')
}

function getByTestId(container: HTMLElement, testId: string): HTMLElement {
  const el = container.querySelector(`[data-testid="${testId}"]`)
  if (el === null) {
    throw new Error(`Missing element for data-testid=${testId}`)
  }
  return el as HTMLElement
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

/* ──────────────────────────────────────────────
   ThinkingPillGroup
   ────────────────────────────────────────────── */

describe('ThinkingPillGroup', () => {
  function buildOptions(
    overrides: Partial<ThinkingPillOption>[],
  ): ThinkingPillOption[] {
    const base: ThinkingPillOption[] = [
      { key: 'low', labelZh: '低', onSelect: vi.fn() },
      { key: 'medium', labelZh: '中', onSelect: vi.fn() },
      { key: 'high', labelZh: '高', onSelect: vi.fn() },
    ]
    return base.map((opt, i) => ({ ...opt, ...overrides[i] }))
  }

  it('renders all pill options passed as props', () => {
    const options = buildOptions([{ selected: true }, {}, {}])
    const { container, unmount } = renderIntoContainer(
      <ThinkingPillGroup options={options} />,
    )
    const pills = getPills(container)
    expect(pills).toHaveLength(3)
    expect(pills[0].textContent).toBe('低')
    expect(pills[1].textContent).toBe('中')
    expect(pills[2].textContent).toBe('高')
    unmount()
  })

  it('sets role="radiogroup" on the root element', () => {
    const options = buildOptions([{}, {}, {}])
    const { container, unmount } = renderIntoContainer(
      <ThinkingPillGroup options={options} />,
    )
    const group = container.querySelector('.thinking-pill-group')
    expect(group?.getAttribute('role')).toBe('radiogroup')
    unmount()
  })

  it('sets role="radio" on each pill', () => {
    const options = buildOptions([{}, {}, {}])
    const { container, unmount } = renderIntoContainer(
      <ThinkingPillGroup options={options} />,
    )
    const pills = getPills(container)
    for (const pill of Array.from(pills)) {
      expect(pill.getAttribute('role')).toBe('radio')
    }
    unmount()
  })

  it('selected pill has aria-checked="true"', () => {
    const options = buildOptions([{ selected: true }, {}, {}])
    const { container, unmount } = renderIntoContainer(
      <ThinkingPillGroup options={options} />,
    )
    const pills = getPills(container)
    expect(pills[0].getAttribute('aria-checked')).toBe('true')
    unmount()
  })

  it('unselected pills have aria-checked="false"', () => {
    const options = buildOptions([{ selected: true }, {}, {}])
    const { container, unmount } = renderIntoContainer(
      <ThinkingPillGroup options={options} />,
    )
    const pills = getPills(container)
    expect(pills[1].getAttribute('aria-checked')).toBe('false')
    expect(pills[2].getAttribute('aria-checked')).toBe('false')
    unmount()
  })

  it('only the selected pill has tabIndex=0, others have tabIndex=-1', () => {
    const options = buildOptions([{}, { selected: true }, {}])
    const { container, unmount } = renderIntoContainer(
      <ThinkingPillGroup options={options} />,
    )
    const pills = getPills(container)
    expect(pills[0].tabIndex).toBe(-1)
    expect(pills[1].tabIndex).toBe(0)
    expect(pills[2].tabIndex).toBe(-1)
    unmount()
  })

  it('when no pill is selected, the first enabled pill gets tabIndex=0', () => {
    const options = buildOptions([{}, {}, {}])
    const { container, unmount } = renderIntoContainer(
      <ThinkingPillGroup options={options} />,
    )
    const pills = getPills(container)
    expect(pills[0].tabIndex).toBe(0)
    expect(pills[1].tabIndex).toBe(-1)
    expect(pills[2].tabIndex).toBe(-1)
    unmount()
  })

  it('when first pill is disabled, the first non-disabled pill gets tabIndex=0', () => {
    const options = buildOptions([
      { disabled: true },
      {},
      {},
    ])
    const { container, unmount } = renderIntoContainer(
      <ThinkingPillGroup options={options} />,
    )
    const pills = getPills(container)
    expect(pills[0].tabIndex).toBe(-1)
    expect(pills[1].tabIndex).toBe(0)
    expect(pills[2].tabIndex).toBe(-1)
    unmount()
  })

  it('selected+disabled pill is not in tab order; fallback to first enabled', () => {
    const options = buildOptions([
      { selected: true, disabled: true },
      {},
      {},
    ])
    const { container, unmount } = renderIntoContainer(
      <ThinkingPillGroup options={options} />,
    )
    const pills = getPills(container)
    expect(pills[0].tabIndex).toBe(-1)
    expect(pills[1].tabIndex).toBe(0)
    unmount()
  })

  describe('keyboard navigation', () => {
    it('ArrowRight moves focus and calls onSelect of the next navigable pill', () => {
      const onSelect0 = vi.fn()
      const onSelect1 = vi.fn()
      const onSelect2 = vi.fn()
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', selected: true, onSelect: onSelect0 },
        { key: 'b', labelZh: 'B', onSelect: onSelect1 },
        { key: 'c', labelZh: 'C', onSelect: onSelect2 },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)

      fireKeyDown(pills[0], 'ArrowRight')

      expect(onSelect1).toHaveBeenCalledTimes(1)
      expect(onSelect2).not.toHaveBeenCalled()
      unmount()
    })

    it('ArrowLeft moves focus and calls onSelect of the previous navigable pill', () => {
      const onSelect0 = vi.fn()
      const onSelect1 = vi.fn()
      const onSelect2 = vi.fn()
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', onSelect: onSelect0 },
        { key: 'b', labelZh: 'B', selected: true, onSelect: onSelect1 },
        { key: 'c', labelZh: 'C', onSelect: onSelect2 },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)

      fireKeyDown(pills[1], 'ArrowLeft')

      expect(onSelect0).toHaveBeenCalledTimes(1)
      expect(onSelect2).not.toHaveBeenCalled()
      unmount()
    })

    it('ArrowDown acts like ArrowRight (moves to next)', () => {
      const onSelect0 = vi.fn()
      const onSelect2 = vi.fn()
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', selected: true, onSelect: onSelect0 },
        { key: 'b', labelZh: 'B', disabled: true, onSelect: vi.fn() },
        { key: 'c', labelZh: 'C', onSelect: onSelect2 },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)

      fireKeyDown(pills[0], 'ArrowDown')

      expect(onSelect2).toHaveBeenCalledTimes(1)
      unmount()
    })

    it('ArrowUp acts like ArrowLeft (moves to previous)', () => {
      const onSelect0 = vi.fn()
      const onSelect2 = vi.fn()
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', onSelect: onSelect0 },
        { key: 'b', labelZh: 'B', disabled: true, onSelect: vi.fn() },
        { key: 'c', labelZh: 'C', selected: true, onSelect: onSelect2 },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)

      fireKeyDown(pills[2], 'ArrowUp')

      expect(onSelect0).toHaveBeenCalledTimes(1)
      unmount()
    })

    it('Home moves to the first navigable pill', () => {
      const onSelect0 = vi.fn()
      const onSelect2 = vi.fn()
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', onSelect: onSelect0 },
        { key: 'b', labelZh: 'B', disabled: true, onSelect: vi.fn() },
        { key: 'c', labelZh: 'C', selected: true, onSelect: onSelect2 },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)

      fireKeyDown(pills[2], 'Home')

      expect(onSelect0).toHaveBeenCalledTimes(1)
      unmount()
    })

    it('End moves to the last navigable pill', () => {
      const onSelect0 = vi.fn()
      const onSelect2 = vi.fn()
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', selected: true, onSelect: onSelect0 },
        { key: 'b', labelZh: 'B', disabled: true, onSelect: vi.fn() },
        { key: 'c', labelZh: 'C', onSelect: onSelect2 },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)

      fireKeyDown(pills[0], 'End')

      expect(onSelect2).toHaveBeenCalledTimes(1)
      unmount()
    })

    it('Enter triggers onSelect on the current pill', () => {
      const onSelect = vi.fn()
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', onSelect },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)

      fireKeyDown(pills[0], 'Enter')

      expect(onSelect).toHaveBeenCalledTimes(1)
      unmount()
    })

    it('Space triggers onSelect on the current pill', () => {
      const onSelect = vi.fn()
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', onSelect },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)

      fireKeyDown(pills[0], ' ')

      expect(onSelect).toHaveBeenCalledTimes(1)
      unmount()
    })

    it('wraps ArrowRight from last enabled back to first enabled', () => {
      const onSelect0 = vi.fn()
      const onSelect2 = vi.fn()
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', onSelect: onSelect0 },
        { key: 'b', labelZh: 'B', disabled: true, onSelect: vi.fn() },
        { key: 'c', labelZh: 'C', selected: true, onSelect: onSelect2 },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)

      fireKeyDown(pills[2], 'ArrowRight')

      expect(onSelect0).toHaveBeenCalledTimes(1)
      unmount()
    })

    it('wraps ArrowLeft from first enabled back to last enabled', () => {
      const onSelect0 = vi.fn()
      const onSelect2 = vi.fn()
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', selected: true, onSelect: onSelect0 },
        { key: 'b', labelZh: 'B', disabled: true, onSelect: vi.fn() },
        { key: 'c', labelZh: 'C', onSelect: onSelect2 },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)

      fireKeyDown(pills[0], 'ArrowLeft')

      expect(onSelect2).toHaveBeenCalledTimes(1)
      unmount()
    })
  })

  describe('click', () => {
    it('clicking a navigable pill calls its onSelect', () => {
      const onSelect = vi.fn()
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', onSelect },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)

      act(() => {
        pills[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(onSelect).toHaveBeenCalledTimes(1)
      unmount()
    })
  })

  describe('aria-disabled states', () => {
    it('selected+disabled pill has aria-checked="true" and aria-disabled="true"', () => {
      const options = buildOptions([
        { selected: true, disabled: true },
        {},
        {},
      ])
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)
      expect(pills[0].getAttribute('aria-checked')).toBe('true')
      expect(pills[0].getAttribute('aria-disabled')).toBe('true')
      unmount()
    })

    it('selected+enabled pill has aria-checked="true" without aria-disabled', () => {
      const options = buildOptions([
        { selected: true },
        {},
        {},
      ])
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)
      expect(pills[0].getAttribute('aria-checked')).toBe('true')
      expect(pills[0].hasAttribute('aria-disabled')).toBe(false)
      unmount()
    })

    it('unselected+disabled pill has aria-checked="false" and aria-disabled="true"', () => {
      const options = buildOptions([
        {},
        { disabled: true },
        {},
      ])
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)
      expect(pills[1].getAttribute('aria-checked')).toBe('false')
      expect(pills[1].getAttribute('aria-disabled')).toBe('true')
      unmount()
    })

    it('unselected+enabled pill has aria-checked="false" without aria-disabled', () => {
      const options = buildOptions([
        { selected: true },
        {},
        {},
      ])
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pills = getPills(container)
      expect(pills[1].getAttribute('aria-checked')).toBe('false')
      expect(pills[1].hasAttribute('aria-disabled')).toBe(false)
      unmount()
    })
  })

  describe('compact', () => {
    it('compact prop adds compact classes', () => {
      const options = buildOptions([{}, {}, {}])
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} compact />,
      )
      expect(
        container.querySelector('.thinking-pill-group--compact'),
      ).toBeTruthy()
      const pills = getPills(container)
      for (const pill of Array.from(pills)) {
        expect(pill.classList.contains('thinking-pill--compact')).toBe(true)
      }
      unmount()
    })

    it('without compact prop, compact classes are absent', () => {
      const options = buildOptions([{}, {}, {}])
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      expect(
        container.querySelector('.thinking-pill-group--compact'),
      ).toBeFalsy()
      const pills = getPills(container)
      for (const pill of Array.from(pills)) {
        expect(pill.classList.contains('thinking-pill--compact')).toBe(false)
      }
      unmount()
    })
  })

  describe('readOnly', () => {
    it('readOnly adds thinking-pill-group--read-only class', () => {
      const options = buildOptions([{ selected: true }, {}, {}])
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} readOnly />,
      )
      expect(
        container.querySelector('.thinking-pill-group--read-only'),
      ).toBeTruthy()
      unmount()
    })

    it('readOnly pills all have aria-disabled="true"', () => {
      const options = buildOptions([{ selected: true }, {}, {}])
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} readOnly />,
      )
      const pills = getPills(container)
      for (const pill of Array.from(pills)) {
        expect(pill.getAttribute('aria-disabled')).toBe('true')
      }
      unmount()
    })

    it('readOnly prevents click from calling onSelect', () => {
      const onSelect = vi.fn()
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', onSelect },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} readOnly />,
      )
      const pills = getPills(container)

      act(() => {
        pills[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(onSelect).not.toHaveBeenCalled()
      unmount()
    })
  })

  describe('className and ariaLabel props', () => {
    it('passes className to the root element', () => {
      const options = buildOptions([{}, {}, {}])
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} className="my-custom" />,
      )
      const group = container.querySelector('.thinking-pill-group')
      expect(group?.classList.contains('my-custom')).toBe(true)
      unmount()
    })

    it('passes ariaLabel to the root radiogroup', () => {
      const options = buildOptions([{}, {}, {}])
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} ariaLabel="测试组" />,
      )
      const group = container.querySelector('.thinking-pill-group')
      expect(group?.getAttribute('aria-label')).toBe('测试组')
      unmount()
    })
  })

  describe('option-level props', () => {
    it('passes testId to data-testid attribute', () => {
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', testId: 'pill-a', onSelect: vi.fn() },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pill = container.querySelector('[data-testid="pill-a"]')
      expect(pill).toBeTruthy()
      unmount()
    })

    it('passes title attribute to the pill element', () => {
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', title: 'Tooltip A', onSelect: vi.fn() },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pill = getPills(container)[0]
      expect(pill.getAttribute('title')).toBe('Tooltip A')
      unmount()
    })

    it('muted pill gets thinking-pill--muted class', () => {
      const options: ThinkingPillOption[] = [
        { key: 'a', labelZh: 'A', muted: true, onSelect: vi.fn() },
      ]
      const { container, unmount } = renderIntoContainer(
        <ThinkingPillGroup options={options} />,
      )
      const pill = getPills(container)[0]
      expect(pill.classList.contains('thinking-pill--muted')).toBe(true)
      unmount()
    })
  })
})

/* ──────────────────────────────────────────────
   ThinkingBudgetSlider
   ────────────────────────────────────────────── */

describe('ThinkingBudgetSlider', () => {
  it('renders with the progress width on the track fill', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
      />,
    )
    const fill = container.querySelector<HTMLDivElement>(
      '.thinking-budget-slider__track-fill',
    )
    expect(fill).toBeTruthy()
    expect(fill!.style.width).toBeTruthy()
    unmount()
  })

  it('renders fixed anchor markers', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
      />,
    )
    const dots = container.querySelectorAll('.thinking-budget-slider__dot')
    const anchors = container.querySelectorAll('.thinking-budget-slider__anchor')
    expect(dots.length).toBe(5)
    expect(anchors.length).toBe(5)
    unmount()
  })

  it('renders anchor labels', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
      />,
    )
    const anchors = container.querySelectorAll<HTMLSpanElement>(
      '.thinking-budget-slider__anchor',
    )
    const labels = Array.from(anchors).map((el) => el.textContent)
    expect(labels).toContain('0')
    expect(labels).toContain('4K')
    expect(labels).toContain('32K')
    expect(labels).toContain('128K')
    expect(labels).toContain('1M')
    unmount()
  })

  it('range input has min=0, max=100, step=0.1', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
      />,
    )
    const rangeInput = container.querySelector<HTMLInputElement>(
      '.thinking-budget-slider__input',
    )
    expect(rangeInput).toBeTruthy()
    expect(rangeInput!.min).toBe('0')
    expect(rangeInput!.max).toBe('100')
    expect(rangeInput!.step).toBe('0.1')
    unmount()
  })

  it('range input has aria-label="推理预算" by default', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
      />,
    )
    const rangeInput = container.querySelector<HTMLInputElement>(
      '.thinking-budget-slider__input',
    )
    expect(rangeInput?.getAttribute('aria-label')).toBe('推理预算')
    unmount()
  })

  it('custom ariaLabel is passed to the range input', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
        ariaLabel="自定义滑块"
      />,
    )
    const rangeInput = container.querySelector<HTMLInputElement>(
      '.thinking-budget-slider__input',
    )
    expect(rangeInput?.getAttribute('aria-label')).toBe('自定义滑块')
    unmount()
  })

  it('displays the formatted token count', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
      />,
    )
    const valueEl = container.querySelector(
      '.thinking-budget-slider__value',
    )
    expect(valueEl?.textContent).toBe('32K')
    unmount()
  })

  it('value element uses valueTestId prop', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={8192}
        onBudgetTokensChange={vi.fn()}
        valueTestId="custom-value-id"
      />,
    )
    const el = getByTestId(container, 'custom-value-id')
    expect(el.textContent).toBe('8K')
    unmount()
  })

  it('input element uses inputTestId prop', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={8192}
        onBudgetTokensChange={vi.fn()}
        inputTestId="custom-input-id"
      />,
    )
    expect(() => getByTestId(container, 'custom-input-id')).not.toThrow()
    unmount()
  })

  it('calls onBudgetTokensChange when slider value changes', () => {
    const onChange = vi.fn()
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={onChange}
        inputTestId="slider-input"
      />,
    )
    const rangeInput = getByTestId(container, 'slider-input') as HTMLInputElement

    fireChange(rangeInput, '75')

    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = (onChange.mock.calls[0] as number[])[0]
    expect(typeof arg).toBe('number')
    unmount()
  })

  it('disabled slider has disabled attribute on the input', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
        disabled
      />,
    )
    const rangeInput = container.querySelector<HTMLInputElement>(
      '.thinking-budget-slider__input',
    )
    expect(rangeInput?.disabled).toBe(true)
    unmount()
  })

  it('compact mode adds compact class', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
        compact
      />,
    )
    expect(
      container.querySelector('.thinking-budget-slider--compact'),
    ).toBeTruthy()
    unmount()
  })

  it('without compact mode, compact class is absent', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
      />,
    )
    expect(
      container.querySelector('.thinking-budget-slider--compact'),
    ).toBeFalsy()
    unmount()
  })

  it('renders label text when label prop is provided', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
        label="推理预算"
      />,
    )
    const labelEl = container.querySelector('.thinking-budget-slider__label')
    expect(labelEl?.textContent).toBe('推理预算')
    unmount()
  })

  it('when label prop is absent, no thinking-budget-slider__label is rendered', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
      />,
    )
    const labelEl = container.querySelector('.thinking-budget-slider__label')
    expect(labelEl).toBeNull()
    unmount()
  })

  it('marks anchors with progress >= current progress as active', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={131072}
        onBudgetTokensChange={vi.fn()}
      />,
    )
    const dots = container.querySelectorAll<HTMLSpanElement>(
      '.thinking-budget-slider__dot',
    )
    const activeDots = container.querySelectorAll<HTMLSpanElement>(
      '.thinking-budget-slider__dot--active',
    )
    // 131072 => progress=75%. Anchors at 0,25,50,75 should be active, 100 not.
    expect(activeDots.length).toBe(4)
    expect(dots[4].classList.contains('thinking-budget-slider__dot--active')).toBe(false)
    unmount()
  })

  it('className prop is applied to root element', () => {
    const { container, unmount } = renderIntoContainer(
      <ThinkingBudgetSlider
        budgetTokens={32768}
        onBudgetTokensChange={vi.fn()}
        className="custom-slider"
      />,
    )
    expect(
      container.querySelector('.thinking-budget-slider.custom-slider'),
    ).toBeTruthy()
    unmount()
  })
})
