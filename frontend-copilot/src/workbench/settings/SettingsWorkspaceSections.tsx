import type { CopilotBootstrapController } from '../../features/copilot/types'
import type {
  ModelCapability,
  ProviderProfile,
  SelectOption,
  SettingsSection,
  ThemeMode,
} from '../types'
import { DefaultModelRoutesSection } from './DefaultModelRoutesSection'
import { ExternalSourcesSection, type WakeupDialogState } from './ExternalSourcesSection'
import {
  ApiSettingsSection,
  DataSettingsSection,
  DisplaySettingsSection,
  DocsSettingsSection,
  GeneralSettingsSection,
  McpSettingsSection,
  MemorySettingsSection,
  SearchSettingsSection,
} from './MiscSettingsSections'
import { ProviderProfilesSection } from './ProviderProfilesSection'
import { SustechInfoSection } from './SustechInfoSection'
import type { ModelEditorState } from './provider-profiles'

interface SettingsWorkspaceSectionsProps {
  activeSection: SettingsSection
  bootstrap: CopilotBootstrapController
  themeMode: ThemeMode
  onThemeModeChange: (value: ThemeMode) => void
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
  allModelOptions: SelectOption[]
  primaryAssistantModel: string
  fastAssistantModel: string
  onPrimaryAssistantModelChange: (value: string) => void
  onFastAssistantModelChange: (value: string) => void
  studentId: string
  displayedSustechEmail: string
  casPasswordDraft: string
  casPasswordFeedback: string | null
  blackboardAutoDownloadEnabled: boolean
  blackboardDownloadLimitMb: string
  onStudentIdChange: (value: string) => void
  onSustechEmailChange: (value: string) => void
  onSustechEmailFocusChange: (focused: boolean) => void
  onCasPasswordDraftChange: (value: string) => void
  onPersistCasPasswordDraft: () => void | Promise<void>
  onBlackboardAutoDownloadEnabledChange: (value: boolean) => void
  onBlackboardDownloadLimitMbChange: (value: string) => void
  language: string
  proxyMode: string
  assistantNotificationsEnabled: boolean
  backupEnabled: boolean
  onLanguageChange: (value: string) => void
  onProxyModeChange: (value: string) => void
  onAssistantNotificationsEnabledChange: (value: boolean) => void
  onBackupEnabledChange: (value: boolean) => void
  dataPath: string
  backupCycle: string
  launchSyncEnabled: boolean
  onDataPathChange: (value: string) => void
  onBackupCycleChange: (value: string) => void
  onLaunchSyncEnabledChange: (value: boolean) => void
  toolPermissionMode: string
  mcpAutoDiscoveryEnabled: boolean
  onToolPermissionModeChange: (value: string) => void
  onMcpAutoDiscoveryEnabledChange: (value: boolean) => void
  searchEngine: string
  searchResultCount: string
  compressionMode: string
  onSearchEngineChange: (value: string) => void
  onSearchResultCountChange: (value: string) => void
  onCompressionModeChange: (value: string) => void
  memoryStrategy: string
  memoryCleanupEnabled: boolean
  onMemoryStrategyChange: (value: string) => void
  onMemoryCleanupEnabledChange: (value: boolean) => void
  apiBaseUrl: string
  apiReconnectMode: string
  healthPollingEnabled: boolean
  onApiBaseUrlChange: (value: string) => void
  onApiReconnectModeChange: (value: string) => void
  onHealthPollingEnabledChange: (value: boolean) => void
  docsFormat: string
  outputDirectory: string
  autoFileNameEnabled: boolean
  onDocsFormatChange: (value: string) => void
  onOutputDirectoryChange: (value: string) => void
  onAutoFileNameEnabledChange: (value: boolean) => void
  wakeupShareLink: string
  wakeupDialogState: WakeupDialogState
  onWakeupShareLinkChange: (value: string) => void
  onWakeupLinkParse: () => void | Promise<void>
  onWakeupDialogClose: () => void
  onWakeupConflictChoice: () => void
}

export function SettingsWorkspaceSections({
  activeSection,
  bootstrap,
  themeMode,
  onThemeModeChange,
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
  allModelOptions,
  primaryAssistantModel,
  fastAssistantModel,
  onPrimaryAssistantModelChange,
  onFastAssistantModelChange,
  studentId,
  displayedSustechEmail,
  casPasswordDraft,
  casPasswordFeedback,
  blackboardAutoDownloadEnabled,
  blackboardDownloadLimitMb,
  onStudentIdChange,
  onSustechEmailChange,
  onSustechEmailFocusChange,
  onCasPasswordDraftChange,
  onPersistCasPasswordDraft,
  onBlackboardAutoDownloadEnabledChange,
  onBlackboardDownloadLimitMbChange,
  language,
  proxyMode,
  assistantNotificationsEnabled,
  backupEnabled,
  onLanguageChange,
  onProxyModeChange,
  onAssistantNotificationsEnabledChange,
  onBackupEnabledChange,
  dataPath,
  backupCycle,
  launchSyncEnabled,
  onDataPathChange,
  onBackupCycleChange,
  onLaunchSyncEnabledChange,
  toolPermissionMode,
  mcpAutoDiscoveryEnabled,
  onToolPermissionModeChange,
  onMcpAutoDiscoveryEnabledChange,
  searchEngine,
  searchResultCount,
  compressionMode,
  onSearchEngineChange,
  onSearchResultCountChange,
  onCompressionModeChange,
  memoryStrategy,
  memoryCleanupEnabled,
  onMemoryStrategyChange,
  onMemoryCleanupEnabledChange,
  apiBaseUrl,
  apiReconnectMode,
  healthPollingEnabled,
  onApiBaseUrlChange,
  onApiReconnectModeChange,
  onHealthPollingEnabledChange,
  docsFormat,
  outputDirectory,
  autoFileNameEnabled,
  onDocsFormatChange,
  onOutputDirectoryChange,
  onAutoFileNameEnabledChange,
  wakeupShareLink,
  wakeupDialogState,
  onWakeupShareLinkChange,
  onWakeupLinkParse,
  onWakeupDialogClose,
  onWakeupConflictChoice,
}: SettingsWorkspaceSectionsProps) {
  switch (activeSection) {
    case 'sustech-info':
      return (
        <SustechInfoSection
          studentId={studentId}
          displayedSustechEmail={displayedSustechEmail}
          casPasswordDraft={casPasswordDraft}
          casPasswordFeedback={casPasswordFeedback}
          blackboardAutoDownloadEnabled={blackboardAutoDownloadEnabled}
          blackboardDownloadLimitMb={blackboardDownloadLimitMb}
          onStudentIdChange={onStudentIdChange}
          onSustechEmailChange={onSustechEmailChange}
          onSustechEmailFocusChange={onSustechEmailFocusChange}
          onCasPasswordDraftChange={onCasPasswordDraftChange}
          onPersistCasPasswordDraft={onPersistCasPasswordDraft}
          onBlackboardAutoDownloadEnabledChange={onBlackboardAutoDownloadEnabledChange}
          onBlackboardDownloadLimitMbChange={onBlackboardDownloadLimitMbChange}
        />
      )

    case 'model-service':
      return (
        <ProviderProfilesSection
          providerProfiles={providerProfiles}
          activeProviderId={activeProviderId}
          activeProvider={activeProvider}
          activeProviderDetail={activeProviderDetail}
          providerQuery={providerQuery}
          activeProviderApiKeyDraft={activeProviderApiKeyDraft}
          apiKeyVisible={apiKeyVisible}
          apiKeyFeedback={apiKeyFeedback}
          modelEditorState={modelEditorState}
          modelEditorError={modelEditorError}
          onProviderQueryChange={onProviderQueryChange}
          onActiveProviderChange={onActiveProviderChange}
          onAddProvider={onAddProvider}
          onReorderProviders={onReorderProviders}
          onCopyProvider={onCopyProvider}
          onDeleteProvider={onDeleteProvider}
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
      )

    case 'default-model':
      return (
        <DefaultModelRoutesSection
          primaryAssistantModel={primaryAssistantModel}
          fastAssistantModel={fastAssistantModel}
          allModelOptions={allModelOptions}
          onPrimaryAssistantModelChange={onPrimaryAssistantModelChange}
          onFastAssistantModelChange={onFastAssistantModelChange}
        />
      )

    case 'general':
      return (
        <GeneralSettingsSection
          language={language}
          proxyMode={proxyMode}
          assistantNotificationsEnabled={assistantNotificationsEnabled}
          backupEnabled={backupEnabled}
          onLanguageChange={onLanguageChange}
          onProxyModeChange={onProxyModeChange}
          onAssistantNotificationsEnabledChange={onAssistantNotificationsEnabledChange}
          onBackupEnabledChange={onBackupEnabledChange}
        />
      )

    case 'display':
      return <DisplaySettingsSection themeMode={themeMode} onThemeModeChange={onThemeModeChange} />

    case 'data':
      return (
        <DataSettingsSection
          dataPath={dataPath}
          backupCycle={backupCycle}
          backupEnabled={backupEnabled}
          launchSyncEnabled={launchSyncEnabled}
          onDataPathChange={onDataPathChange}
          onBackupCycleChange={onBackupCycleChange}
          onBackupEnabledChange={onBackupEnabledChange}
          onLaunchSyncEnabledChange={onLaunchSyncEnabledChange}
        />
      )

    case 'mcp':
      return (
        <McpSettingsSection
          toolPermissionMode={toolPermissionMode}
          mcpAutoDiscoveryEnabled={mcpAutoDiscoveryEnabled}
          onToolPermissionModeChange={onToolPermissionModeChange}
          onMcpAutoDiscoveryEnabledChange={onMcpAutoDiscoveryEnabledChange}
        />
      )

    case 'search':
      return (
        <SearchSettingsSection
          searchEngine={searchEngine}
          searchResultCount={searchResultCount}
          compressionMode={compressionMode}
          onSearchEngineChange={onSearchEngineChange}
          onSearchResultCountChange={onSearchResultCountChange}
          onCompressionModeChange={onCompressionModeChange}
        />
      )

    case 'memory':
      return (
        <MemorySettingsSection
          memoryStrategy={memoryStrategy}
          memoryCleanupEnabled={memoryCleanupEnabled}
          onMemoryStrategyChange={onMemoryStrategyChange}
          onMemoryCleanupEnabledChange={onMemoryCleanupEnabledChange}
        />
      )

    case 'api':
      return (
        <ApiSettingsSection
          bootstrap={bootstrap}
          apiBaseUrl={apiBaseUrl}
          apiReconnectMode={apiReconnectMode}
          healthPollingEnabled={healthPollingEnabled}
          onApiBaseUrlChange={onApiBaseUrlChange}
          onApiReconnectModeChange={onApiReconnectModeChange}
          onHealthPollingEnabledChange={onHealthPollingEnabledChange}
        />
      )

    case 'docs':
      return (
        <DocsSettingsSection
          docsFormat={docsFormat}
          outputDirectory={outputDirectory}
          autoFileNameEnabled={autoFileNameEnabled}
          onDocsFormatChange={onDocsFormatChange}
          onOutputDirectoryChange={onOutputDirectoryChange}
          onAutoFileNameEnabledChange={onAutoFileNameEnabledChange}
        />
      )

    case 'external-source':
      return (
        <ExternalSourcesSection
          wakeupShareLink={wakeupShareLink}
          wakeupDialogState={wakeupDialogState}
          onWakeupShareLinkChange={onWakeupShareLinkChange}
          onWakeupLinkParse={onWakeupLinkParse}
          onWakeupDialogClose={onWakeupDialogClose}
          onWakeupConflictChoice={onWakeupConflictChoice}
        />
      )

    default:
      return null
  }
}
