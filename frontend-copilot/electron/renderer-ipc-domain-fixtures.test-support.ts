import type { ConfigCenterPublicSnapshot } from './config-center/public-snapshot'
import type { CopilotRuntimeSnapshot } from './copilot-runtime'
import type { SettingsWorkspaceEditableState } from './settings-workspace/state-schema'

export interface ConfigCenterPublicSnapshotFixtureOptions {
  theme?: 'light' | 'dark'
  debugModeEnabled?: boolean
  model?: string | null
}

export function createConfigCenterPublicSnapshotFixture(
  options: ConfigCenterPublicSnapshotFixtureOptions = {},
): ConfigCenterPublicSnapshot {
  const { theme = 'dark', debugModeEnabled = false, model = 'qwen-plus' } = options

  return {
    version: 1,
    domains: {
      frontendPreferences: {
        theme,
        animationsEnabled: true,
      },
      assistantBehavior: {
        agentName: 'planner',
        debugModeEnabled,
      },
      hostConfig: {
        runtimeUrl: 'http://127.0.0.1:4400',
      },
      backendExposed: {
        model,
      },
    },
  }
}

export function createSettingsWorkspaceStateFixture(): SettingsWorkspaceEditableState {
  return {
    sustech: {
      studentId: '',
      email: '',
      blackboardAutoDownloadEnabled: false,
      blackboardDownloadLimitMb: '0',
    },
    providerProfiles: [],
    defaultModelRouting: {
      primaryAssistantModel: '',
      fastAssistantModel: '',
    },
    general: {
      language: 'zh-CN',
      proxyMode: 'system',
      assistantNotificationsEnabled: false,
      backupEnabled: true,
      debugModeEnabled: false,
    },
    data: {
      dataPath: 'D:/workspace/copilot-data',
      backupCycle: 'daily',
      launchSyncEnabled: true,
    },
    mcp: {
      mcpAutoDiscoveryEnabled: true,
      toolPermissionMode: 'manual',
    },
    search: {
      searchEngine: 'google',
      searchResultCount: '8',
      compressionMode: 'summary',
    },
    memory: {
      memoryStrategy: 'session-longterm',
      memoryCleanupEnabled: true,
    },
    api: {
      apiReconnectMode: 'exponential',
      healthPollingEnabled: true,
      apiBaseUrl: 'http://127.0.0.1:8000',
    },
    docs: {
      docsFormat: 'markdown',
      outputDirectory: 'D:/workspace/exports',
      autoFileNameEnabled: true,
    },
    externalSource: {
      wakeupShareLink: '',
    },
  }
}

export function createCopilotRuntimeSnapshotFixture(
  status: CopilotRuntimeSnapshot['hosted']['status'],
  resolvedMode: CopilotRuntimeSnapshot['hosted']['resolvedMode'],
): CopilotRuntimeSnapshot {
  return {
    hosted: {
      status,
      expectedMode: 'development',
      resolvedMode,
      runtimeUrl: resolvedMode === null ? null : 'http://127.0.0.1:4400',
      isPackaged: false,
      failure: null,
    },
  }
}
