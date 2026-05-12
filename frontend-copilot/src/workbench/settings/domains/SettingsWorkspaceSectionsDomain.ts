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
import {
  createApiSettingsSectionDomains,
  type ApiSettingsSectionDomains,
} from './sections/ApiSettingsSectionDomain'
import { createDefaultModelRoutesSectionDomain } from './sections/DefaultModelRoutesSectionDomain'
import { createExternalSourcesSectionDomain } from './sections/ExternalSourcesSectionDomain'
import {
  createGeneralSettingsSectionDomains,
  type GeneralSettingsSectionDomains,
} from './sections/GeneralSettingsSectionDomain'
import {
  createMiscSettingsSectionDomains,
  type MiscSettingsSectionDomains,
} from './sections/MiscSettingsSectionDomain'
import {
  createMcpSettingsSectionDomains,
  type McpSettingsSectionDomains,
} from './sections/McpSettingsSectionDomain'
import {
  createSearchSettingsSectionDomains,
  type SearchSettingsSectionDomains,
} from './sections/SearchSettingsSectionDomain'
import { createSustechInfoSectionDomain } from './sections/SustechInfoSectionDomain'
import { useSettingsWorkspaceProviderController } from './provider-profiles/useProviderProfilesController'

export type SettingsWorkspaceMiscSectionDomains =
  & GeneralSettingsSectionDomains
  & MiscSettingsSectionDomains
  & ApiSettingsSectionDomains
  & SearchSettingsSectionDomains
  & McpSettingsSectionDomains

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

interface SectionCreationDeps {
  formState: ReturnType<typeof useSettingsWorkspaceState>['formState']
  activeProviderId: ReturnType<typeof useSettingsWorkspaceState>['activeProviderId']
  activeProvider: ReturnType<typeof useSettingsWorkspaceProviderController>['activeProvider']
  activeProviderDetail: ReturnType<typeof useSettingsWorkspaceProviderController>['activeProviderDetail']
  activeProviderPreviewModelId: string | null
  providerQuery: string
  activeProviderApiKeyDraft: string
  apiKeyVisible: boolean
  apiKeyFeedback: string | null
  modelEditorState: ReturnType<typeof useSettingsWorkspaceProviderController>['modelEditorState']
  modelEditorError: string | null
  setActiveProviderId: ReturnType<typeof useSettingsWorkspaceState>['setActiveProviderId']
  setProviderQuery: ReturnType<typeof useSettingsWorkspaceProviderController>['setProviderQuery']
  handleAddProvider: ReturnType<typeof useSettingsWorkspaceProviderController>['handleAddProvider']
  moveProviderToIndex: ReturnType<typeof useSettingsWorkspaceProviderController>['moveProviderToIndex']
  handleCopyProvider: ReturnType<typeof useSettingsWorkspaceProviderController>['handleCopyProvider']
  handleDeleteProvider: ReturnType<typeof useSettingsWorkspaceProviderController>['handleDeleteProvider']
  updateActiveProvider: ReturnType<typeof useSettingsWorkspaceProviderController>['updateActiveProvider']
  handleProviderApiKeyDraftChange: ReturnType<typeof useSettingsWorkspaceProviderController>['handleProviderApiKeyDraftChange']
  handlePersistProviderApiKeyDraft: ReturnType<typeof useSettingsWorkspaceProviderController>['handlePersistProviderApiKeyDraft']
  handleToggleApiKeyVisibility: ReturnType<typeof useSettingsWorkspaceProviderController>['handleToggleApiKeyVisibility']
  handleCopyApiKey: ReturnType<typeof useSettingsWorkspaceProviderController>['handleCopyApiKey']
  handleOpenCreateModelEditor: ReturnType<typeof useSettingsWorkspaceProviderController>['handleOpenCreateModelEditor']
  handleOpenModelEditor: ReturnType<typeof useSettingsWorkspaceProviderController>['handleOpenModelEditor']
  handleRemoveModel: ReturnType<typeof useSettingsWorkspaceProviderController>['handleRemoveModel']
  handleCloseModelEditor: ReturnType<typeof useSettingsWorkspaceProviderController>['handleCloseModelEditor']
  handleSaveModel: ReturnType<typeof useSettingsWorkspaceProviderController>['handleSaveModel']
  updateModelEditorState: ReturnType<typeof useSettingsWorkspaceProviderController>['updateModelEditorState']
  handleToggleModelCapability: ReturnType<typeof useSettingsWorkspaceProviderController>['handleToggleModelCapability']
  clearModelEditorError: ReturnType<typeof useSettingsWorkspaceProviderController>['clearModelEditorError']
}

interface MiscSectionDeps {
  formState: ReturnType<typeof useSettingsWorkspaceState>['formState']
  bootstrap: CopilotBootstrapController
  themeMode: ThemeMode
  onThemeModeChange: (value: ThemeMode) => void
  onLanguageChange?: (value: string) => void
  setLanguage: ReturnType<typeof useSettingsWorkspaceState>['setLanguage']
  setAssistantNotificationsEnabled: ReturnType<typeof useSettingsWorkspaceState>['setAssistantNotificationsEnabled']
  setApiBaseUrl: ReturnType<typeof useSettingsWorkspaceState>['setApiBaseUrl']
  setApiReconnectMode: ReturnType<typeof useSettingsWorkspaceState>['setApiReconnectMode']
  setHealthPollingEnabled: ReturnType<typeof useSettingsWorkspaceState>['setHealthPollingEnabled']
  setSearchEngine: ReturnType<typeof useSettingsWorkspaceState>['setSearchEngine']
  setSearchResultCount: ReturnType<typeof useSettingsWorkspaceState>['setSearchResultCount']
  setCompressionMode: ReturnType<typeof useSettingsWorkspaceState>['setCompressionMode']
  setToolPermissionMode: ReturnType<typeof useSettingsWorkspaceState>['setToolPermissionMode']
  setMcpAutoDiscoveryEnabled: ReturnType<typeof useSettingsWorkspaceState>['setMcpAutoDiscoveryEnabled']
  setDocsFormat: ReturnType<typeof useSettingsWorkspaceState>['setDocsFormat']
  debugModeEnabled: boolean
  handleDebugModeEnabledChange: (value: boolean) => void
}

function createProviderSection(deps: SectionCreationDeps): ProviderProfilesSectionDomain {
  return createProviderProfilesSectionDomain({
    providerProfiles: deps.formState.providerProfiles,
    activeProviderId: deps.activeProviderId,
    activeProvider: deps.activeProvider,
    activeProviderDetail: deps.activeProviderDetail,
    activeProviderPreviewModelId: deps.activeProviderPreviewModelId,
    providerQuery: deps.providerQuery,
    activeProviderApiKeyDraft: deps.activeProviderApiKeyDraft,
    apiKeyVisible: deps.apiKeyVisible,
    apiKeyFeedback: deps.apiKeyFeedback,
    modelEditorState: deps.modelEditorState,
    modelEditorError: deps.modelEditorError,
    onProviderQueryChange: deps.setProviderQuery,
    onActiveProviderChange: deps.setActiveProviderId,
    onAddProvider: deps.handleAddProvider,
    onReorderProviders: deps.moveProviderToIndex,
    onCopyProvider: deps.handleCopyProvider,
    onDeleteProvider: deps.handleDeleteProvider,
    onUpdateActiveProvider: deps.updateActiveProvider,
    onProviderApiKeyDraftChange: deps.handleProviderApiKeyDraftChange,
    onPersistProviderApiKeyDraft: deps.handlePersistProviderApiKeyDraft,
    onToggleApiKeyVisibility: deps.handleToggleApiKeyVisibility,
    onCopyApiKey: deps.handleCopyApiKey,
    onOpenCreateModelEditor: deps.handleOpenCreateModelEditor,
    onOpenModelEditor: deps.handleOpenModelEditor,
    onRemoveModel: deps.handleRemoveModel,
    onCloseModelEditor: deps.handleCloseModelEditor,
    onModelEditorSave: deps.handleSaveModel,
    onModelEditorStateChange: deps.updateModelEditorState,
    onToggleModelCapability: deps.handleToggleModelCapability,
    onClearModelEditorError: deps.clearModelEditorError,
  })
}

function createMiscSection(deps: MiscSectionDeps): SettingsWorkspaceMiscSectionDomains {
  return {
    ...createGeneralSettingsSectionDomains({
      language: deps.formState.language,
      assistantNotificationsEnabled: deps.formState.assistantNotificationsEnabled,
      debugModeEnabled: deps.debugModeEnabled,
      onLanguageChange: (value) => {
        deps.setLanguage(value)
        deps.onLanguageChange?.(value)
      },
      onAssistantNotificationsEnabledChange: deps.setAssistantNotificationsEnabled,
      onDebugModeEnabledChange: deps.handleDebugModeEnabledChange,
    }),
    ...createMiscSettingsSectionDomains({
      display: {
        language: deps.formState.language,
        themeMode: deps.themeMode,
        onThemeModeChange: deps.onThemeModeChange,
      },
      docs: {
        language: deps.formState.language,
        docsFormat: deps.formState.docsFormat,
        onDocsFormatChange: deps.setDocsFormat,
      },
    }),
    ...createApiSettingsSectionDomains({
      language: deps.formState.language,
      bootstrap: deps.bootstrap,
      apiBaseUrl: deps.formState.apiBaseUrl,
      apiReconnectMode: deps.formState.apiReconnectMode,
      healthPollingEnabled: deps.formState.healthPollingEnabled,
      onApiBaseUrlChange: deps.setApiBaseUrl,
      onApiReconnectModeChange: deps.setApiReconnectMode,
      onHealthPollingEnabledChange: deps.setHealthPollingEnabled,
    }),
    ...createSearchSettingsSectionDomains({
      language: deps.formState.language,
      searchEngine: deps.formState.searchEngine,
      searchResultCount: deps.formState.searchResultCount,
      compressionMode: deps.formState.compressionMode,
      onSearchEngineChange: deps.setSearchEngine,
      onSearchResultCountChange: deps.setSearchResultCount,
      onCompressionModeChange: deps.setCompressionMode,
    }),
    ...createMcpSettingsSectionDomains({
      language: deps.formState.language,
      toolPermissionMode: deps.formState.toolPermissionMode,
      mcpAutoDiscoveryEnabled: deps.formState.mcpAutoDiscoveryEnabled,
      onToolPermissionModeChange: deps.setToolPermissionMode,
      onMcpAutoDiscoveryEnabledChange: deps.setMcpAutoDiscoveryEnabled,
    }),
  }
}

/* eslint-disable-next-line max-lines-per-function */
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
    setBlackboardCurrentTermOnly,
    setBlackboardParallelSyncWorkers,
    setProviderProfiles,
    setPrimaryAssistantModel,
    setFastAssistantModel,
    setLanguage,
    setAssistantNotificationsEnabled,
    setApiReconnectMode,
    setHealthPollingEnabled,
    setApiBaseUrl,
    setSearchEngine,
    setSearchResultCount,
    setCompressionMode,
    setToolPermissionMode,
    setMcpAutoDiscoveryEnabled,
    setDocsFormat,
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

  const activeProviderPreviewModelId = activeProviderDetail.availableModels[0]?.modelId ?? null

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

  const sectionDeps: SectionCreationDeps = {
    formState,
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
    setActiveProviderId,
    setProviderQuery,
    handleAddProvider,
    moveProviderToIndex,
    handleCopyProvider,
    handleDeleteProvider,
    updateActiveProvider,
    handleProviderApiKeyDraftChange,
    handlePersistProviderApiKeyDraft,
    handleToggleApiKeyVisibility,
    handleCopyApiKey,
    handleOpenCreateModelEditor,
    handleOpenModelEditor,
    handleRemoveModel,
    handleCloseModelEditor,
    handleSaveModel,
    updateModelEditorState,
    handleToggleModelCapability,
    clearModelEditorError,
  }

  const miscDeps: MiscSectionDeps = {
    formState,
    bootstrap,
    themeMode,
    onThemeModeChange,
    onLanguageChange,
    setLanguage,
    setAssistantNotificationsEnabled,
    setApiBaseUrl,
    setApiReconnectMode,
    setHealthPollingEnabled,
    setSearchEngine,
    setSearchResultCount,
    setCompressionMode,
    setToolPermissionMode,
    setMcpAutoDiscoveryEnabled,
    setDocsFormat,
    debugModeEnabled,
    handleDebugModeEnabledChange,
  }

  return {
    provider: createProviderSection(sectionDeps),
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
      blackboardCurrentTermOnly: formState.blackboardCurrentTermOnly,
      blackboardParallelSyncWorkers: formState.blackboardParallelSyncWorkers,
      onStudentIdChange: setStudentId,
      onSustechEmailChange: setSustechEmail,
      onSustechEmailFocusChange: setSustechEmailFocused,
      onCasPasswordDraftChange: setCasPasswordDraft,
      onPersistCasPasswordDraft: persistCasPasswordDraft,
      onBlackboardCurrentTermOnlyChange: setBlackboardCurrentTermOnly,
      onBlackboardParallelSyncWorkersChange: setBlackboardParallelSyncWorkers,
    }),
    externalSources: createExternalSourcesSectionDomain({
      wakeupShareLink: formState.wakeupShareLink,
      wakeupDialogState,
      onWakeupShareLinkChange: setWakeupShareLink,
      onWakeupLinkParse: handleWakeupLinkParse,
      onWakeupDialogClose: handleWakeupDialogClose,
      onWakeupConflictChoice: handleWakeupConflictChoice,
    }),
    misc: createMiscSection(miscDeps),
  }
}
