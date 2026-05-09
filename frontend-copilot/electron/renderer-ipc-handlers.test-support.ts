import { vi } from 'vitest'

import type { DesktopNotificationRequest } from './desktop-notification'
import type { ManagedRuntimeLoadResponse } from './managed-runtime/ipc'

import type { ConfigCenterPublicPatchResult } from './config-center/public-patch'
import type { ConfigCenterPublicSnapshotLoadResult } from './config-center/public-snapshot'
import type {
  CopilotHistoryDatabaseBackupResult,
  CopilotHistoryDatabaseRestoreResult,
  CopilotHistoryListThreadsResult,
  CopilotHistoryRunReplayResult,
  CopilotHistoryThreadDeleteResult,
  CopilotHistoryThreadDetailResult,
  CopilotHistoryThreadDuplicateResult,
  CopilotHistoryThreadRenameResult,
} from './copilot-history'
import type { CopilotRuntimeLoadResult } from './copilot-runtime'
import type {
  McpDeleteServerResult,
  McpRefreshCatalogResult,
  McpRegistryLoadResult,
  McpSaveServerResult,
  McpSetServerEnabledResult,
  McpTestConnectionResult,
} from './mcp-registry/ipc'
import type {
  SkillDeleteResult,
  SkillImportResult,
  SkillRefreshResult,
  SkillRegistryLoadResult,
  SkillSelectAndImportResult,
  SkillSetEnabledResult,
} from './skill-registry/ipc'
import type { RendererIpcHandlers } from './renderer-ipc-registration'
import type { ToolCatalogLoadResult } from './tool-catalog/ipc'
import {
  createConfigCenterPublicSnapshotFixture,
  createCopilotRuntimeSnapshotFixture,
  createManagedRuntimeLoadResultFixture,
  createMcpDeleteServerSuccessFixture,
  createMcpRefreshCatalogSuccessFixture,
  createMcpRegistryLoadResultFixture,
  createMcpSaveServerSuccessFixture,
  createMcpSetServerEnabledSuccessFixture,
  createMcpTestConnectionSuccessFixture,
  createSettingsWorkspaceStateFixture,
  createSkillRecordFixture,
} from './renderer-ipc-domain-fixtures.test-support'
import type {
  SettingsWorkspaceProfileSecretMutationResult,
  SettingsWorkspaceSecretsLoadStatusesResult,
  SettingsWorkspaceStateLoadResult,
  SettingsWorkspaceStateSaveResult,
  SettingsWorkspaceSustechCasSecretLoadResult,
  SettingsWorkspaceSustechCasSecretMutationResult,
} from './settings-workspace/ipc'
import type {
  FileOperationResult,
  ListDirectoryResult,
  LoadLastRootDirectoryResult,
  ProbeDirectoryResult,
  SavePastedFileResult,
  SelectDirectoryResult,
} from './file-manager/ipc'

export function createRendererIpcHandlers(): RendererIpcHandlers {
  return {
    loadConfigCenterPublicSnapshot: vi.fn(async (): Promise<ConfigCenterPublicSnapshotLoadResult> => ({
      ok: true,
      snapshot: createConfigCenterPublicSnapshotFixture({
        theme: 'light',
        model: null,
      }),
    })),
    applyConfigCenterPublicPatch: vi.fn(async (): Promise<ConfigCenterPublicPatchResult> => ({
      ok: true,
      snapshot: createConfigCenterPublicSnapshotFixture({
        theme: 'dark',
        model: 'qwen-plus',
      }),
    })),
    loadSettingsWorkspaceState: vi.fn(async (): Promise<SettingsWorkspaceStateLoadResult> => ({
      ok: true,
      source: 'stored',
      state: createSettingsWorkspaceStateFixture(),
    })),
    saveSettingsWorkspaceState: vi.fn(async (): Promise<SettingsWorkspaceStateSaveResult> => ({
      ok: true,
      state: createSettingsWorkspaceStateFixture(),
    })),
    loadSettingsWorkspaceSecretStates: vi.fn(async (): Promise<SettingsWorkspaceSecretsLoadStatusesResult> => ({
      ok: true,
      states: {
        openrouter: {
          hasApiKey: true,
          apiKey: 'persisted-secret',
        },
      },
    })),
    loadSettingsWorkspaceSustechCasSecret: vi.fn(async (): Promise<SettingsWorkspaceSustechCasSecretLoadResult> => ({
      ok: true,
      state: {
        hasPassword: true,
        password: 'persisted-cas-secret',
      },
    })),
    saveSettingsWorkspaceProfileSecret: vi.fn(async (): Promise<SettingsWorkspaceProfileSecretMutationResult> => ({
      ok: true,
      profileId: 'openrouter',
      state: {
        hasApiKey: true,
        apiKey: 'persisted-secret',
      },
    })),
    clearSettingsWorkspaceProfileSecret: vi.fn(async (): Promise<SettingsWorkspaceProfileSecretMutationResult> => ({
      ok: true,
      profileId: 'openrouter',
      state: {
        hasApiKey: false,
        apiKey: '',
      },
    })),
    saveSettingsWorkspaceSustechCasSecret: vi.fn(async (): Promise<SettingsWorkspaceSustechCasSecretMutationResult> => ({
      ok: true,
      state: {
        hasPassword: true,
        password: 'persisted-cas-secret',
      },
    })),
    clearSettingsWorkspaceSustechCasSecret: vi.fn(async (): Promise<SettingsWorkspaceSustechCasSecretMutationResult> => ({
      ok: true,
      state: {
        hasPassword: false,
        password: '',
      },
    })),
    loadManagedRuntime: vi.fn(async (): Promise<ManagedRuntimeLoadResponse> => createManagedRuntimeLoadResultFixture()),
    installOrRepairManagedRuntime: vi.fn(async (): Promise<ManagedRuntimeLoadResponse> => createManagedRuntimeLoadResultFixture()),
    loadMcpRegistry: vi.fn(async (): Promise<McpRegistryLoadResult> => createMcpRegistryLoadResultFixture()),
    saveMcpServer: vi.fn(async (): Promise<McpSaveServerResult> => createMcpSaveServerSuccessFixture()),
    deleteMcpServer: vi.fn(async (): Promise<McpDeleteServerResult> => createMcpDeleteServerSuccessFixture()),
    setMcpServerEnabled: vi.fn(async (): Promise<McpSetServerEnabledResult> => createMcpSetServerEnabledSuccessFixture(false)),
    testMcpConnection: vi.fn(async (): Promise<McpTestConnectionResult> => createMcpTestConnectionSuccessFixture('stdio')),
    refreshMcpCatalog: vi.fn(async (): Promise<McpRefreshCatalogResult> => createMcpRefreshCatalogSuccessFixture()),
    loadSkillRegistry: vi.fn(async (): Promise<SkillRegistryLoadResult> => ({
      ok: true,
      registryRevision: 3,
      snapshotRevision: 5,
      skills: [createSkillRecordFixture()],
    })),
    importSkill: vi.fn(async (): Promise<SkillImportResult> => ({
      ok: true,
      registryRevision: 4,
      snapshotRevision: 6,
      skill: createSkillRecordFixture(),
      validationErrors: [],
    })),
    selectAndImportSkill: vi.fn(async (): Promise<SkillSelectAndImportResult> => ({
      ok: true,
      registryRevision: 4,
      snapshotRevision: 6,
      skill: createSkillRecordFixture(),
      validationErrors: [],
    })),
    deleteSkill: vi.fn(async (): Promise<SkillDeleteResult> => ({
      ok: true,
      registryRevision: 5,
      snapshotRevision: 7,
      skillId: createSkillRecordFixture().skillId,
      deleted: true,
    })),
    setSkillEnabled: vi.fn(async (): Promise<SkillSetEnabledResult> => ({
      ok: true,
      registryRevision: 6,
      snapshotRevision: 8,
      skill: createSkillRecordFixture({ enabled: false }),
    })),
    refreshSkills: vi.fn(async (): Promise<SkillRefreshResult> => ({
      ok: true,
      registryRevision: 7,
      snapshotRevision: 9,
      refreshedSkillIds: [createSkillRecordFixture().skillId],
      results: [{
        skillId: createSkillRecordFixture().skillId,
        status: 'valid',
        errors: [],
        warnings: [],
      }],
    })),
    listCopilotHistoryThreads: vi.fn(async (): Promise<CopilotHistoryListThreadsResult> => ({
      ok: true,
      version: 'chat-history-v1',
      threads: [],
    })),
    getCopilotHistoryThreadDetail: vi.fn(async (): Promise<CopilotHistoryThreadDetailResult> => ({
      ok: true,
      version: 'chat-history-v1',
      thread: {
        threadId: 'thread-1',
        boundAgentId: 'default',
        title: '历史线程',
        titleSource: 'deterministic',
        summary: '已持久化回复',
        summarySource: 'deterministic',
        createdAt: '2026-04-13T14:00:00Z',
        updatedAt: '2026-04-13T14:05:00Z',
        lastActivityAt: '2026-04-13T14:05:00Z',
        lastRunId: 'run-1',
        lastRunStatus: 'completed',
        lastUserMessagePreview: '你好',
        lastAssistantMessagePreview: '已持久化回复',
        driftSummary: {
          status: 'not_evaluated',
        },
      },
      timelineItems: [],
      runSummaries: [],
      latestConfigurationSnapshot: null,
      availabilityDrift: null,
    })),
    getCopilotHistoryRunReplay: vi.fn(async (): Promise<CopilotHistoryRunReplayResult> => ({
      ok: true,
      version: 'chat-history-v1',
      run: {
        runId: 'run-1',
        threadId: 'thread-1',
        status: 'completed',
        createdAt: '2026-04-13T14:00:00Z',
        updatedAt: '2026-04-13T14:05:00Z',
        startedAt: '2026-04-13T14:00:01Z',
        terminalAt: '2026-04-13T14:05:00Z',
        resolvedModelId: 'gpt-4.1',
        requestedMessageText: '你好',
        assistantText: '已持久化回复',
      },
      historicalSnapshot: null,
      orderedEvents: [],
      toolCallBlocks: [],
      diagnosticBlocks: [],
      terminalState: null,
      availabilityInterpretation: null,
    })),
    renameCopilotHistoryThread: vi.fn(async (): Promise<CopilotHistoryThreadRenameResult> => ({
      ok: true,
      version: 'chat-history-v1',
      thread: {
        threadId: 'thread-1',
        boundAgentId: 'default',
        title: '已重命名线程',
        titleSource: 'manual',
        summary: '已持久化回复',
        summarySource: 'deterministic',
        createdAt: '2026-04-13T14:00:00Z',
        updatedAt: '2026-04-13T14:06:00Z',
        lastActivityAt: '2026-04-13T14:05:00Z',
        lastRunId: 'run-1',
        lastRunStatus: 'completed',
        lastUserMessagePreview: '你好',
        lastAssistantMessagePreview: '已持久化回复',
        driftSummary: {
          status: 'not_evaluated',
        },
      },
    })),
    duplicateCopilotHistoryThread: vi.fn(async (): Promise<CopilotHistoryThreadDuplicateResult> => ({
      ok: true,
      version: 'chat-history-v1',
      thread: {
        threadId: 'thread-copy-1',
        boundAgentId: 'default',
        title: '历史线程（副本）',
        titleSource: 'manual',
        summary: '已持久化回复',
        summarySource: 'deterministic',
        createdAt: '2026-04-13T14:06:30Z',
        updatedAt: '2026-04-13T14:06:30Z',
        lastActivityAt: '2026-04-13T14:06:30Z',
        lastRunId: 'run-copy-1',
        lastRunStatus: 'completed',
        lastUserMessagePreview: '你好',
        lastAssistantMessagePreview: '已持久化回复',
        driftSummary: {
          status: 'not_evaluated',
        },
      },
    })),
    deleteCopilotHistoryThread: vi.fn(async (): Promise<CopilotHistoryThreadDeleteResult> => ({
      ok: true,
      version: 'chat-history-v1',
      threadId: 'thread-1',
      deletedAt: '2026-04-13T14:06:00Z',
    })),
    backupCopilotHistoryDatabase: vi.fn(async (): Promise<CopilotHistoryDatabaseBackupResult> => ({
      ok: true,
      version: 'chat-history-v1',
      databasePath: 'D:/workspace/copilot-data/database/copilot-chat.db',
      backupPath: 'D:/workspace/copilot-data/backups/copilot-chat.backup.db',
      createdAt: '2026-04-13T14:08:00Z',
    })),
    restoreCopilotHistoryDatabase: vi.fn(async (): Promise<CopilotHistoryDatabaseRestoreResult> => ({
      ok: true,
      version: 'chat-history-v1',
      databasePath: 'D:/workspace/copilot-data/database/copilot-chat.db',
      sourcePath: 'D:/workspace/copilot-data/backups/copilot-chat.backup.db',
      restoredAt: '2026-04-13T14:09:00Z',
    })),
    loadToolCatalog: vi.fn(async (): Promise<ToolCatalogLoadResult> => ({
      ok: true,
      directoryVersion: 'tools-v1',
      tools: [
        {
          toolId: 'functions.read_file',
          kind: 'builtin',
          availability: 'available',
          displayName: '读取文件',
          description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
        },
      ],
    })),
    loadCopilotRuntime: vi.fn(async (): Promise<CopilotRuntimeLoadResult> => ({
      ok: true,
      snapshot: createCopilotRuntimeSnapshotFixture('ready', 'development'),
    })),
    retryCopilotRuntime: vi.fn(async (): Promise<CopilotRuntimeLoadResult> => ({
      ok: true,
      snapshot: createCopilotRuntimeSnapshotFixture('starting', null),
    })),
    notifyDesktopNotification: vi.fn(async (request: DesktopNotificationRequest) => {
      void request
      return undefined
    }),
    loadDesktopWindowState: vi.fn(async () => ({
      isMaximized: false,
      isFullScreen: false,
    })),
    minimizeDesktopWindow: vi.fn(async () => undefined),
    toggleMaximizeDesktopWindow: vi.fn(async () => ({
      isMaximized: true,
      isFullScreen: false,
    })),
    closeDesktopWindow: vi.fn(async () => undefined),
    notifyBootstrapWindowReady: vi.fn(async () => undefined),
    selectRootDirectory: vi.fn(async (): Promise<SelectDirectoryResult> => ({
      ok: true,
      rootPath: '/test/root',
      entries: [],
    })),
    listDirectory: vi.fn(async (): Promise<ListDirectoryResult> => ({
      ok: true,
      entries: [],
    })),
    probeDirectory: vi.fn(async (): Promise<ProbeDirectoryResult> => ({
      ok: true,
      totalItems: 0,
      isLarge: false,
      maxDepth: 0,
    })),
    createDirectory: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: [],
    })),
    copyEntries: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: [],
    })),
    moveEntries: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: [],
    })),
    renameEntry: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: [],
    })),
    trashEntries: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: [],
    })),
    deleteEntriesPermanently: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: [],
    })),
    watchDirectories: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: [],
    })),
    unwatchDirectories: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: [],
    })),
    loadLastRootDirectory: vi.fn(async (): Promise<LoadLastRootDirectoryResult> => ({
      ok: true,
      rootPath: '/test/last-root',
    })),
    saveLastRootDirectory: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: ['/test/saved-root'],
    })),
    clearLastRootDirectory: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: [],
    })),
    openEntryWithSystem: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: ['/test/opened-file.txt'],
    })),
    revealEntryInFolder: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: ['/test/revealed-entry'],
    })),
    copyTextToClipboard: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: [],
    })),
    savePastedFile: vi.fn(async (): Promise<SavePastedFileResult> => ({
      ok: true,
      filePath: 'D:/workspace/copilot-data/copilot-pasted-files/pasted-file.txt',
    })),
  }
}
