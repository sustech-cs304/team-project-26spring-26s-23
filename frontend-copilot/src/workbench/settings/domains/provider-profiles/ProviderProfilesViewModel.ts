import type { ProviderProfile } from '../../../types'

import type { ModelEditorState } from './provider-profiles'
import type { ProviderProfilesSectionDomain } from './ProviderProfilesSectionDomain'

interface ProviderProfilesViewModelInput {
  providerProfiles: ProviderProfile[]
  activeProviderId: string
  activeProvider: ProviderProfile | null
  activeProviderDetail: ProviderProfile
  activeProviderPreviewModelId: string | null
  providerQuery: string
  activeProviderApiKeyDraft: string
  apiKeyVisible: boolean
  apiKeyFeedback: string | null
  modelEditorState: ModelEditorState | null
  modelEditorError: string | null
  onProviderQueryChange: (value: string) => void
  onActiveProviderChange: (providerId: string) => void
  onAddProvider: () => void
  onReorderProviders: (providerId: string, nextIndex: number) => void
  onCopyProvider: (providerId: string) => void | Promise<void>
  onDeleteProvider: (providerId: string) => void | Promise<void>
  onUpdateActiveProvider: (patch: Partial<ProviderProfile>) => void
  onProviderApiKeyDraftChange: (providerId: string, value: string) => void
  onPersistProviderApiKeyDraft: (providerId: string) => void | Promise<void>
  onToggleApiKeyVisibility: () => void
  onCopyApiKey: () => void | Promise<void>
  onOpenCreateModelEditor: () => void
  onOpenModelEditor: (index: number) => void
  onRemoveModel: (index: number) => void
  onCloseModelEditor: () => void
  onModelEditorSave: () => void
  onModelEditorStateChange: (patch: Partial<ModelEditorState>) => void
  onToggleModelCapability: (capability: ProviderProfilesSectionDomain['onToggleModelCapability'] extends (capability: infer T) => void ? T : never) => void
  onClearModelEditorError: () => void
}

export function createProviderProfilesSectionDomain(input: ProviderProfilesViewModelInput): ProviderProfilesSectionDomain {
  return {
    providerProfiles: input.providerProfiles,
    activeProviderId: input.activeProviderId,
    activeProvider: input.activeProvider,
    activeProviderDetail: input.activeProviderDetail,
    activeProviderPreviewModelId: input.activeProviderPreviewModelId,
    providerQuery: input.providerQuery,
    activeProviderApiKeyDraft: input.activeProviderApiKeyDraft,
    apiKeyVisible: input.apiKeyVisible,
    apiKeyFeedback: input.apiKeyFeedback,
    modelEditorState: input.modelEditorState,
    modelEditorError: input.modelEditorError,
    onProviderQueryChange: input.onProviderQueryChange,
    onActiveProviderChange: input.onActiveProviderChange,
    onAddProvider: input.onAddProvider,
    onReorderProviders: input.onReorderProviders,
    onCopyProvider: input.onCopyProvider,
    onDeleteProvider: input.onDeleteProvider,
    onUpdateActiveProvider: input.onUpdateActiveProvider,
    onProviderApiKeyDraftChange: input.onProviderApiKeyDraftChange,
    onPersistProviderApiKeyDraft: input.onPersistProviderApiKeyDraft,
    onToggleApiKeyVisibility: input.onToggleApiKeyVisibility,
    onCopyApiKey: input.onCopyApiKey,
    onOpenCreateModelEditor: input.onOpenCreateModelEditor,
    onOpenModelEditor: input.onOpenModelEditor,
    onRemoveModel: input.onRemoveModel,
    onCloseModelEditor: input.onCloseModelEditor,
    onModelEditorSave: input.onModelEditorSave,
    onModelEditorStateChange: input.onModelEditorStateChange,
    onToggleModelCapability: input.onToggleModelCapability,
    onClearModelEditorError: input.onClearModelEditorError,
  }
}
