/** @vitest-environment jsdom */

import { act, createRef, useMemo, useState, type FormEvent, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CopilotComposer } from './CopilotComposer'
import { createEmptyComposerDraft, type CopilotChatComposerDraft } from './copilot-chat-helpers'
import type { CopilotModelGroup, CopilotModelOption } from './model-picker'
import type { RuntimeThinkingCapability, RuntimeThinkingValue } from './thread-run-contract'
import { THINKING_LEVEL_LABELS } from '../../workbench/thinking-capabilities'
import type { AssistantSessionCapabilities } from '../../workbench/types'

vi.mock('./components/ModelPicker', () => ({
  ModelPicker: (props: {
    groups: CopilotModelGroup[]
    onSelectModel: (model: CopilotModelOption) => void
  }) => (
    <div data-testid="mock-model-picker">
      {props.groups.flatMap((group) => group.models).map((model) => (
        <button
          key={model.id}
          type="button"
          data-testid={`mock-model-select-${model.modelId}`}
          onClick={() => {
            props.onSelectModel(model)
          }}
        >
          {model.name}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('./components/ToolPicker', () => ({
  ToolPicker: () => <div data-testid="mock-tool-picker" />,
}))

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CopilotComposer thinking controls', () => {
  it('renders the thinking trigger as a labeled toolbar control', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const thinkingTrigger = rendered.getByTestId('chat-thinking-trigger') as HTMLButtonElement
      const composerSurface = rendered.getByTestId('chat-composer-surface') as HTMLDivElement
      expect(thinkingTrigger.className).toContain('copilot-model-picker__trigger')
      expect(composerSurface.className).toContain('copilot-chat__composer-surface--height-160')
      expect(composerSurface.getAttribute('style')).toBeNull()
      expect(rendered.getByTestId('chat-thinking-trigger-label').textContent).toBe('低')
      expect(thinkingTrigger.getAttribute('aria-label')).toContain('低')
    } finally {
      rendered.unmount()
    }
  })

  it('uses the latest selected model route inside the thinking updater during batched interactions', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const thinkingTrigger = rendered.getByTestId('chat-thinking-trigger') as HTMLButtonElement
      expect(thinkingTrigger.getAttribute('aria-label')).toContain('低')
      expect(rendered.getByTestId('chat-thinking-trigger-label').textContent).toBe('低')

      await clickElement(thinkingTrigger)

      await act(async () => {
        rendered.getByTestId('mock-model-select-model-b').dispatchEvent(new MouseEvent('click', { bubbles: true }))
        rendered.getByTestId('chat-thinking-option-medium').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(rendered.getByTestId('composer-selected-model').textContent).toBe('model-b')
      expect(thinkingTrigger.getAttribute('aria-label')).toContain('中')
      expect(rendered.getByTestId('chat-thinking-trigger-label').textContent).toBe('中')

      await clickElement(rendered.getByTestId('mock-model-select-model-a'))
      expect(thinkingTrigger.getAttribute('aria-label')).toContain('低')
      expect(rendered.getByTestId('chat-thinking-trigger-label').textContent).toBe('低')

      await clickElement(rendered.getByTestId('mock-model-select-model-b'))
      expect(thinkingTrigger.getAttribute('aria-label')).toContain('中')
      expect(rendered.getByTestId('chat-thinking-trigger-label').textContent).toBe('中')
    } finally {
      rendered.unmount()
    }
  })

  it('keeps thinking options product-facing without showing internal codes', async () => {
    const originalMediumLabel = THINKING_LEVEL_LABELS.medium
    THINKING_LEVEL_LABELS.medium = ''
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      await clickElement(rendered.getByTestId('chat-thinking-trigger'))
      expect(rendered.getByTestId('chat-thinking-option-medium').textContent).toContain('中')
      expect(rendered.getByTestId('chat-thinking-option-medium').textContent).not.toContain('medium')
    } finally {
      THINKING_LEVEL_LABELS.medium = originalMediumLabel
      rendered.unmount()
    }
  })

  it('exposes radiogroup semantics and supports arrow-key selection inside the same thinking group', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      await clickElement(rendered.getByTestId('chat-thinking-trigger'))

      const group = rendered.container.querySelector('[role="radiogroup"][aria-label="推理可选项"]')
      const low = rendered.getByTestId('chat-thinking-option-low') as HTMLDivElement
      const medium = rendered.getByTestId('chat-thinking-option-medium') as HTMLDivElement
      const thinkingTrigger = rendered.getByTestId('chat-thinking-trigger') as HTMLButtonElement

      expect(group).not.toBeNull()
      expect(low.getAttribute('role')).toBe('radio')
      expect(low.getAttribute('aria-checked')).toBe('true')
      expect(medium.getAttribute('aria-checked')).toBe('false')

      await pressKey(low, 'ArrowRight')

      expect(rendered.container.querySelector('[data-testid="chat-thinking-panel"]')).toBeNull()
      expect(thinkingTrigger.getAttribute('aria-label')).toContain('中')
      expect(rendered.getByTestId('chat-thinking-trigger-label').textContent).toBe('中')

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId('chat-thinking-option-medium') as HTMLDivElement).getAttribute('aria-checked')).toBe('true')
      expect((rendered.getByTestId('chat-thinking-option-low') as HTMLDivElement).getAttribute('aria-checked')).toBe('false')
    } finally {
      rendered.unmount()
    }
  })

  it('supports Home, End, Space, and Enter selection inside the same thinking group', async () => {
    const rendered = renderWithRoot(<ComposerHarness />)

    try {
      const thinkingTrigger = rendered.getByTestId('chat-thinking-trigger') as HTMLButtonElement

      await clickElement(thinkingTrigger)
      await pressKey(rendered.getByTestId('chat-thinking-option-low') as HTMLDivElement, 'End')
      expect(rendered.container.querySelector('[data-testid="chat-thinking-panel"]')).toBeNull()

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId('chat-thinking-option-medium') as HTMLDivElement).getAttribute('aria-checked')).toBe('true')
      await pressKey(rendered.getByTestId('chat-thinking-option-medium') as HTMLDivElement, 'Home')
      expect(rendered.container.querySelector('[data-testid="chat-thinking-panel"]')).toBeNull()

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId('chat-thinking-option-off') as HTMLDivElement).getAttribute('aria-checked')).toBe('true')
      await pressKey(rendered.getByTestId('chat-thinking-option-medium') as HTMLDivElement, ' ')
      expect(rendered.container.querySelector('[data-testid="chat-thinking-panel"]')).toBeNull()

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId('chat-thinking-option-medium') as HTMLDivElement).getAttribute('aria-checked')).toBe('true')
      await pressKey(rendered.getByTestId('chat-thinking-option-low') as HTMLDivElement, 'Enter')
      expect(rendered.container.querySelector('[data-testid="chat-thinking-panel"]')).toBeNull()

      await clickElement(thinkingTrigger)
      expect((rendered.getByTestId('chat-thinking-option-low') as HTMLDivElement).getAttribute('aria-checked')).toBe('true')
    } finally {
      rendered.unmount()
    }
  })
})

function ComposerHarness() {
  const modelGroups = useMemo<CopilotModelGroup[]>(() => [
    {
      key: 'provider-thinking',
      title: 'Thinking Provider',
      models: [createModelOption('model-a'), createModelOption('model-b')],
    },
  ], [])
  const [draft, setDraft] = useState<CopilotChatComposerDraft>(() => ({
    ...createEmptyComposerDraft(),
    selectedModelId: modelGroups[0].models[0]?.selectionValue ?? '',
    selectedModelRoute: cloneRoute(modelGroups[0].models[0]?.route ?? null),
  }))
  const selectedModelId = draft.selectedModelRoute?.routeRef?.modelId ?? 'none'
  const thinkingCapability = createThinkingCapability(selectedModelId)

  return (
    <>
      <div data-testid="composer-selected-model">{selectedModelId}</div>
      <CopilotComposer
        capabilities={createCapabilities()}
        modelGroups={modelGroups}
        thinkingCapability={thinkingCapability}
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
        }}
        onCancel={() => undefined}
        sendStatus="idle"
        canCancel
        sendDisabledReason={null}
        composerInputRef={createRef<HTMLTextAreaElement>()}
        composerHeight={160}
        onResizeStart={() => undefined}
      />
    </>
  )
}

function createCapabilities(): AssistantSessionCapabilities {
  return {
    capabilitiesVersion: 'cap-v12',
    allAvailableTools: [],
    recommendedToolsForAgent: [],
    defaultEnabledTools: [],
    toolSelectionMode: 'recommendation-only',
  }
}

function createThinkingCapability(modelId: string): RuntimeThinkingCapability {
  const allowedValues: RuntimeThinkingValue[] = [
    {
      valueType: 'code',
      code: 'off',
      labelZh: '关',
    },
    {
      valueType: 'code',
      code: 'low',
      labelZh: '低',
    },
    {
      valueType: 'code',
      code: 'medium',
      labelZh: '中',
    },
  ]

  return {
    status: 'verified-supported',
    source: 'verified',
    supported: true,
    series: 'compat-discrete-levels-v1',
    seriesLabelZh: '离散推理档位',
    editorType: 'discrete',
    allowedValues,
    defaultValue: allowedValues[1] ?? null,
    controlSpec: {
      kind: 'discrete',
      selectionKind: 'preset',
      presetOptions: [
        { kind: 'preset', value: 'off' },
        { kind: 'preset', value: 'low' },
        { kind: 'preset', value: 'medium' },
      ],
      fixedSelection: null,
      budget: null,
    },
    defaultSelection: {
      kind: 'preset',
      value: 'low',
    },
    supportedLevels: ['off', 'low', 'medium'],
    defaultLevel: 'low',
    providerBuilderKey: null,
    reasonCode: `${modelId}:supported`,
    providerHint: 'provider-thinking',
    routeFingerprint: {
      providerProfileId: 'provider-thinking',
      provider: 'provider-thinking',
      endpointType: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      modelId,
    },
    provenance: {
      routeStatus: 'verified',
      override: {
        present: false,
        applied: false,
        source: null,
        format: null,
      },
    },
    visibility: {
      reasoning: 'visible',
      supportsSuppression: true,
    },
    overrideLevels: [],
  }
}

function createModelOption(modelId: 'model-a' | 'model-b'): CopilotModelOption {
  return {
    id: `provider-thinking:${modelId}`,
    selectionValue: `provider-model|provider-thinking|${modelId}`,
    modelId,
    name: modelId,
    provider: 'Thinking Provider',
    group: 'Thinking Provider',
    tags: [],
    icon: {
      label: modelId === 'model-a' ? 'A' : 'B',
      accent: '#6366f1',
    },
    routeRef: {
      routeKind: 'provider-model',
      profileId: 'provider-thinking',
      modelId,
    },
    route: {
      routeRef: {
        routeKind: 'provider-model',
        profileId: 'provider-thinking',
        modelId,
      },
    },
    available: true,
    unavailableReason: null,
    thinkingCapabilityOverride: null,
  }
}

function cloneRoute(route: CopilotModelOption['route'] | null) {
  if (route === null || route.routeRef === undefined || route.routeRef === null) {
    return route
  }

  return {
    ...route,
    routeRef: {
      ...route.routeRef,
    },
  }
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
    root,
    getByTestId(testId: string) {
      const target = container.querySelector(`[data-testid="${testId}"]`)
      if (target === null) {
        throw new Error(`Missing element for data-testid=${testId}`)
      }

      return target as HTMLElement
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function pressKey(element: HTMLElement, key: string) {
  await act(async () => {
    element.focus()
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }))
  })
}
