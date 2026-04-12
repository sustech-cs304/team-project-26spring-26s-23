/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

import { getThinkingBudgetProgressFromTokens } from '../thinking-display'
import type { ProviderProfile } from '../types'
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

function createProviderProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'openai-1',
    profileId: 'openai-1',
    providerId: 'openai',
    name: 'OpenAI',
    displayName: 'OpenAI',
    protocol: 'openai',
    endpoint: 'https://api.openai.com/v1',
    baseUrl: 'https://api.openai.com/v1',
    hasApiKey: false,
    fastModel: '',
    fallbackModel: '',
    organization: '',
    region: '',
    notes: '',
    availableModels: [],
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

  it('labels the configured selection as default', () => {
    const rendered = renderWithRoot(
      <ProviderModelEditorDialog
        modelEditorState={createModelEditorState({
          thinkingCapability: {
            supported: true,
            series: 'qwen-thinking-switch-v1',
            template: {
              editorType: 'discrete',
              allowedValues: [
                { valueType: 'code', code: 'false', labelZh: '关闭' },
                { valueType: 'code', code: 'true', labelZh: '开启' },
              ],
              defaultValue: { valueType: 'code', code: 'true', labelZh: '开启' },
            },
            source: 'settings-page',
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

    expect(rendered.queryByText('当前值')).toBeNull()
    expect(rendered.getByText('默认值')).toBeTruthy()

    rendered.unmount()
  })

  it('renders budget pills and writes structured override edits back through state changes', async () => {
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
    expect(rendered.getByTestId('settings-thinking-budget-mode-off')).toBeTruthy()
    expect(rendered.getByTestId('settings-thinking-budget-mode-dynamic')).toBeTruthy()
    expect(rendered.getByTestId('settings-thinking-budget-mode-budget')).toBeTruthy()
    expect(rendered.queryByText('最小预算')).toBeNull()
    expect(rendered.queryByText('最大预算')).toBeNull()
    expect(rendered.queryByText('步进')).toBeNull()

    await setFormControlValue(
      rendered.getByTestId('settings-thinking-budget-input') as HTMLInputElement,
      String(getThinkingBudgetProgressFromTokens(4096)),
    )

    expect(handleStateChange).toHaveBeenCalled()
    expect(handleStateChange.mock.calls[handleStateChange.mock.calls.length - 1]?.[0]).toMatchObject({
      thinkingCapability: {
        supported: true,
        series: 'gemini-2.5-budget-v1',
        input: {
          kind: 'budget',
          minTokens: 0,
          maxTokens: 1048576,
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

  it('does not render budget default modes for discrete-only series', () => {
    const rendered = renderWithRoot(
      <ProviderModelEditorDialog
        modelEditorState={createModelEditorState({
          thinkingCapability: {
            supported: true,
            series: 'openai-6-level-superset-v1',
            source: 'settings-page',
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

    expect(rendered.queryByText('默认模式')).toBeNull()
    expect(rendered.queryByTestId('settings-thinking-budget-mode-off')).toBeNull()
    expect(rendered.queryByTestId('settings-thinking-budget-mode-dynamic')).toBeNull()
    expect(rendered.queryByTestId('settings-thinking-budget-mode-budget')).toBeNull()
    expect(rendered.queryByTestId('settings-thinking-budget-input')).toBeNull()

    rendered.unmount()
  })

  it('allows switching a budget series default mode to dynamic', async () => {
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

    await clickElement(rendered.getByTestId('settings-thinking-budget-mode-dynamic'))

    expect(handleStateChange).toHaveBeenCalled()
    expect(handleStateChange.mock.calls[handleStateChange.mock.calls.length - 1]?.[0]).toMatchObject({
      thinkingCapability: {
        supported: true,
        series: 'gemini-2.5-budget-v1',
        template: {
          defaultValue: {
            valueType: 'budget',
            mode: 'dynamic',
            labelZh: '动态',
          },
        },
      },
    })

    rendered.unmount()
  })

  it('shows a compatibility warning for a clearly mismatched provider and thinking series', () => {
    const rendered = renderWithRoot(
      <ProviderModelEditorDialog
        modelEditorState={createModelEditorState({
          thinkingCapability: {
            supported: true,
            series: 'anthropic-adaptive-max-v1',
            source: 'settings-page',
          },
        })}
        providerProfile={createProviderProfile({ providerId: 'openai', protocol: 'openai' })}
        modelEditorError={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onStateChange={vi.fn()}
        onToggleCapability={vi.fn()}
        onClearError={vi.fn()}
      />,
    )

    expect(rendered.getByTestId('settings-thinking-compatibility-warning').textContent).toContain(
      '⚠ 当前模型可能不支持此类思考模式',
    )

    rendered.unmount()
  })

  it('does not show a compatibility warning for a matching provider and thinking series', () => {
    const rendered = renderWithRoot(
      <ProviderModelEditorDialog
        modelEditorState={createModelEditorState({
          thinkingCapability: {
            supported: true,
            series: 'openai-6-level-superset-v1',
            source: 'settings-page',
          },
        })}
        providerProfile={createProviderProfile({ providerId: 'openai', protocol: 'openai' })}
        modelEditorError={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onStateChange={vi.fn()}
        onToggleCapability={vi.fn()}
        onClearError={vi.fn()}
      />,
    )

    expect(rendered.queryByTestId('settings-thinking-compatibility-warning')).toBeNull()

    rendered.unmount()
  })
})
