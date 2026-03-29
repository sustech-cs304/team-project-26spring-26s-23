import type { ModelCapability, ProviderProfile } from '../types'
import { ProviderProfileDetails } from './ProviderProfileDetails'
import { ProviderProfileList } from './ProviderProfileList'
import { ProviderProfilesSectionShell } from './ProviderProfilesSectionShell'
import type { ModelEditorState } from './provider-profiles'

export interface ProviderProfilesSectionDomain {
  providerProfiles: ProviderProfile[]
  activeProviderId: string
  activeProvider: ProviderProfile | null
  activeProviderDetail: ProviderProfile
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

interface ProviderProfilesSectionProps {
  provider: ProviderProfilesSectionDomain
}

export function ProviderProfilesSection({ provider }: ProviderProfilesSectionProps) {
  const {
    providerProfiles,
    activeProviderId,
    activeProvider,
    activeProviderDetail,
    providerQuery,
    activeProviderApiKeyDraft,
    apiKeyVisible,
    apiKeyFeedback,
    modelEditorState,
    modelEditorError,
    onProviderQueryChange,
    onActiveProviderChange,
    onAddProvider,
    onReorderProviders,
    onCopyProvider,
    onDeleteProvider,
    onUpdateActiveProvider,
    onProviderApiKeyDraftChange,
    onPersistProviderApiKeyDraft,
    onToggleApiKeyVisibility,
    onCopyApiKey,
    onOpenCreateModelEditor,
    onOpenModelEditor,
    onRemoveModel,
    onCloseModelEditor,
    onModelEditorSave,
    onModelEditorStateChange,
    onToggleModelCapability,
    onClearModelEditorError,
  } = provider

  return (
    <div className="settings-page settings-page--split">
      <ProviderProfileList
        providerProfiles={providerProfiles}
        activeProviderId={activeProviderId}
        providerQuery={providerQuery}
        onProviderQueryChange={onProviderQueryChange}
        onActiveProviderChange={onActiveProviderChange}
        onAddProvider={onAddProvider}
        onCopyProvider={onCopyProvider}
        onDeleteProvider={onDeleteProvider}
        onReorderProviders={onReorderProviders}
      />

      <ProviderProfilesSectionShell hasActiveProvider={activeProvider !== null}>
        {activeProvider ? (
          <ProviderProfileDetails
            activeProviderDetail={activeProviderDetail}
            activeProviderApiKeyDraft={activeProviderApiKeyDraft}
            apiKeyVisible={apiKeyVisible}
            apiKeyFeedback={apiKeyFeedback}
            modelEditorState={modelEditorState}
            modelEditorError={modelEditorError}
            onUpdateActiveProvider={onUpdateActiveProvider}
            onProviderApiKeyDraftChange={onProviderApiKeyDraftChange}
            onPersistProviderApiKeyDraft={onPersistProviderApiKeyDraft}
            onToggleApiKeyVisibility={onToggleApiKeyVisibility}
            onCopyApiKey={onCopyApiKey}
            onOpenCreateModelEditor={onOpenCreateModelEditor}
            onOpenModelEditor={onOpenModelEditor}
            onRemoveModel={onRemoveModel}
            onCloseModelEditor={onCloseModelEditor}
            onModelEditorSave={onModelEditorSave}
            onModelEditorStateChange={onModelEditorStateChange}
            onToggleModelCapability={onToggleModelCapability}
            onClearModelEditorError={onClearModelEditorError}
          />
        ) : null}
      </ProviderProfilesSectionShell>
    </div>
  )
}
