/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createProviderProfile } from '../../../workbench/settings/settings-workspace-test-fixtures'
import { createCopilotModelCatalog, createCopilotModelCatalogFromOptions } from '../model-picker'
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

    expect(rendered.queryByTestId('chat-model-option-FoxCodeAnthropic-provider-claude')).not.toBeNull()
    expect(rendered.queryByTestId('chat-model-option-Moonshot-provider-kimi')).toBeNull()

    await setFormControlValue(searchInput, '')
    await clickElement(rendered.getByTestId('chat-model-picker-tag-工具'))
    await clickElement(rendered.getByTestId('chat-model-picker-tag-免费'))

    expect(rendered.queryByTestId('chat-model-option-CherryAI-provider-qwen-free')).not.toBeNull()
    expect(rendered.queryByTestId('chat-model-option-FoxCodeAnthropic-provider-claude')).toBeNull()
    expect(rendered.queryByTestId('chat-model-option-OpenRouter-provider-gemini')).toBeNull()

    await clickElement(rendered.getByTestId('chat-model-picker-tag-all'))

    expect(rendered.queryByTestId('chat-model-option-OpenRouter-provider-gemini')).not.toBeNull()
    expect(rendered.queryByTestId('chat-model-option-Moonshot-provider-kimi')).not.toBeNull()

    await clickElement(rendered.getByTestId('chat-model-picker-tag-免费'))

    await clickElement(rendered.getByTestId('chat-model-option-CherryAI-provider-qwen-free'))

    expect(trigger.textContent).toContain('Qwen Free')
    expect(getTriggerIconText(trigger)).toBe('Q')
    expect(rendered.queryByTestId('chat-model-picker-panel')).toBeNull()

    rendered.unmount()
  })

  it('keeps empty provider groups, marks invalid current model, hides it from candidates, and clears invalid state after selecting a valid model', async () => {
    const rendered = renderWithRoot(<InvalidModelPickerHarness />)

    const trigger = rendered.getByTestId('chat-model-picker-trigger') as HTMLButtonElement
    const triggerValue = rendered.getByTestId('chat-model-picker-trigger-value')
    expect(trigger.textContent).toContain('legacy/retired-model')
    expect(rendered.getByTestId('chat-model-picker-invalid-badge').textContent).toContain('失效')
    expect(trigger.className).toContain('copilot-model-picker__trigger--invalid')
    expect(triggerValue.className).toContain('copilot-model-picker__trigger-value')

    await clickElement(trigger)

    expect(rendered.getByTestId('chat-model-group-empty-provider-empty')).not.toBeNull()
    expect(rendered.queryByTestId('chat-model-option-provider-active-legacy/retired-model')).toBeNull()
    expect(rendered.getByTestId('chat-model-option-provider-active-provider-active:openai/gpt-4.1')).not.toBeNull()

    await clickElement(rendered.getByTestId('chat-model-option-provider-active-provider-active:openai/gpt-4.1'))

    expect(trigger.textContent).toContain('GPT 4.1')
    expect(rendered.queryByTestId('chat-model-picker-invalid-badge')).toBeNull()
    expect(trigger.className).not.toContain('copilot-model-picker__trigger--invalid')

    rendered.unmount()
  })

  it('shows the explicit no-model label and keeps the trigger disabled when no configured models exist', () => {
    const rendered = renderWithRoot(
      <ModelPicker
        selectedModelId="openai/gpt-4.1"
        groups={[]}
        onSelectModel={() => {
          throw new Error('No model should be selectable when no configured models exist.')
        }}
      />,
    )

    const trigger = rendered.getByTestId('chat-model-picker-trigger') as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    expect(trigger.textContent).toContain('尚未配置模型')
    expect(rendered.queryByTestId('chat-model-picker-invalid-badge')).toBeNull()

    rendered.unmount()
  })
})

const TEST_MODEL_CATALOG = createCopilotModelCatalogFromOptions([
  createOption({
    id: 'provider-gemini',
    modelId: 'openrouter/gemini-2.5-pro-preview',
    name: 'Gemini 2.5 Pro Preview',
    provider: 'OpenRouter',
    group: 'OpenRouter',
    tags: ['推理', '工具', '联网'],
    icon: {
      label: 'G',
      accent: '#60a5fa',
    },
  }),
  createOption({
    id: 'provider-kimi',
    modelId: 'moonshot/kimi-k2.5',
    name: 'Kimi K2.5',
    provider: 'Moonshot',
    group: 'Moonshot',
    tags: ['推理', '联网'],
    icon: {
      label: 'K',
      accent: '#a78bfa',
    },
  }),
  createOption({
    id: 'provider-claude',
    modelId: 'anthropic/claude-opus-4.1',
    name: 'Claude Opus 4.1',
    provider: 'FoxCodeAnthropic',
    group: 'FoxCodeAnthropic',
    tags: ['推理', '工具'],
    icon: {
      label: 'C',
      accent: '#fb923c',
    },
  }),
  createOption({
    id: 'provider-qwen-free',
    modelId: 'cherry/qwen-free',
    name: 'Qwen Free',
    provider: 'CherryAI',
    group: 'CherryAI',
    tags: ['免费', '工具'],
    icon: {
      label: 'Q',
      accent: '#facc15',
    },
  }),
])

function createOption(input: {
  id: string
  modelId: string
  name: string
  provider: string
  group: string
  tags: string[]
  icon: { label: string; accent: string }
}) {
  return {
    ...input,
    route: {
      providerProfileId: input.id,
      snapshot: {
        provider: 'openai',
        endpointType: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        modelId: input.modelId,
      },
    },
  }
}

function ModelPickerHarness() {
  const [selectedModelId, setSelectedModelId] = useState(TEST_MODEL_CATALOG.models[0]?.id ?? '')

  return (
    <ModelPicker
      selectedModelId={selectedModelId}
      groups={TEST_MODEL_CATALOG.groups}
      onSelectModel={(model) => {
        setSelectedModelId(model.id)
      }}
    />
  )
}

function InvalidModelPickerHarness() {
  const [selectedModelId, setSelectedModelId] = useState('legacy/retired-model')
  const groups = createCopilotModelCatalog([
    createProviderProfile({
      id: 'provider-active',
      name: 'Active Provider',
      availableModels: [
        {
          id: 'provider-active:openai/gpt-4.1',
          modelId: 'openai/gpt-4.1',
          displayName: 'GPT 4.1',
          groupName: 'OpenAI',
          capabilities: ['reasoning', 'tools'],
          supportsStreaming: true,
          currency: 'usd',
          inputPrice: '1',
          outputPrice: '2',
        },
      ],
    }),
    createProviderProfile({
      id: 'provider-empty',
      name: 'Empty Provider',
      availableModels: [],
    }),
  ]).groups

  return (
    <ModelPicker
      selectedModelId={selectedModelId}
      groups={groups}
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
