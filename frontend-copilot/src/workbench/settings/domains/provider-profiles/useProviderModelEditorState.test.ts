/** @vitest-environment jsdom */

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSettingsWorkspaceProviderModelEditor } from './useProviderModelEditorState'
import type { ModelCapability, ProviderModelProfile, ProviderProfile } from '../../../types'

function createModelProfile(overrides: Partial<ProviderModelProfile> & { modelId: string }): ProviderModelProfile {
  return {
    id: `model-${overrides.modelId}`,
    modelId: overrides.modelId,
    displayName: overrides.displayName ?? overrides.modelId,
    groupName: overrides.groupName ?? 'group-' + overrides.modelId,
    capabilities: overrides.capabilities ?? ['reasoning'],
    thinkingCapability: overrides.thinkingCapability,
    supportsStreaming: overrides.supportsStreaming ?? true,
    currency: overrides.currency ?? 'usd',
    inputPrice: overrides.inputPrice ?? '0.50',
    outputPrice: overrides.outputPrice ?? '3.00',
  }
}

function createActiveProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'openrouter',
    profileId: 'openrouter',
    providerId: 'openai',
    name: 'OpenRouter',
    protocol: 'openai',
    endpoint: 'https://api.openrouter.ai/v1',
    baseUrl: 'https://api.openrouter.ai/v1',
    hasApiKey: false,
    fastModel: '',
    fallbackModel: '',
    organization: '',
    region: '',
    notes: '',
    compatibility: { status: 'active' as const, reason: '' },
    extensions: {},
    availableModels: [
      createModelProfile({ modelId: 'gpt-4', displayName: 'GPT-4' }),
      createModelProfile({ modelId: 'claude-3', displayName: 'Claude 3' }),
    ],
    ...overrides,
  }
}

describe('useSettingsWorkspaceProviderModelEditor', () => {
  let setProviderProfiles: ReturnType<typeof vi.fn>
  let setPrimaryAssistantModel: ReturnType<typeof vi.fn>
  let setFastAssistantModel: ReturnType<typeof vi.fn>

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderEditorHook(opts: {
    activeProviderId?: string
    activeProvider?: ProviderProfile | null
    setProviderProfilesImpl?: ReturnType<typeof vi.fn>
  } = {}) {
    setProviderProfiles = opts.setProviderProfilesImpl ?? vi.fn()
    setPrimaryAssistantModel = vi.fn()
    setFastAssistantModel = vi.fn()

    return renderHook(
      ({ activeProviderId, activeProvider }) =>
        useSettingsWorkspaceProviderModelEditor({
          activeProviderId,
          activeProvider,
          setProviderProfiles,
          setPrimaryAssistantModel,
          setFastAssistantModel,
        }),
      {
        initialProps: {
          activeProviderId: opts.activeProviderId ?? 'openrouter',
          activeProvider: opts.activeProvider !== undefined ? opts.activeProvider : createActiveProvider(),
        },
      },
    )
  }

  describe('initial state', () => {
    it('starts with no editor open', () => {
      const { result } = renderEditorHook()

      expect(result.current.modelEditorState).toBeNull()
      expect(result.current.modelEditorError).toBeNull()
    })

    it('closes editor when activeProviderId changes', () => {
      const { result, rerender } = renderEditorHook()

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })
      expect(result.current.modelEditorState).not.toBeNull()

      rerender({
        activeProviderId: 'deepseek',
        activeProvider: createActiveProvider({ id: 'deepseek' }),
      })

      expect(result.current.modelEditorState).toBeNull()
      expect(result.current.modelEditorError).toBeNull()
    })
  })

  describe('open create model editor', () => {
    it('opens a new model editor with default values', () => {
      const { result } = renderEditorHook()

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })

      expect(result.current.modelEditorState).not.toBeNull()
      expect(result.current.modelEditorState!.isNew).toBe(true)
      expect(result.current.modelEditorState!.modelId).toBe('')
      expect(result.current.modelEditorState!.capabilities).toContain('reasoning')
      expect(result.current.modelEditorState!.capabilities).toContain('tools')
      expect(result.current.modelEditorError).toBeNull()
    })

    it('returns early when activeProvider is null', () => {
      const { result } = renderEditorHook({
        activeProvider: null,
      })

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })

      expect(result.current.modelEditorState).toBeNull()
    })
  })

  describe('open existing model editor', () => {
    it('opens editor for an existing model at given index', () => {
      const { result } = renderEditorHook()

      act(() => {
        result.current.handleOpenModelEditor(0)
      })

      expect(result.current.modelEditorState).not.toBeNull()
      expect(result.current.modelEditorState!.isNew).toBe(false)
      expect(result.current.modelEditorState!.modelId).toBe('gpt-4')
      expect(result.current.modelEditorState!.index).toBe(0)
    })

    it('opens editor for second model', () => {
      const { result } = renderEditorHook()

      act(() => {
        result.current.handleOpenModelEditor(1)
      })

      expect(result.current.modelEditorState!.modelId).toBe('claude-3')
      expect(result.current.modelEditorState!.index).toBe(1)
    })

    it('returns early when index is out of bounds', () => {
      const { result } = renderEditorHook()

      act(() => {
        result.current.handleOpenModelEditor(99)
      })

      expect(result.current.modelEditorState).toBeNull()
    })

    it('returns early when activeProvider is null', () => {
      const { result } = renderEditorHook({
        activeProvider: null,
      })

      act(() => {
        result.current.handleOpenModelEditor(0)
      })

      expect(result.current.modelEditorState).toBeNull()
    })
  })

  describe('close model editor', () => {
    it('closes editor and clears errors', () => {
      const { result } = renderEditorHook()

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })

      act(() => {
        result.current.handleCloseModelEditor()
      })

      expect(result.current.modelEditorState).toBeNull()
      expect(result.current.modelEditorError).toBeNull()
    })
  })

  describe('update model editor state', () => {
    it('patches editor state fields', () => {
      const { result } = renderEditorHook()

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })

      act(() => {
        result.current.updateModelEditorState({
          modelId: 'gpt-5',
          displayName: 'GPT-5',
        })
      })

      expect(result.current.modelEditorState!.modelId).toBe('gpt-5')
      expect(result.current.modelEditorState!.displayName).toBe('GPT-5')
    })

    it('is a no-op when editor is not open', () => {
      const { result } = renderEditorHook()

      act(() => {
        result.current.updateModelEditorState({ modelId: 'test' })
      })

      expect(result.current.modelEditorState).toBeNull()
    })
  })

  describe('save model', () => {
    it('creates a new model and commits to provider profiles', () => {
      const setProfilesSpy = vi.fn()
      const provider = createActiveProvider()

      const { result } = renderEditorHook({
        activeProvider: provider,
        setProviderProfilesImpl: setProfilesSpy,
      })

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })

      act(() => {
        result.current.updateModelEditorState({
          modelId: 'new-model',
          displayName: 'New Model',
        })
      })

      act(() => {
        result.current.handleSaveModel()
      })

      expect(setProfilesSpy).toHaveBeenCalledTimes(1)
      const updater = setProfilesSpy.mock.calls[0][0]
      const nextProfiles = updater(provider ? [provider] : [])
      if (nextProfiles && nextProfiles.length > 0 && nextProfiles[0]) {
        expect(nextProfiles[0].availableModels).toHaveLength(3)
        expect(nextProfiles[0].availableModels[2].modelId).toBe('new-model')
      }
      expect(result.current.modelEditorState).toBeNull()
    })

    it('edits an existing model', () => {
      const setProfilesSpy = vi.fn()
      const provider = createActiveProvider()

      const { result } = renderEditorHook({
        activeProvider: provider,
        setProviderProfilesImpl: setProfilesSpy,
      })

      act(() => {
        result.current.handleOpenModelEditor(0)
      })

      act(() => {
        result.current.updateModelEditorState({
          displayName: 'GPT-4 Updated',
          currency: 'cny',
        })
      })

      act(() => {
        result.current.handleSaveModel()
      })

      expect(setProfilesSpy).toHaveBeenCalled()
      const updater = setProfilesSpy.mock.calls[0][0]

      if (provider) {
        const nextProfiles = updater([provider])
        if (nextProfiles && nextProfiles.length > 0 && nextProfiles[0]) {
          const updatedModel = nextProfiles[0].availableModels[0]
          expect(updatedModel.displayName).toBe('GPT-4 Updated')
          expect(updatedModel.currency).toBe('cny')
        }
      }
    })

    it('detects duplicate model IDs', () => {
      const setProfilesSpy = vi.fn()
      const provider = createActiveProvider()

      const { result } = renderEditorHook({
        activeProvider: provider,
        setProviderProfilesImpl: setProfilesSpy,
      })

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })

      act(() => {
        result.current.updateModelEditorState({
          modelId: 'gpt-4', // Same as existing
        })
      })

      act(() => {
        result.current.handleSaveModel()
      })

      expect(result.current.modelEditorError).toBe('模型 ID 已存在，请使用不同的模型 ID。')
      expect(result.current.modelEditorState).not.toBeNull()
      expect(setProfilesSpy).not.toHaveBeenCalled()
    })

    it('returns early when modelId is empty', () => {
      const setProfilesSpy = vi.fn()

      const { result } = renderEditorHook({
        activeProvider: createActiveProvider(),
        setProviderProfilesImpl: setProfilesSpy,
      })

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })

      act(() => {
        result.current.handleSaveModel()
      })

      expect(setProfilesSpy).not.toHaveBeenCalled()
      expect(result.current.modelEditorState).not.toBeNull()
    })

    it('returns early when editor is not open', () => {
      const setProfilesSpy = vi.fn()

      const { result } = renderEditorHook({
        setProviderProfilesImpl: setProfilesSpy,
      })

      act(() => {
        result.current.handleSaveModel()
      })

      expect(setProfilesSpy).not.toHaveBeenCalled()
    })

    it('returns early when activeProvider is null', () => {
      const setProfilesSpy = vi.fn()

      const { result } = renderEditorHook({
        activeProvider: null,
        setProviderProfilesImpl: setProfilesSpy,
      })

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })

      act(() => {
        result.current.handleSaveModel()
      })

      expect(setProfilesSpy).not.toHaveBeenCalled()
    })
  })

  describe('delete model', () => {
    it('removes a model from the provider', () => {
      const setProfilesSpy = vi.fn()
      const provider = createActiveProvider()

      const { result } = renderEditorHook({
        activeProvider: provider,
        setProviderProfilesImpl: setProfilesSpy,
      })

      act(() => {
        result.current.handleRemoveModel(0)
      })

      expect(setProfilesSpy).toHaveBeenCalled()
      expect(result.current.modelEditorState).toBeNull()

      const updater = setProfilesSpy.mock.calls[0][0]
      if (provider) {
        const nextProfiles = updater([provider])
        if (nextProfiles && nextProfiles.length > 0 && nextProfiles[0]) {
          expect(nextProfiles[0].availableModels).toHaveLength(1)
          expect(nextProfiles[0].availableModels[0].modelId).toBe('claude-3')
        }
      }
    })

    it('returns early when activeProvider is null', () => {
      const setProfilesSpy = vi.fn()

      const { result } = renderEditorHook({
        activeProvider: null,
        setProviderProfilesImpl: setProfilesSpy,
      })

      act(() => {
        result.current.handleRemoveModel(0)
      })

      expect(setProfilesSpy).not.toHaveBeenCalled()
    })
  })

  describe('capability toggling', () => {
    it('adds a capability when toggled on', () => {
      const { result } = renderEditorHook()

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })

      act(() => {
        result.current.handleToggleModelCapability('vision')
      })

      expect(result.current.modelEditorState!.capabilities).toContain('vision')
      expect(result.current.modelEditorState!.capabilities).toContain('reasoning')
      expect(result.current.modelEditorState!.capabilities).toContain('tools')
    })

    it('removes a capability when toggled off', () => {
      const { result } = renderEditorHook()

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })

      act(() => {
        result.current.handleToggleModelCapability('reasoning')
      })

      expect(result.current.modelEditorState!.capabilities).not.toContain('reasoning')
      expect(result.current.modelEditorState!.capabilities).toContain('tools')
    })

    it('can toggle embedding and rerank capabilities', () => {
      const { result } = renderEditorHook()

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })

      act(() => {
        result.current.handleToggleModelCapability('embedding')
      })
      act(() => {
        result.current.handleToggleModelCapability('rerank')
      })

      expect(result.current.modelEditorState!.capabilities).toContain('embedding')
      expect(result.current.modelEditorState!.capabilities).toContain('rerank')
    })

    it('is a no-op when editor is not open', () => {
      const { result } = renderEditorHook()

      act(() => {
        result.current.handleToggleModelCapability('vision')
      })

      expect(result.current.modelEditorState).toBeNull()
    })
  })

  describe('clear model editor error', () => {
    it('clears the editor error', () => {
      const setProfilesSpy = vi.fn()
      const provider = createActiveProvider()

      const { result } = renderEditorHook({
        activeProvider: provider,
        setProviderProfilesImpl: setProfilesSpy,
      })

      act(() => {
        result.current.handleOpenCreateModelEditor()
      })

      act(() => {
        result.current.updateModelEditorState({ modelId: 'gpt-4' })
      })

      act(() => {
        result.current.handleSaveModel()
      })

      expect(result.current.modelEditorError).toBe('模型 ID 已存在，请使用不同的模型 ID。')

      act(() => {
        result.current.clearModelEditorError()
      })

      expect(result.current.modelEditorError).toBeNull()
    })
  })
})
