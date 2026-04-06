/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

import { renderWithRoot, clickElement, setFormControlValue } from './SettingsWorkspace.test-support'
import { ProviderModelEditorDialog } from './ProviderModelEditorDialog'
import type { ModelEditorState } from './provider-profiles'

function createModelEditorState(overrides: Partial<ModelEditorState> = {}): ModelEditorState {
  return {
    id: 'provider:model',
    index: 0,
    modelId: 'provider/model',
    displayName: 'Provider Model',
    groupName: 'Provider',
    capabilities: ['reasoning', 'tools'],
    supportsStreaming: true,
    currency: 'usd',
    inputPrice: '0.50',
    outputPrice: '3.00',
    advancedOpen: false,
    isNew: false,
    ...overrides,
  }
}

describe('ProviderModelEditorDialog', () => {
  it('renders unselected capability tags with the neutral gray state', () => {
    const rendered = renderWithRoot(
      <ProviderModelEditorDialog
        modelEditorState={createModelEditorState({ capabilities: ['reasoning'] })}
        modelEditorError={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onStateChange={vi.fn()}
        onToggleCapability={vi.fn()}
        onClearError={vi.fn()}
      />,
    )

    const visionButton = rendered.getByText('视觉')

    expect(visionButton.getAttribute('aria-pressed')).toBe('false')
    expect(visionButton.className).toContain('model-capability-button--inactive')
    expect(visionButton.className).not.toContain('model-capability-button--vision')
    expect(visionButton.className).not.toContain('model-capability-button--active')

    rendered.unmount()
  })

  it('restores the capability-specific color class after selection', () => {
    const rendered = renderWithRoot(
      <ProviderModelEditorDialog
        modelEditorState={createModelEditorState({ capabilities: ['vision', 'reasoning'] })}
        modelEditorError={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onStateChange={vi.fn()}
        onToggleCapability={vi.fn()}
        onClearError={vi.fn()}
      />,
    )

    const visionButton = rendered.getByText('视觉')

    expect(visionButton.getAttribute('aria-pressed')).toBe('true')
    expect(visionButton.className).toContain('model-capability-button--active')
    expect(visionButton.className).toContain('model-capability-button--vision')
    expect(visionButton.className).not.toContain('model-capability-button--inactive')

    rendered.unmount()
  })

  it('keeps the existing toggle behavior when selecting and deselecting capabilities', async () => {
    const toggleCapability = vi.fn()
    const rendered = renderWithRoot(
      <ProviderModelEditorDialog
        modelEditorState={createModelEditorState({ capabilities: ['reasoning'] })}
        modelEditorError={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onStateChange={vi.fn()}
        onToggleCapability={toggleCapability}
        onClearError={vi.fn()}
      />,
    )

    await clickElement(rendered.getByText('视觉'))
    await clickElement(rendered.getByText('推理'))

    expect(toggleCapability).toHaveBeenNthCalledWith(1, 'vision')
    expect(toggleCapability).toHaveBeenNthCalledWith(2, 'reasoning')

    rendered.unmount()
  })

  it('does not render the removed discrete-level hint copy', () => {
    const rendered = renderWithRoot(
      <ProviderModelEditorDialog
        modelEditorState={createModelEditorState({
          thinkingCapability: {
            supported: true,
            levels: ['auto'],
            defaultLevel: 'auto',
          },
        })}
        modelEditorError={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onStateChange={vi.fn()}
        onToggleCapability={vi.fn()}
        onClearError={vi.fn()}
      />,
    )

    expect(rendered.queryByText('仅保存当前模型允许的离散档位。')).toBeNull()

    rendered.unmount()
  })

  it('renders budget series inputs and writes structured override edits back through state changes', async () => {
    const handleStateChange = vi.fn()
    const rendered = renderWithRoot(
      <ProviderModelEditorDialog
        modelEditorState={createModelEditorState({
          thinkingCapability: {
            supported: true,
            series: 'gemini-2.5-budget-v1',
            input: {
              kind: 'budget',
              minTokens: 0,
              maxTokens: 32768,
              stepTokens: 1024,
            },
            defaultSelection: {
              mode: 'budget',
              budgetTokens: 8192,
            },
            source: 'settings-page',
          },
        })}
        modelEditorError={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onStateChange={handleStateChange}
        onToggleCapability={vi.fn()}
        onClearError={vi.fn()}
      />,
    )

    expect(rendered.getByText('推理系列')).toBeTruthy()
    expect(rendered.getByText('最小预算')).toBeTruthy()
    expect(rendered.getByText('最大预算')).toBeTruthy()
    expect(rendered.getByText('步进')).toBeTruthy()

    await setFormControlValue(rendered.getByPlaceholder('8192') as HTMLInputElement, '4096')

    expect(handleStateChange).toHaveBeenCalled()
    expect(handleStateChange.mock.calls[handleStateChange.mock.calls.length - 1]?.[0]).toMatchObject({
      thinkingCapability: {
        supported: true,
        series: 'gemini-2.5-budget-v1',
        input: {
          kind: 'budget',
          minTokens: 0,
          maxTokens: 32768,
          stepTokens: 1024,
        },
        defaultSelection: {
          mode: 'budget',
          budgetTokens: 4096,
        },
      },
    })

    rendered.unmount()
  })
})
