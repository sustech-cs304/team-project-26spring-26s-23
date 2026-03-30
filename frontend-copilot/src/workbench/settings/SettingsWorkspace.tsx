import { useMemo, useState } from 'react'

import type { CopilotBootstrapController } from '../../features/copilot/types'
import { settingsItems } from '../config'
import type { SettingsSection, ThemeMode } from '../types'
import { SettingsWorkspaceSections } from './SettingsWorkspaceSections'
import type { DefaultModelRoutesSectionDomain } from './DefaultModelRoutesSection'
import type { ExternalSourcesSectionDomain } from './ExternalSourcesSection'
import type { ProviderProfilesSectionDomain } from './ProviderProfilesSectionDomain'
import type { SustechInfoSectionDomain } from './SustechInfoSection'
import { initialSettingsWorkspaceActiveProviderId } from './settings-workspace-form-state'
import { collectAllModelOptions } from './settings-workspace-model-options'
import { useSettingsWorkspaceProviderController } from './settings-workspace-provider-controller'
import { useSettingsWorkspaceSideflows } from './settings-workspace-sideflows'
import { useSettingsWorkspaceState } from './useSettingsWorkspaceState'

interface SettingsWorkspaceProps {
  bootstrap: CopilotBootstrapController
  themeMode: ThemeMode
  onThemeModeChange: (value: ThemeMode) => void
  initialSection?: SettingsSection
}

export function SettingsWorkspace({
  bootstrap,
  themeMode,
  onThemeModeChange,
  initialSection,
}: SettingsWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? settingsItems[0]?.id ?? 'sustech-info')
  const [sustechEmailFocused, setSustechEmailFocused] = useState(false)

  const workspaceState = useSettingsWorkspaceState(initialSettingsWorkspaceActiveProviderId)
  const {
    formState,
    activeProviderId,
    providerSecretValues,
    casPasswordValue,
    setActiveProviderId,
    setStudentId,
    setSustechEmail,
    setBlackboardAutoDownloadEnabled,
    setBlackboardDownloadLimitMb,
    setProviderProfiles,
    setPrimaryAssistantModel,
    setFastAssistantModel,
    setLanguage,
    setProxyMode,
    setAssistantNotificationsEnabled,
    setBackupEnabled,
    setDataPath,
    setBackupCycle,
    setLaunchSyncEnabled,
    setMcpAutoDiscoveryEnabled,
    setToolPermissionMode,
    setSearchEngine,
    setSearchResultCount,
    setCompressionMode,
    setMemoryStrategy,
    setMemoryCleanupEnabled,
    setApiReconnectMode,
    setHealthPollingEnabled,
    setApiBaseUrl,
    setDocsFormat,
    setOutputDirectory,
    setAutoFileNameEnabled,
    setWakeupShareLink,
  } = workspaceState

  const providerController = useSettingsWorkspaceProviderController({
    providerProfiles: formState.providerProfiles,
    activeProviderId,
    hydratedProviderSecretValues: providerSecretValues,
    setProviderProfiles,
    setActiveProviderId,
    setPrimaryAssistantModel,
    setFastAssistantModel,
  })
  const {
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
  } = providerController

  const sideflows = useSettingsWorkspaceSideflows({
    hydratedCasPasswordValue: casPasswordValue,
    wakeupShareLink: formState.wakeupShareLink,
  })
  const {
    casPasswordDraft,
    casPasswordFeedback,
    setCasPasswordDraft,
    persistCasPasswordDraft,
    wakeupDialogState,
    handleWakeupLinkParse,
    handleWakeupDialogClose,
    handleWakeupConflictChoice,
  } = sideflows

  const activeSettingsItem = useMemo(
    () => settingsItems.find((item) => item.id === activeSection) ?? settingsItems[0],
    [activeSection],
  )

  const allModelOptions = useMemo(
    () => collectAllModelOptions(formState.providerProfiles),
    [formState.providerProfiles],
  )

  const derivedSustechEmail = useMemo(() => {
    const normalizedStudentId = formState.studentId.trim()

    if (!normalizedStudentId) {
      return ''
    }

    return `${normalizedStudentId}@sustech.edu.cn`
  }, [formState.studentId])

  const displayedSustechEmail = formState.sustechEmail.trim() || (!sustechEmailFocused ? derivedSustechEmail : '')

  const providerSectionDomain: ProviderProfilesSectionDomain = {
    providerProfiles: formState.providerProfiles,
    activeProviderId,
    activeProvider,
    activeProviderDetail,
    providerQuery,
    activeProviderApiKeyDraft,
    apiKeyVisible,
    apiKeyFeedback,
    modelEditorState,
    modelEditorError,
    onProviderQueryChange: setProviderQuery,
    onActiveProviderChange: setActiveProviderId,
    onAddProvider: handleAddProvider,
    onReorderProviders: moveProviderToIndex,
    onCopyProvider: handleCopyProvider,
    onDeleteProvider: handleDeleteProvider,
    onUpdateActiveProvider: updateActiveProvider,
    onProviderApiKeyDraftChange: handleProviderApiKeyDraftChange,
    onPersistProviderApiKeyDraft: handlePersistProviderApiKeyDraft,
    onToggleApiKeyVisibility: handleToggleApiKeyVisibility,
    onCopyApiKey: handleCopyApiKey,
    onOpenCreateModelEditor: handleOpenCreateModelEditor,
    onOpenModelEditor: handleOpenModelEditor,
    onRemoveModel: handleRemoveModel,
    onCloseModelEditor: handleCloseModelEditor,
    onModelEditorSave: handleSaveModel,
    onModelEditorStateChange: updateModelEditorState,
    onToggleModelCapability: handleToggleModelCapability,
    onClearModelEditorError: clearModelEditorError,
  }

  const defaultModelsSectionDomain: DefaultModelRoutesSectionDomain = {
    primaryAssistantModel: formState.primaryAssistantModel,
    fastAssistantModel: formState.fastAssistantModel,
    allModelOptions,
    onPrimaryAssistantModelChange: setPrimaryAssistantModel,
    onFastAssistantModelChange: setFastAssistantModel,
  }

  const sustechSectionDomain: SustechInfoSectionDomain = {
    studentId: formState.studentId,
    displayedSustechEmail,
    casPasswordDraft,
    casPasswordFeedback,
    blackboardAutoDownloadEnabled: formState.blackboardAutoDownloadEnabled,
    blackboardDownloadLimitMb: formState.blackboardDownloadLimitMb,
    onStudentIdChange: setStudentId,
    onSustechEmailChange: setSustechEmail,
    onSustechEmailFocusChange: setSustechEmailFocused,
    onCasPasswordDraftChange: setCasPasswordDraft,
    onPersistCasPasswordDraft: persistCasPasswordDraft,
    onBlackboardAutoDownloadEnabledChange: setBlackboardAutoDownloadEnabled,
    onBlackboardDownloadLimitMbChange: setBlackboardDownloadLimitMb,
  }

  const externalSourcesSectionDomain: ExternalSourcesSectionDomain = {
    wakeupShareLink: formState.wakeupShareLink,
    wakeupDialogState,
    onWakeupShareLinkChange: setWakeupShareLink,
    onWakeupLinkParse: handleWakeupLinkParse,
    onWakeupDialogClose: handleWakeupDialogClose,
    onWakeupConflictChoice: handleWakeupConflictChoice,
  }

  const miscSectionDomains = {
    general: {
      language: formState.language,
      proxyMode: formState.proxyMode,
      assistantNotificationsEnabled: formState.assistantNotificationsEnabled,
      backupEnabled: formState.backupEnabled,
      onLanguageChange: setLanguage,
      onProxyModeChange: setProxyMode,
      onAssistantNotificationsEnabledChange: setAssistantNotificationsEnabled,
      onBackupEnabledChange: setBackupEnabled,
    },
    display: {
      themeMode,
      onThemeModeChange,
    },
    data: {
      dataPath: formState.dataPath,
      backupCycle: formState.backupCycle,
      backupEnabled: formState.backupEnabled,
      launchSyncEnabled: formState.launchSyncEnabled,
      onDataPathChange: setDataPath,
      onBackupCycleChange: setBackupCycle,
      onBackupEnabledChange: setBackupEnabled,
      onLaunchSyncEnabledChange: setLaunchSyncEnabled,
    },
    mcp: {
      toolPermissionMode: formState.toolPermissionMode,
      mcpAutoDiscoveryEnabled: formState.mcpAutoDiscoveryEnabled,
      onToolPermissionModeChange: setToolPermissionMode,
      onMcpAutoDiscoveryEnabledChange: setMcpAutoDiscoveryEnabled,
    },
    search: {
      searchEngine: formState.searchEngine,
      searchResultCount: formState.searchResultCount,
      compressionMode: formState.compressionMode,
      onSearchEngineChange: setSearchEngine,
      onSearchResultCountChange: setSearchResultCount,
      onCompressionModeChange: setCompressionMode,
    },
    memory: {
      memoryStrategy: formState.memoryStrategy,
      memoryCleanupEnabled: formState.memoryCleanupEnabled,
      onMemoryStrategyChange: setMemoryStrategy,
      onMemoryCleanupEnabledChange: setMemoryCleanupEnabled,
    },
    api: {
      bootstrap,
      apiBaseUrl: formState.apiBaseUrl,
      apiReconnectMode: formState.apiReconnectMode,
      healthPollingEnabled: formState.healthPollingEnabled,
      onApiBaseUrlChange: setApiBaseUrl,
      onApiReconnectModeChange: setApiReconnectMode,
      onHealthPollingEnabledChange: setHealthPollingEnabled,
    },
    docs: {
      docsFormat: formState.docsFormat,
      outputDirectory: formState.outputDirectory,
      autoFileNameEnabled: formState.autoFileNameEnabled,
      onDocsFormatChange: setDocsFormat,
      onOutputDirectoryChange: setOutputDirectory,
      onAutoFileNameEnabledChange: setAutoFileNameEnabled,
    },
  }

  return (
    <section className="workspace-stage settings-workspace" aria-label="设置工作区">
      <aside className="workspace-panel settings-panel" aria-label="设置导航列">
        <header className="panel-head">
          <p className="panel-head__eyebrow">设置</p>
          <h1 className="panel-head__title">全局设置目录</h1>
        </header>

        <ul className="settings-nav-list">
          {settingsItems.map((item) => {
            const Icon = item.icon
            const active = item.id === activeSection

            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`settings-nav-item${active ? ' settings-nav-item--active' : ''}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <Icon size={16} className="settings-nav-item__icon" />
                  <span className="settings-nav-item__body">
                    <span className="settings-nav-item__title">{item.label}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <main className="workspace-main" aria-label="设置主内容区">
        <header className="workspace-main__header">
          <h2 className="workspace-main__title">{activeSettingsItem.label}</h2>
        </header>

        <section className="workspace-main__content workspace-main__content--flush workspace-main__content--settings">
          <SettingsWorkspaceSections
            activeSection={activeSection}
            provider={providerSectionDomain}
            defaultModels={defaultModelsSectionDomain}
            sustech={sustechSectionDomain}
            externalSources={externalSourcesSectionDomain}
            misc={miscSectionDomains}
          />
        </section>
      </main>
    </section>
  )
}
