import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'

import type { ModelCapability, ProviderModelProfile, ProviderProfile } from '../types'
import { createModelProfileId } from './config'
import {
  createCustomProvider,
  createEmptyModelEditorState,
  createPlaceholderProviderProfile,
  createProviderId,
  formatModelDisplayName,
  formatModelGroupName,
  type ModelEditorState,
  syncTrackedModelValue,
} from './provider-profiles'
import { resolveSettingsWorkspaceActiveProviderId } from './settings-workspace-controller'
import {
  clearSettingsWorkspaceProviderApiKey,
  saveSettingsWorkspaceProviderApiKey,
} from './workspace-state'

interface UseSettingsWorkspaceProviderControllerArgs {
  providerProfiles: ProviderProfile[]
  activeProviderId: string
  hydratedProviderSecretValues: Record<string, string>
  setProviderProfiles: Dispatch<SetStateAction<ProviderProfile[]>>
  setActiveProviderId: (value: string) => void
  setPrimaryAssistantModel: Dispatch<SetStateAction<string>>
  setFastAssistantModel: Dispatch<SetStateAction<string>>
}

interface UseSettingsWorkspaceProviderControllerResult {
  activeProvider: ProviderProfile | null
  activeProviderDetail: ProviderProfile
  providerQuery: string
  setProviderQuery: (value: string) => void
  activeProviderApiKeyDraft: string
  apiKeyVisible: boolean
  apiKeyFeedback: string | null
  modelEditorState: ModelEditorState | null
  modelEditorError: string | null
  updateActiveProvider: (patch: Partial<ProviderProfile>) => void
  handleProviderApiKeyDraftChange: (providerId: string, value: string) => void
  handlePersistProviderApiKeyDraft: (providerId: string) => Promise<void>
  handleToggleApiKeyVisibility: () => void
  handleCopyApiKey: () => Promise<void>
  handleAddProvider: () => void
  moveProviderToIndex: (draggingProviderId: string, nextIndex: number) => void
  handleCopyProvider: (providerId: string) => Promise<void>
  handleDeleteProvider: (providerId: string) => Promise<void>
  handleOpenCreateModelEditor: () => void
  handleOpenModelEditor: (index: number) => void
  handleRemoveModel: (index: number) => void
  handleCloseModelEditor: () => void
  handleSaveModel: () => void
  updateModelEditorState: (patch: Partial<ModelEditorState>) => void
  handleToggleModelCapability: (capability: ModelCapability) => void
  clearModelEditorError: () => void
}

export function useSettingsWorkspaceProviderController({
  providerProfiles,
  activeProviderId,
  hydratedProviderSecretValues,
  setProviderProfiles,
  setActiveProviderId,
  setPrimaryAssistantModel,
  setFastAssistantModel,
}: UseSettingsWorkspaceProviderControllerArgs): UseSettingsWorkspaceProviderControllerResult {
  const [providerQuery, setProviderQuery] = useState('')
  const [providerSecretDrafts, setProviderSecretDrafts] = useState<Record<string, string>>({})
  const [providerSecretSavedValues, setProviderSecretSavedValues] = useState<Record<string, string>>({})
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [apiKeyFeedback, setApiKeyFeedback] = useState<string | null>(null)
  const [modelEditorState, setModelEditorState] = useState<ModelEditorState | null>(null)
  const [modelEditorError, setModelEditorError] = useState<string | null>(null)

  const activeProvider = useMemo<ProviderProfile | null>(
    () => providerProfiles.find((profile) => profile.id === activeProviderId) ?? providerProfiles[0] ?? null,
    [activeProviderId, providerProfiles],
  )

  useEffect(() => {
    setProviderSecretDrafts(hydratedProviderSecretValues)
    setProviderSecretSavedValues(hydratedProviderSecretValues)
  }, [hydratedProviderSecretValues])

  useEffect(() => {
    const nextActiveProviderId = resolveSettingsWorkspaceActiveProviderId(providerProfiles, activeProviderId)
    if (nextActiveProviderId !== activeProviderId) {
      setActiveProviderId(nextActiveProviderId)
    }
  }, [activeProviderId, providerProfiles, setActiveProviderId])

  useEffect(() => {
    setModelEditorState(null)
    setApiKeyVisible(false)
    setApiKeyFeedback(null)
  }, [activeProviderId])

  useEffect(() => {
    if (!apiKeyFeedback) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setApiKeyFeedback(null)
    }, 2000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [apiKeyFeedback])

  const activeProviderApiKeyDraft = activeProvider ? (providerSecretDrafts[activeProvider.id] ?? '') : ''
  const activeProviderDetail = activeProvider ?? createPlaceholderProviderProfile()

  const updateActiveProvider = (patch: Partial<ProviderProfile>) => {
    if (!activeProvider) {
      return
    }

    setProviderProfiles((previous) =>
      previous.map((profile) => {
        if (profile.id === activeProviderId) {
          return { ...profile, ...patch }
        }

        return profile
      }),
    )
  }

  const handleCopyApiKey = async () => {
    if (!activeProvider) {
      return
    }

    if (!activeProviderApiKeyDraft.trim()) {
      setApiKeyFeedback('当前没有可复制的 API 密钥')
      return
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard-unavailable')
      }

      await navigator.clipboard.writeText(activeProviderApiKeyDraft)
      setApiKeyFeedback('已复制 API 密钥')
    } catch {
      setApiKeyFeedback('复制失败，请手动复制')
    }
  }

  const handlePersistProviderApiKeyDraft = async (providerId: string) => {
    const activeDraft = providerSecretDrafts[providerId]

    if (activeDraft === undefined) {
      return
    }

    const normalizedDraft = activeDraft.trim()
    const savedValue = providerSecretSavedValues[providerId] ?? ''

    if (normalizedDraft === savedValue) {
      return
    }

    if (!normalizedDraft) {
      const result = await clearSettingsWorkspaceProviderApiKey({ providerId })

      if (!result.ok) {
        setApiKeyFeedback('清除失败，请稍后重试')
        return
      }

      setProviderProfiles((previous) =>
        previous.map((profile) => {
          return profile.id === result.providerId ? { ...profile, hasApiKey: result.state.apiKey !== '' } : profile
        }),
      )
      setProviderSecretDrafts((previous) => ({
        ...previous,
        [result.providerId]: '',
      }))
      setProviderSecretSavedValues((previous) => ({
        ...previous,
        [result.providerId]: result.state.apiKey,
      }))
      setApiKeyFeedback('已清除 API 密钥')
      return
    }

    const result = await saveSettingsWorkspaceProviderApiKey({
      providerId,
      apiKey: normalizedDraft,
    })

    if (!result.ok) {
      setApiKeyFeedback('保存失败，请稍后重试')
      return
    }

    setProviderProfiles((previous) =>
      previous.map((profile) => {
        return profile.id === result.providerId ? { ...profile, hasApiKey: result.state.apiKey !== '' } : profile
      }),
    )
    setProviderSecretDrafts((previous) => ({
      ...previous,
      [result.providerId]: result.state.apiKey,
    }))
    setProviderSecretSavedValues((previous) => ({
      ...previous,
      [result.providerId]: result.state.apiKey,
    }))
    setApiKeyFeedback('已自动保存 API 密钥')
  }

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

  const handleAddProvider = () => {
    const nextProvider = createCustomProvider(providerProfiles.length + 1)

    setProviderProfiles((previous) => [...previous, nextProvider])
    setProviderQuery('')
    setActiveProviderId(nextProvider.id)
    setModelEditorState(null)
  }

  const moveProviderToIndex = (draggingProviderId: string, nextIndex: number) => {
    setProviderProfiles((previous) => {
      const draggingIndex = previous.findIndex((profile) => profile.id === draggingProviderId)

      if (draggingIndex === -1) {
        return previous
      }

      const clampedIndex = Math.max(0, Math.min(nextIndex, previous.length - 1))
      const nextProfiles = [...previous]
      const [draggingProvider] = nextProfiles.splice(draggingIndex, 1)
      nextProfiles.splice(clampedIndex, 0, draggingProvider)
      return nextProfiles
    })
  }

  const handleCopyProvider = async (providerId: string) => {
    const sourceProvider = providerProfiles.find((profile) => profile.id === providerId)

    if (!sourceProvider) {
      return
    }

    const nextProviderId = createProviderId(sourceProvider.name)
    const nextProviderName = `${sourceProvider.name} 副本`
    const copiedSecret = providerSecretSavedValues[providerId] ?? providerSecretDrafts[providerId] ?? ''
    const nextProvider: ProviderProfile = {
      ...sourceProvider,
      id: nextProviderId,
      name: nextProviderName,
      hasApiKey: copiedSecret !== '',
      availableModels: sourceProvider.availableModels.map((model) => ({
        ...model,
        id: createModelProfileId(nextProviderId, model.modelId),
        capabilities: [...model.capabilities],
      })),
    }

    setProviderProfiles((previous) => {
      const sourceIndex = previous.findIndex((profile) => profile.id === providerId)
      const nextProfiles = [...previous]
      nextProfiles.splice(sourceIndex + 1, 0, nextProvider)
      return nextProfiles
    })
    setActiveProviderId(nextProviderId)

    if (!copiedSecret) {
      return
    }

    const result = await saveSettingsWorkspaceProviderApiKey({
      providerId: nextProviderId,
      apiKey: copiedSecret,
    })

    if (!result.ok) {
      setApiKeyFeedback('复制服务商后未能同步 API 密钥')
      return
    }

    setProviderSecretDrafts((previous) => ({
      ...previous,
      [nextProviderId]: result.state.apiKey,
    }))
    setProviderSecretSavedValues((previous) => ({
      ...previous,
      [nextProviderId]: result.state.apiKey,
    }))
  }

  const handleDeleteProvider = async (providerId: string) => {
    const currentIndex = providerProfiles.findIndex((profile) => profile.id === providerId)

    if (currentIndex === -1) {
      return
    }

    const nextActiveProviderId = providerProfiles[currentIndex + 1]?.id
      ?? providerProfiles[currentIndex - 1]?.id
      ?? ''
    const savedSecret = providerSecretSavedValues[providerId] ?? ''

    setProviderProfiles((previous) => previous.filter((profile) => profile.id !== providerId))
    setProviderSecretDrafts((previous) => {
      const { [providerId]: _removedDraft, ...remainingDrafts } = previous
      return remainingDrafts
    })
    setProviderSecretSavedValues((previous) => {
      const { [providerId]: _removedSavedValue, ...remainingSavedValues } = previous
      return remainingSavedValues
    })
    setModelEditorState(null)

    if (providerId === activeProviderId) {
      setActiveProviderId(nextActiveProviderId)
    }

    if (!savedSecret) {
      return
    }

    const result = await clearSettingsWorkspaceProviderApiKey({ providerId })

    if (!result.ok) {
      setApiKeyFeedback('删除服务商后未能清除 API 密钥')
    }
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

  const handleCloseModelEditor = () => {
    setModelEditorError(null)
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

    const nextModel: ProviderModelProfile = {
      id: modelEditorState.isNew ? createModelProfileId(activeProvider.id, nextModelId) : modelEditorState.id,
      modelId: nextModelId,
      displayName: modelEditorState.displayName.trim() || formatModelDisplayName(nextModelId),
      groupName: modelEditorState.groupName.trim() || formatModelGroupName(nextModelId, activeProvider.name),
      capabilities: modelEditorState.capabilities.length > 0 ? modelEditorState.capabilities : ['reasoning'],
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

  return {
    activeProvider,
    activeProviderDetail,
    providerQuery,
    setProviderQuery,
    activeProviderApiKeyDraft,
    apiKeyVisible,
    apiKeyFeedback,
    modelEditorState,
    modelEditorError,
    updateActiveProvider,
    handleProviderApiKeyDraftChange: (providerId, value) => {
      setProviderSecretDrafts((previous) => ({
        ...previous,
        [providerId]: value,
      }))
    },
    handlePersistProviderApiKeyDraft,
    handleToggleApiKeyVisibility: () => setApiKeyVisible((previous) => !previous),
    handleCopyApiKey,
    handleAddProvider,
    moveProviderToIndex,
    handleCopyProvider,
    handleDeleteProvider,
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
