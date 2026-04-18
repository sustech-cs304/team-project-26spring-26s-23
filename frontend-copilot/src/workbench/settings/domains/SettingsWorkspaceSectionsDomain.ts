import { useMemo, useState } from 'react'

import type { CopilotBootstrapController } from '../../../features/copilot/types'
import type { ThemeMode } from '../../types'
import type { DefaultModelRoutesSectionDomain } from '../DefaultModelRoutesSection'
import type { ExternalSourcesSectionDomain } from '../ExternalSourcesSection'
import { initialSettingsWorkspaceActiveProviderId } from '../settings-workspace-form-state'
import {
  buildDefaultModelRouteSelectionValue,
  collectAllModelOptions,
} from '../settings-workspace-model-options'
import { useSettingsWorkspaceSideflows } from '../settings-workspace-sideflows'
import { useSettingsWorkspaceState } from '../state/useSettingsWorkspaceState'
import { useConfigCenterDebugModeState } from './config-center/useConfigCenterDebugModeState'
import type { ProviderProfilesSectionDomain } from './provider-profiles/ProviderProfilesSectionDomain'
import { createProviderProfilesSectionDomain } from './provider-profiles/ProviderProfilesViewModel'
import { createDefaultModelRoutesSectionDomain } from './sections/DefaultModelRoutesSectionDomain'
import { createExternalSourcesSectionDomain } from './sections/ExternalSourcesSectionDomain'
import {
  createGeneralSettingsSectionDomains,
  type GeneralSettingsSectionDomains,
} from './sections/GeneralSettingsSectionDomain'
import { createMcpSettingsSectionDomains, type McpSettingsSectionDomains } from './sections/McpSettingsSectionDomain'
import {
  createMemorySettingsSectionDomains,
  type MemorySettingsSectionDomains,
} from './sections/MemorySettingsSectionDomain'
import {
  createMiscSettingsSectionDomains,
  type MiscSettingsSectionDomains,
} from './sections/MiscSettingsSectionDomain'
import {
  createSearchSettingsSectionDomains,
  type SearchSettingsSectionDomains,
} from './sections/SearchSettingsSectionDomain'
import { createSustechInfoSectionDomain } from './sections/SustechInfoSectionDomain'
import { useSettingsWorkspaceProviderController } from './provider-profiles/useProviderProfilesController'

export type SettingsWorkspaceMiscSectionDomains =
  & GeneralSettingsSectionDomains
  & MiscSettingsSectionDomains
  & McpSettingsSectionDomains
  & SearchSettingsSectionDomains
  & MemorySettingsSectionDomains

export interface SettingsWorkspaceSectionsDomain {
  provider: ProviderProfilesSectionDomain
  defaultModels: DefaultModelRoutesSectionDomain
  sustech: ReturnType<typeof createSustechInfoSectionDomain>
  externalSources: ExternalSourcesSectionDomain
  misc: SettingsWorkspaceMiscSectionDomains
}

interface UseSettingsWorkspaceSectionsDomainArgs {
  bootstrap: CopilotBootstrapController
  themeMode: ThemeMode
  onThemeModeChange: (value: ThemeMode) => void
  onLanguageChange?: (value: string) => void
}

export function useSettingsWorkspaceSectionsDomain({
  bootstrap,
  themeMode,
  onThemeModeChange,
  onLanguageChange,
}: UseSettingsWorkspaceSectionsDomainArgs): SettingsWorkspaceSectionsDomain {
  const [sustechEmailFocused, setSustechEmailFocused] = useState(false)
  const { debugModeEnabled, handleDebugModeEnabledChange } = useConfigCenterDebugModeState()

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
    language: formState.language,
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

  const primaryAssistantModelSelectionValue = useMemo(
    () => buildDefaultModelRouteSelectionValue({
      selectedModelId: formState.primaryAssistantModel,
      persistedRoute: formState.primaryAssistantModelRoute ?? null,
      providerProfiles: formState.providerProfiles,
    }),
    [formState.primaryAssistantModel, formState.primaryAssistantModelRoute, formState.providerProfiles],
  )

  const fastAssistantModelSelectionValue = useMemo(
    () => buildDefaultModelRouteSelectionValue({
      selectedModelId: formState.fastAssistantModel,
      persistedRoute: formState.fastAssistantModelRoute ?? null,
      providerProfiles: formState.providerProfiles,
    }),
    [formState.fastAssistantModel, formState.fastAssistantModelRoute, formState.providerProfiles],
  )

  const allModelOptions = useMemo(
    () => collectAllModelOptions(
      formState.providerProfiles,
      [primaryAssistantModelSelectionValue, fastAssistantModelSelectionValue],
    ),
    [formState.providerProfiles, primaryAssistantModelSelectionValue, fastAssistantModelSelectionValue],
  )

  const activeProviderPreviewModelId = useMemo(() => {
    if (activeProvider === null) {
      return null
    }

    const primaryRoute = formState.primaryAssistantModelRoute
    if (primaryRoute !== null && primaryRoute.profileId === activeProvider.id) {
      return primaryRoute.modelId
    }

    const normalizedPrimaryModelId = formState.primaryAssistantModel.trim()
    if (
      normalizedPrimaryModelId !== ''
      && activeProvider.availableModels.some((model) => model.modelId === normalizedPrimaryModelId)
    ) {
      return normalizedPrimaryModelId
    }

    return null
  }, [activeProvider, formState.primaryAssistantModel, formState.primaryAssistantModelRoute])

  return {
    provider: createProviderProfilesSectionDomain({
      providerProfiles: formState.providerProfiles,
      activeProviderId,
      activeProvider,
      activeProviderDetail,
      activeProviderPreviewModelId,
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
    }),
    defaultModels: createDefaultModelRoutesSectionDomain({
      primaryAssistantModel: primaryAssistantModelSelectionValue,
      fastAssistantModel: fastAssistantModelSelectionValue,
      allModelOptions,
      onPrimaryAssistantModelChange: setPrimaryAssistantModel,
      onFastAssistantModelChange: setFastAssistantModel,
    }),
    sustech: createSustechInfoSectionDomain({
      studentId: formState.studentId,
      sustechEmail: formState.sustechEmail,
      sustechEmailFocused,
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
    }),
    externalSources: createExternalSourcesSectionDomain({
      wakeupShareLink: formState.wakeupShareLink,
      wakeupDialogState,
      onWakeupShareLinkChange: setWakeupShareLink,
      onWakeupLinkParse: handleWakeupLinkParse,
      onWakeupDialogClose: handleWakeupDialogClose,
      onWakeupConflictChoice: handleWakeupConflictChoice,
    }),
    misc: {
      ...createGeneralSettingsSectionDomains({
        language: formState.language,
        proxyMode: formState.proxyMode,
        assistantNotificationsEnabled: formState.assistantNotificationsEnabled,
        backupEnabled: formState.backupEnabled,
        debugModeEnabled,
        onLanguageChange: (value) => {
          setLanguage(value)
          onLanguageChange?.(value)
        },
        onProxyModeChange: setProxyMode,
        onAssistantNotificationsEnabledChange: setAssistantNotificationsEnabled,
        onBackupEnabledChange: setBackupEnabled,
        onDebugModeEnabledChange: handleDebugModeEnabledChange,
      }),
      ...createMiscSettingsSectionDomains({
        display: {
          language: formState.language,
          themeMode,
          onThemeModeChange,
        },
        data: {
          language: formState.language,
          dataPath: formState.dataPath,
          backupCycle: formState.backupCycle,
          backupEnabled: formState.backupEnabled,
          launchSyncEnabled: formState.launchSyncEnabled,
          onDataPathChange: setDataPath,
          onBackupCycleChange: setBackupCycle,
          onBackupEnabledChange: setBackupEnabled,
          onLaunchSyncEnabledChange: setLaunchSyncEnabled,
        },
        api: {
          language: formState.language,
          bootstrap,
          apiBaseUrl: formState.apiBaseUrl,
          apiReconnectMode: formState.apiReconnectMode,
          healthPollingEnabled: formState.healthPollingEnabled,
          onApiBaseUrlChange: setApiBaseUrl,
          onApiReconnectModeChange: setApiReconnectMode,
          onHealthPollingEnabledChange: setHealthPollingEnabled,
        },
        docs: {
          language: formState.language,
          docsFormat: formState.docsFormat,
          outputDirectory: formState.outputDirectory,
          autoFileNameEnabled: formState.autoFileNameEnabled,
          onDocsFormatChange: setDocsFormat,
          onOutputDirectoryChange: setOutputDirectory,
          onAutoFileNameEnabledChange: setAutoFileNameEnabled,
        },
      }),
      ...createMcpSettingsSectionDomains({
        language: formState.language,
        toolPermissionMode: formState.toolPermissionMode,
        mcpAutoDiscoveryEnabled: formState.mcpAutoDiscoveryEnabled,
        onToolPermissionModeChange: setToolPermissionMode,
        onMcpAutoDiscoveryEnabledChange: setMcpAutoDiscoveryEnabled,
      }),
      ...createSearchSettingsSectionDomains({
        language: formState.language,
        searchEngine: formState.searchEngine,
        searchResultCount: formState.searchResultCount,
        compressionMode: formState.compressionMode,
        onSearchEngineChange: setSearchEngine,
        onSearchResultCountChange: setSearchResultCount,
        onCompressionModeChange: setCompressionMode,
      }),
      ...createMemorySettingsSectionDomains({
        language: formState.language,
        memoryStrategy: formState.memoryStrategy,
        memoryCleanupEnabled: formState.memoryCleanupEnabled,
        onMemoryStrategyChange: setMemoryStrategy,
        onMemoryCleanupEnabledChange: setMemoryCleanupEnabled,
      }),
    },
  }
}
