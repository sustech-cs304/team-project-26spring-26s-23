import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

import type { ModelCapability, ProviderModelProfile, ProviderProfile } from '../types'
import { initializeSupportedThinkingCapabilityDeclaration } from '../thinking-capabilities'
import { createModelProfileId } from './config'
import {
  createEmptyModelEditorState,
  formatModelDisplayName,
  formatModelGroupName,
  syncTrackedModelValue,
  type ModelEditorState,
} from './provider-profiles'

interface UseSettingsWorkspaceProviderModelEditorArgs {
  activeProviderId: string
  activeProvider: ProviderProfile | null
  setProviderProfiles: Dispatch<SetStateAction<ProviderProfile[]>>
  setPrimaryAssistantModel: Dispatch<SetStateAction<string>>
  setFastAssistantModel: Dispatch<SetStateAction<string>>
}

interface UseSettingsWorkspaceProviderModelEditorResult {
  modelEditorState: ModelEditorState | null
  modelEditorError: string | null
  handleOpenCreateModelEditor: () => void
  handleOpenModelEditor: (index: number) => void
  handleRemoveModel: (index: number) => void
  handleCloseModelEditor: () => void
  handleSaveModel: () => void
  updateModelEditorState: (patch: Partial<ModelEditorState>) => void
  handleToggleModelCapability: (capability: ModelCapability) => void
  clearModelEditorError: () => void
}

export function useSettingsWorkspaceProviderModelEditor({
  activeProviderId,
  activeProvider,
  setProviderProfiles,
  setPrimaryAssistantModel,
  setFastAssistantModel,
}: UseSettingsWorkspaceProviderModelEditorArgs): UseSettingsWorkspaceProviderModelEditorResult {
  const [modelEditorState, setModelEditorState] = useState<ModelEditorState | null>(null)
  const [modelEditorError, setModelEditorError] = useState<string | null>(null)

  useEffect(() => {
    setModelEditorState(null)
    setModelEditorError(null)
  }, [activeProviderId])

  const commitActiveProviderModels = (
    nextModels: ProviderModelProfile[],
    options?: { previousModelId?: string | null; nextModelId?: string | null },
  ) => {
    const previousModelId = options?.previousModelId ?? null
    const nextModelId = options?.nextModelId ?? null

    setProviderProfiles((previous) =>
      previous.map((profile) => {
        if (profile.id !== activeProviderId) {
          return profile
        }

        return {
          ...profile,
          availableModels: nextModels,
          defaultModel: syncTrackedModelValue(profile.defaultModel, previousModelId, nextModelId),
          fastModel: syncTrackedModelValue(profile.fastModel, previousModelId, nextModelId),
          fallbackModel: syncTrackedModelValue(profile.fallbackModel, previousModelId, nextModelId),
        }
      }),
    )

    setPrimaryAssistantModel((current) => syncTrackedModelValue(current, previousModelId, nextModelId))
    setFastAssistantModel((current) => syncTrackedModelValue(current, previousModelId, nextModelId))
  }

  const handleOpenCreateModelEditor = () => {
    if (!activeProvider) {
      return
    }

    setModelEditorError(null)
    setModelEditorState(createEmptyModelEditorState(activeProvider.name, activeProvider.availableModels.length))
  }

  const handleOpenModelEditor = (index: number) => {
    if (!activeProvider) {
      return
    }

    const currentModel = activeProvider.availableModels[index]

    if (!currentModel) {
      return
    }

    setModelEditorError(null)
    setModelEditorState({
      ...currentModel,
      index,
      advancedOpen: false,
      isNew: false,
    })
  }

  const handleRemoveModel = (index: number) => {
    if (!activeProvider) {
      return
    }

    const previousModelId = activeProvider.availableModels[index]?.modelId ?? null
    const nextModels = activeProvider.availableModels.filter((_, modelIndex) => modelIndex !== index)

    commitActiveProviderModels(nextModels, {
      previousModelId,
      nextModelId: nextModels[0]?.modelId ?? null,
    })
    setModelEditorState(null)
  }

  const handleCloseModelEditor = () => {
    setModelEditorError(null)
    setModelEditorState(null)
  }

  const handleSaveModel = () => {
    if (!modelEditorState || !activeProvider) {
      return
    }

    const nextModelId = modelEditorState.modelId.trim()

    if (!nextModelId) {
      return
    }

    const duplicateModelIndex = activeProvider.availableModels.findIndex((model, index) => {
      return model.modelId === nextModelId && index !== modelEditorState.index
    })

    if (duplicateModelIndex !== -1) {
      setModelEditorError('模型 ID 已存在，请使用不同的模型 ID。')
      return
    }

    if (modelEditorState.thinkingCapability?.supported === true) {
      const normalizedThinkingCapability = initializeSupportedThinkingCapabilityDeclaration(modelEditorState.thinkingCapability)
      if (normalizedThinkingCapability.levels.length === 0) {
        setModelEditorError('显式支持思考时，至少需要选择一个可用档位。')
        return
      }
    }

    const nextModel: ProviderModelProfile = {
      id: modelEditorState.isNew ? createModelProfileId(activeProvider.id, nextModelId) : modelEditorState.id,
      modelId: nextModelId,
      displayName: modelEditorState.displayName.trim() || formatModelDisplayName(nextModelId),
      groupName: modelEditorState.groupName.trim() || formatModelGroupName(nextModelId, activeProvider.name),
      capabilities: modelEditorState.capabilities.length > 0 ? modelEditorState.capabilities : ['reasoning'],
      thinkingCapability: modelEditorState.thinkingCapability?.supported === true
        ? initializeSupportedThinkingCapabilityDeclaration(modelEditorState.thinkingCapability)
        : modelEditorState.thinkingCapability,
      supportsStreaming: modelEditorState.supportsStreaming,
      currency: modelEditorState.currency,
      inputPrice: modelEditorState.inputPrice,
      outputPrice: modelEditorState.outputPrice,
    }

    if (modelEditorState.isNew) {
      commitActiveProviderModels([...activeProvider.availableModels, nextModel])
    } else {
      const previousModelId = activeProvider.availableModels[modelEditorState.index]?.modelId ?? null
      const nextModels = activeProvider.availableModels.map((model, modelIndex) => {
        return modelIndex === modelEditorState.index ? nextModel : model
      })

      commitActiveProviderModels(nextModels, { previousModelId, nextModelId })
    }

    setModelEditorState(null)
  }

  const updateModelEditorState = (patch: Partial<ModelEditorState>) => {
    setModelEditorState((previous) => (previous ? { ...previous, ...patch } : previous))
  }

  const handleToggleModelCapability = (capability: ModelCapability) => {
    setModelEditorState((previous) => {
      if (!previous) {
        return previous
      }

      const capabilities = previous.capabilities.includes(capability)
        ? previous.capabilities.filter((item) => item !== capability)
        : [...previous.capabilities, capability]

      return {
        ...previous,
        capabilities,
      }
    })
  }

  return {
    modelEditorState,
    modelEditorError,
    handleOpenCreateModelEditor,
    handleOpenModelEditor,
    handleRemoveModel,
    handleCloseModelEditor,
    handleSaveModel,
    updateModelEditorState,
    handleToggleModelCapability,
    clearModelEditorError: () => setModelEditorError(null),
  }
}
