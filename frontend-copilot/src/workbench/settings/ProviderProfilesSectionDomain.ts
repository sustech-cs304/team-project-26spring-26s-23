import type { ModelCapability, ProviderProfile } from '../types'
import type { ModelEditorState } from './provider-profiles'

export interface ProviderProfilesSectionDomain {
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
  onToggleModelCapability: (capability: ModelCapability) => void
  onClearModelEditorError: () => void
}

export interface ProviderProfileListDomain {
  providerProfiles: ProviderProfile[]
  activeProviderId: string
  providerQuery: string
  onProviderQueryChange: (value: string) => void
  onActiveProviderChange: (providerId: string) => void
  onAddProvider: () => void
  onCopyProvider: (providerId: string) => void | Promise<void>
  onDeleteProvider: (providerId: string) => void | Promise<void>
  onReorderProviders: (providerId: string, nextIndex: number) => void
}

export interface ProviderProfileDetailsDomain {
  activeProviderDetail: ProviderProfile
  activeProviderPreviewModelId: string | null
  activeProviderApiKeyDraft: string
  apiKeyVisible: boolean
  apiKeyFeedback: string | null
  onUpdateActiveProvider: (patch: Partial<ProviderProfile>) => void
  onProviderApiKeyDraftChange: (providerId: string, value: string) => void
  onPersistProviderApiKeyDraft: (providerId: string) => void | Promise<void>
  onToggleApiKeyVisibility: () => void
  onCopyApiKey: () => void | Promise<void>
  onOpenCreateModelEditor: () => void
  onOpenModelEditor: (index: number) => void
  onRemoveModel: (index: number) => void
}

export interface ProviderModelEditorMountDomain {
  modelEditorState: ModelEditorState | null
  modelEditorError: string | null
  onCloseModelEditor: () => void
  onModelEditorSave: () => void
  onModelEditorStateChange: (patch: Partial<ModelEditorState>) => void
  onToggleModelCapability: (capability: ModelCapability) => void
  onClearModelEditorError: () => void
}

export interface ProviderProfileDetailsShellDomain {
  hasActiveProvider: boolean
  detail: ProviderProfileDetailsDomain | null
  modelEditor: ProviderModelEditorMountDomain
}

export function resolveProviderProfileListDomain(provider: ProviderProfilesSectionDomain): ProviderProfileListDomain {
  return {
    providerProfiles: provider.providerProfiles,
    activeProviderId: provider.activeProviderId,
    providerQuery: provider.providerQuery,
    onProviderQueryChange: provider.onProviderQueryChange,
    onActiveProviderChange: provider.onActiveProviderChange,
    onAddProvider: provider.onAddProvider,
    onCopyProvider: provider.onCopyProvider,
    onDeleteProvider: provider.onDeleteProvider,
    onReorderProviders: provider.onReorderProviders,
  }
}

export function resolveProviderProfileDetailsShellDomain(
  provider: ProviderProfilesSectionDomain,
): ProviderProfileDetailsShellDomain {
  return {
    hasActiveProvider: provider.activeProvider !== null,
    detail:
      provider.activeProvider === null
        ? null
        : {
            activeProviderDetail: provider.activeProviderDetail,
            activeProviderPreviewModelId: provider.activeProviderPreviewModelId,
            activeProviderApiKeyDraft: provider.activeProviderApiKeyDraft,
            apiKeyVisible: provider.apiKeyVisible,
            apiKeyFeedback: provider.apiKeyFeedback,
            onUpdateActiveProvider: provider.onUpdateActiveProvider,
            onProviderApiKeyDraftChange: provider.onProviderApiKeyDraftChange,
            onPersistProviderApiKeyDraft: provider.onPersistProviderApiKeyDraft,
            onToggleApiKeyVisibility: provider.onToggleApiKeyVisibility,
            onCopyApiKey: provider.onCopyApiKey,
            onOpenCreateModelEditor: provider.onOpenCreateModelEditor,
            onOpenModelEditor: provider.onOpenModelEditor,
            onRemoveModel: provider.onRemoveModel,
          },
    modelEditor: {
      modelEditorState: provider.modelEditorState,
      modelEditorError: provider.modelEditorError,
      onCloseModelEditor: provider.onCloseModelEditor,
      onModelEditorSave: provider.onModelEditorSave,
      onModelEditorStateChange: provider.onModelEditorStateChange,
      onToggleModelCapability: provider.onToggleModelCapability,
      onClearModelEditorError: provider.onClearModelEditorError,
    },
  }
}
