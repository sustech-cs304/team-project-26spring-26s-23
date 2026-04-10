import type { Dispatch, SetStateAction } from 'react'

import type { ModelCapability, ProviderProfile } from '../types'
import type { ModelEditorState } from './provider-profiles'
import {
  findSettingsWorkspaceActiveProvider,
  resolveSettingsWorkspaceActiveProviderDetail,
} from './settings-workspace-provider-helpers'
import { useSettingsWorkspaceProviderListController } from './settings-workspace-provider-list'
import { useSettingsWorkspaceProviderModelEditor } from './settings-workspace-provider-model-editor'
import { useSettingsWorkspaceProviderSecrets } from './settings-workspace-provider-secrets'

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
  const activeProvider = findSettingsWorkspaceActiveProvider(providerProfiles, activeProviderId)
  const activeProviderDetail = resolveSettingsWorkspaceActiveProviderDetail(activeProvider)

  const {
    activeProviderApiKeyDraft,
    apiKeyVisible,
    apiKeyFeedback,
    handleProviderApiKeyDraftChange,
    handlePersistProviderApiKeyDraft,
    handleToggleApiKeyVisibility,
    handleCopyApiKey,
    getProviderSecretValue,
    syncCopiedProviderApiKey,
    removeProviderSecret,
  } = useSettingsWorkspaceProviderSecrets({
    activeProviderId,
    activeProvider,
    hydratedProviderSecretValues,
    setProviderProfiles,
  })

  const {
    providerQuery,
    setProviderQuery,
    updateActiveProvider,
    handleAddProvider,
    moveProviderToIndex,
    handleCopyProvider,
    handleDeleteProvider,
  } = useSettingsWorkspaceProviderListController({
    providerProfiles,
    activeProviderId,
    setProviderProfiles,
    setActiveProviderId,
    getProviderSecretValue,
    syncCopiedProviderApiKey,
    removeProviderSecret,
  })

  const {
    modelEditorState,
    modelEditorError,
    handleOpenCreateModelEditor,
    handleOpenModelEditor,
    handleRemoveModel,
    handleCloseModelEditor,
    handleSaveModel,
    updateModelEditorState,
    handleToggleModelCapability,
    clearModelEditorError,
  } = useSettingsWorkspaceProviderModelEditor({
    activeProviderId,
    activeProvider,
    setProviderProfiles,
    setPrimaryAssistantModel,
    setFastAssistantModel,
  })

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
    handleProviderApiKeyDraftChange,
    handlePersistProviderApiKeyDraft,
    handleToggleApiKeyVisibility,
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
    clearModelEditorError,
  }
}
