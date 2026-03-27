/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DEFAULT_COPILOT_MODEL_ID } from '../model-picker'
import { ModelPicker } from './ModelPicker'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
})

describe('ModelPicker', () => {
  it('renders the default trigger, opens the panel, filters by search and tag, then updates icon and text after selection', async () => {
    const rendered = renderWithRoot(<ModelPickerHarness />)

    const trigger = rendered.getByTestId('chat-model-picker-trigger') as HTMLButtonElement
    expect(trigger.textContent).toContain('Gemini 2.5 Pro Preview')
    expect(getTriggerIconText(trigger)).toBe('G')

    await clickElement(trigger)

    expect(rendered.getByTestId('chat-model-picker-panel')).not.toBeNull()
    expect(rendered.container.textContent).toContain('OpenRouter')
    expect(rendered.container.textContent).toContain('FoxCodeAnthropic')

    const searchInput = rendered.getByTestId('chat-model-picker-search') as HTMLInputElement
    await setFormControlValue(searchInput, 'claude')

    expect(rendered.queryByTestId('chat-model-option-anthropic/claude-opus-4.1')).not.toBeNull()
    expect(rendered.queryByTestId('chat-model-option-moonshot/kimi-k2.5')).toBeNull()

    await setFormControlValue(searchInput, '')
    await clickElement(rendered.getByTestId('chat-model-picker-tag-工具'))
    await clickElement(rendered.getByTestId('chat-model-picker-tag-免费'))

    expect(rendered.queryByTestId('chat-model-option-cherry/qwen-free')).not.toBeNull()
    expect(rendered.queryByTestId('chat-model-option-anthropic/claude-opus-4.1')).toBeNull()
    expect(rendered.queryByTestId('chat-model-option-openrouter/gemini-2.5-pro-preview')).toBeNull()

    await clickElement(rendered.getByTestId('chat-model-picker-tag-all'))

    expect(rendered.queryByTestId('chat-model-option-openrouter/gemini-2.5-pro-preview')).not.toBeNull()
    expect(rendered.queryByTestId('chat-model-option-moonshot/kimi-k2.5')).not.toBeNull()

    await clickElement(rendered.getByTestId('chat-model-picker-tag-免费'))

    await clickElement(rendered.getByTestId('chat-model-option-cherry/qwen-free'))

    expect(trigger.textContent).toContain('Qwen Free')
    expect(getTriggerIconText(trigger)).toBe('Q')
    expect(rendered.queryByTestId('chat-model-picker-panel')).toBeNull()

    rendered.unmount()
  })
})

function ModelPickerHarness() {
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_COPILOT_MODEL_ID)

  return (
    <ModelPicker
      selectedModelId={selectedModelId}
      onSelectModel={(model) => {
        setSelectedModelId(model.id)
      }}
    />
  )
}

function renderWithRoot(element: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(element)
  })

  return {
    container,
    getByTestId(testId: string) {
      const target = container.querySelector(`[data-testid="${testId}"]`)
      if (target === null) {
        throw new Error(`Missing element for data-testid=${testId}`)
      }

      return target
    },
    queryByTestId(testId: string) {
      return container.querySelector(`[data-testid="${testId}"]`)
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

function getTriggerIconText(trigger: HTMLButtonElement): string {
  const icon = trigger.querySelector('.copilot-model-picker__icon')
  return icon?.textContent ?? ''
}

async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function setFormControlValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

  if (valueSetter === undefined) {
    throw new Error('Unable to resolve native value setter')
  }

  await act(async () => {
    const previousValue = element.value
    valueSetter.call(element, value)
    const tracker = (element as HTMLInputElement & { _valueTracker?: { setValue: (nextValue: string) => void } })._valueTracker
    tracker?.setValue(previousValue)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
