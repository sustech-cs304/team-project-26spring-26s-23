import type { ConfigCenterPublicSnapshot } from './config-center/public-snapshot'
import type { CopilotRuntimeSnapshot } from './copilot-runtime'
import type { ManagedRuntimeLoadResult } from './managed-runtime/ipc'
import type { SettingsWorkspaceEditableState } from './settings-workspace/state-schema'
export {
  createMcpCapabilitySnapshotFixture,
  createMcpDeleteServerSuccessFixture,
  createMcpDirectoryDriftToolCallFailureFixture,
  createMcpHttpSseStubServerFixture,
  createMcpRefreshCatalogSuccessFixture,
  createMcpRegistryLoadResultFixture,
  createMcpRegistrySubscriptionEventFixture,
  createMcpSaveServerSuccessFixture,
  createMcpSetServerEnabledSuccessFixture,
  createMcpStdioStubServerFixture,
  createMcpTestConnectionSuccessFixture,
  createMcpToolCallRequestFixture,
  createMcpToolCallSuccessFixture,
} from './mcp-registry/test-support'
export {
  createSkillCapabilitySnapshotFixture,
  createSkillRecordFixture,
  createSkillResourceSummaryFixture,
  createSkillValidationSummaryFixture,
} from './skill-registry/test-support'

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
      general: {
        language: 'zh-CN',
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
      primaryAssistantModelRoute: null,
      fastAssistantModelRoute: null,
    },
    general: {
      language: 'zh-CN',
      proxyMode: 'system',
      assistantNotificationsEnabled: false,
      backupEnabled: true,
    },
    data: {
      dataPath: 'D:/workspace/copilot-data',
      backupCycle: 'daily',
      launchSyncEnabled: true,
    },
    mcp: {
      mcpAutoDiscoveryEnabled: true,
      toolPermissionMode: 'manual',
      toolPermissionPolicy: {
        version: 1,
        defaultMode: 'ask',
        toolPermissions: {},
      },
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

export function createManagedRuntimeLoadResultFixture(): ManagedRuntimeLoadResult {
  return {
    ok: true,
    snapshot: {
      manifestVersion: 1,
      overallStatus: 'missing',
      target: {
        platform: 'win32',
        arch: 'x64',
      },
      rootDir: 'D:/workspace/user-data/desktop-runtime/managed-runtime',
      hostedRuntimeRootDir: 'D:/workspace/user-data/desktop-runtime',
      families: {
        node: {
          family: 'node',
          status: 'missing',
          pinnedVersion: '24.15.0',
          activeVersion: null,
          updateRecommended: false,
          installRootDir: 'D:/workspace/user-data/desktop-runtime/managed-runtime/node/versions',
          stagingDir: 'D:/workspace/user-data/desktop-runtime/managed-runtime/node/staging',
          activeDir: 'D:/workspace/user-data/desktop-runtime/managed-runtime/node/active',
          selectedComponents: [],
          launcherPaths: {},
          lastInstalledAt: null,
          lastRepairedAt: null,
          lastVerification: null,
          lastErrorSummary: null,
        },
        uv: {
          family: 'uv',
          status: 'missing',
          pinnedVersion: 'python 3.12.10 + uv 0.11.7',
          activeVersion: null,
          updateRecommended: false,
          installRootDir: 'D:/workspace/user-data/desktop-runtime/managed-runtime/uv/versions',
          stagingDir: 'D:/workspace/user-data/desktop-runtime/managed-runtime/uv/staging',
          activeDir: 'D:/workspace/user-data/desktop-runtime/managed-runtime/uv/active',
          selectedComponents: [],
          launcherPaths: {},
          lastInstalledAt: null,
          lastRepairedAt: null,
          lastVerification: null,
          lastErrorSummary: null,
        },
      },
    },
  }
}
