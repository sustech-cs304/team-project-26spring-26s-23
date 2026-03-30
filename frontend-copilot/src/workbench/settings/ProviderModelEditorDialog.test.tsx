/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

import { renderWithRoot, clickElement } from './SettingsWorkspace.test-support'
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
})
