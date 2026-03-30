import type { SettingsWorkspaceStateSaveInput } from '../../../electron/settings-workspace/schema'

import { cloneProviderModelProfile } from './settings-workspace-controller-helpers'
import type { SettingsWorkspaceFormState } from './settings-workspace-form-state'

export function createSettingsWorkspaceStateSaveInput(
  state: SettingsWorkspaceFormState,
): SettingsWorkspaceStateSaveInput {
  return {
    sustech: {
      studentId: state.studentId,
      email: state.sustechEmail,
      blackboardAutoDownloadEnabled: state.blackboardAutoDownloadEnabled,
      blackboardDownloadLimitMb: state.blackboardDownloadLimitMb,
    },
    providerProfiles: state.providerProfiles.map(({ hasApiKey: _hasApiKey, ...profile }) => ({
      ...profile,
      availableModels: profile.availableModels.map(cloneProviderModelProfile),
    })),
    defaultModelRouting: {
      primaryAssistantModel: state.primaryAssistantModel,
      fastAssistantModel: state.fastAssistantModel,
    },
    general: {
      language: state.language,
      proxyMode: state.proxyMode,
      assistantNotificationsEnabled: state.assistantNotificationsEnabled,
      backupEnabled: state.backupEnabled,
    },
    data: {
      dataPath: state.dataPath,
      backupCycle: state.backupCycle,
      launchSyncEnabled: state.launchSyncEnabled,
    },
    mcp: {
      mcpAutoDiscoveryEnabled: state.mcpAutoDiscoveryEnabled,
      toolPermissionMode: state.toolPermissionMode,
    },
    search: {
      searchEngine: state.searchEngine,
      searchResultCount: state.searchResultCount,
      compressionMode: state.compressionMode,
    },
    memory: {
      memoryStrategy: state.memoryStrategy,
      memoryCleanupEnabled: state.memoryCleanupEnabled,
    },
    api: {
      apiReconnectMode: state.apiReconnectMode,
      healthPollingEnabled: state.healthPollingEnabled,
      apiBaseUrl: state.apiBaseUrl,
    },
    docs: {
      docsFormat: state.docsFormat,
      outputDirectory: state.outputDirectory,
      autoFileNameEnabled: state.autoFileNameEnabled,
    },
    externalSource: {
      wakeupShareLink: state.wakeupShareLink,
    },
  }
}
