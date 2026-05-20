import { vi } from 'vitest'

import type { DesktopNotificationRequest } from './desktop-notification'
import type { ManagedRuntimeLoadResponse } from './managed-runtime/ipc'
import type {
  CleanupTemporaryAttachmentFilesResult,
  ReadAttachmentPreviewResult,
  ReadClipboardAttachmentDataResult,
  WriteAttachmentTempFileResult,
} from './attachment-service/ipc'

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
  SelectDirectoryResult,
} from './file-manager/ipc'

const H = 'chat-history-v1'
const T1405 = '2026-04-13T14:05:00Z'

const THREAD_1 = {
  threadId: 'thread-1' as const,
  boundAgentId: 'default' as const,
  summary: '已持久化回复' as const,
  summarySource: 'deterministic' as const,
  lastUserMessagePreview: '你好' as const,
  lastAssistantMessagePreview: '已持久化回复' as const,
  driftSummary: { status: 'not_evaluated' as const },
}

export function createRendererIpcHandlers(): RendererIpcHandlers {
  return {
    ...createConfigCenterFixtures(),
    ...createSettingsWorkspaceFixtures(),
    ...createManagedRuntimeFixtures(),
    ...createMcpRegistryFixtures(),
    ...createSkillRegistryFixtures(),
    ...createCopilotHistoryFixtures(),
    ...createToolCatalogFixtures(),
    ...createCopilotRuntimeFixtures(),
    ...createAttachmentManagerFixtures(),
    ...createDesktopWindowFixtures(),
    ...createFileManagerFixtures(),
  }
}

function createConfigCenterFixtures(): Pick<RendererIpcHandlers,
  'loadConfigCenterPublicSnapshot' | 'applyConfigCenterPublicPatch'> {
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
  }
}

function createSettingsWorkspaceFixtures(): Pick<RendererIpcHandlers,
  'loadSettingsWorkspaceState' | 'saveSettingsWorkspaceState'
  | 'loadSettingsWorkspaceSecretStates' | 'loadSettingsWorkspaceSustechCasSecret'
  | 'saveSettingsWorkspaceProfileSecret' | 'clearSettingsWorkspaceProfileSecret'
  | 'saveSettingsWorkspaceSustechCasSecret' | 'clearSettingsWorkspaceSustechCasSecret'> {
  return {
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
      state: { hasApiKey: true, apiKey: 'persisted-secret' },
    })),
    clearSettingsWorkspaceProfileSecret: vi.fn(async (): Promise<SettingsWorkspaceProfileSecretMutationResult> => ({
      ok: true,
      profileId: 'openrouter',
      state: { hasApiKey: false, apiKey: '' },
    })),
    saveSettingsWorkspaceSustechCasSecret: vi.fn(async (): Promise<SettingsWorkspaceSustechCasSecretMutationResult> => ({
      ok: true,
      state: { hasPassword: true, password: 'persisted-cas-secret' },
    })),
    clearSettingsWorkspaceSustechCasSecret: vi.fn(async (): Promise<SettingsWorkspaceSustechCasSecretMutationResult> => ({
      ok: true,
      state: { hasPassword: false, password: '' },
    })),
  }
}

function createManagedRuntimeFixtures(): Pick<RendererIpcHandlers,
  'loadManagedRuntime' | 'installOrRepairManagedRuntime'> {
  return {
    loadManagedRuntime: vi.fn(async (): Promise<ManagedRuntimeLoadResponse> => createManagedRuntimeLoadResultFixture()),
    installOrRepairManagedRuntime: vi.fn(async (): Promise<ManagedRuntimeLoadResponse> => createManagedRuntimeLoadResultFixture()),
  }
}

function createMcpRegistryFixtures(): Pick<RendererIpcHandlers,
  'loadMcpRegistry' | 'saveMcpServer' | 'deleteMcpServer'
  | 'setMcpServerEnabled' | 'testMcpConnection' | 'refreshMcpCatalog'> {
  return {
    loadMcpRegistry: vi.fn(async (): Promise<McpRegistryLoadResult> => createMcpRegistryLoadResultFixture()),
    saveMcpServer: vi.fn(async (): Promise<McpSaveServerResult> => createMcpSaveServerSuccessFixture()),
    deleteMcpServer: vi.fn(async (): Promise<McpDeleteServerResult> => createMcpDeleteServerSuccessFixture()),
    setMcpServerEnabled: vi.fn(async (): Promise<McpSetServerEnabledResult> => createMcpSetServerEnabledSuccessFixture(false)),
    testMcpConnection: vi.fn(async (): Promise<McpTestConnectionResult> => createMcpTestConnectionSuccessFixture('stdio')),
    refreshMcpCatalog: vi.fn(async (): Promise<McpRefreshCatalogResult> => createMcpRefreshCatalogSuccessFixture()),
  }
}

function createSkillRegistryFixtures(): Pick<RendererIpcHandlers,
  'loadSkillRegistry' | 'importSkill' | 'selectAndImportSkill'
  | 'deleteSkill' | 'setSkillEnabled' | 'refreshSkills'> {
  const skillRecord = createSkillRecordFixture()
  const skillId = skillRecord.skillId

  return {
    loadSkillRegistry: vi.fn(async (): Promise<SkillRegistryLoadResult> => ({
      ok: true,
      registryRevision: 3,
      snapshotRevision: 5,
      skills: [skillRecord],
    })),
    importSkill: vi.fn(async (): Promise<SkillImportResult> => ({
      ok: true,
      registryRevision: 4,
      snapshotRevision: 6,
      skill: skillRecord,
      validationErrors: [],
    })),
    selectAndImportSkill: vi.fn(async (): Promise<SkillSelectAndImportResult> => ({
      ok: true,
      registryRevision: 4,
      snapshotRevision: 6,
      skill: skillRecord,
      validationErrors: [],
    })),
    deleteSkill: vi.fn(async (): Promise<SkillDeleteResult> => ({
      ok: true,
      registryRevision: 5,
      snapshotRevision: 7,
      skillId,
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
      refreshedSkillIds: [skillId],
      results: [{
        skillId,
        status: 'valid',
        errors: [],
        warnings: [],
      }],
    })),
  }
}

function createCopilotHistoryFixtures(): Pick<RendererIpcHandlers,
  'listCopilotHistoryThreads' | 'getCopilotHistoryThreadDetail'
  | 'getCopilotHistoryRunReplay' | 'renameCopilotHistoryThread'
  | 'duplicateCopilotHistoryThread' | 'deleteCopilotHistoryThread'
  | 'backupCopilotHistoryDatabase' | 'restoreCopilotHistoryDatabase'> {
  return {
    listCopilotHistoryThreads: vi.fn(async (): Promise<CopilotHistoryListThreadsResult> => ({
      ok: true,
      version: H,
      threads: [],
    })),
    getCopilotHistoryThreadDetail: vi.fn(async (): Promise<CopilotHistoryThreadDetailResult> => ({
      ok: true,
      version: H,
      thread: {
        ...THREAD_1,
        title: '历史线程',
        titleSource: 'deterministic' as const,
        createdAt: '2026-04-13T14:00:00Z',
        updatedAt: T1405,
        lastActivityAt: T1405,
        lastRunId: 'run-1',
        lastRunStatus: 'completed' as const,
      },
      timelineItems: [],
      runSummaries: [],
      latestConfigurationSnapshot: null,
      availabilityDrift: null,
    })),
    getCopilotHistoryRunReplay: vi.fn(async (): Promise<CopilotHistoryRunReplayResult> => ({
      ok: true,
      version: H,
      run: {
        runId: 'run-1',
        threadId: 'thread-1',
        status: 'completed' as const,
        createdAt: '2026-04-13T14:00:00Z',
        updatedAt: T1405,
        startedAt: '2026-04-13T14:00:01Z',
        terminalAt: T1405,
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
      version: H,
      thread: {
        ...THREAD_1,
        title: '已重命名线程',
        titleSource: 'manual' as const,
        createdAt: '2026-04-13T14:00:00Z',
        updatedAt: '2026-04-13T14:06:00Z',
        lastActivityAt: T1405,
        lastRunId: 'run-1',
        lastRunStatus: 'completed' as const,
      },
    })),
    duplicateCopilotHistoryThread: vi.fn(async (): Promise<CopilotHistoryThreadDuplicateResult> => ({
      ok: true,
      version: H,
      thread: {
        threadId: 'thread-copy-1',
        boundAgentId: 'default',
        title: '历史线程（副本）',
        titleSource: 'manual' as const,
        summary: '已持久化回复',
        summarySource: 'deterministic' as const,
        createdAt: '2026-04-13T14:06:30Z',
        updatedAt: '2026-04-13T14:06:30Z',
        lastActivityAt: '2026-04-13T14:06:30Z',
        lastRunId: 'run-copy-1',
        lastRunStatus: 'completed' as const,
        lastUserMessagePreview: '你好',
        lastAssistantMessagePreview: '已持久化回复',
        driftSummary: { status: 'not_evaluated' as const },
      },
    })),
    deleteCopilotHistoryThread: vi.fn(async (): Promise<CopilotHistoryThreadDeleteResult> => ({
      ok: true,
      version: H,
      threadId: 'thread-1',
      deletedAt: '2026-04-13T14:06:00Z',
    })),
    backupCopilotHistoryDatabase: vi.fn(async (): Promise<CopilotHistoryDatabaseBackupResult> => ({
      ok: true,
      version: H,
      databasePath: 'D:/workspace/copilot-data/database/copilot-chat.db',
      backupPath: 'D:/workspace/copilot-data/backups/copilot-chat.backup.db',
      createdAt: '2026-04-13T14:08:00Z',
    })),
    restoreCopilotHistoryDatabase: vi.fn(async (): Promise<CopilotHistoryDatabaseRestoreResult> => ({
      ok: true,
      version: H,
      databasePath: 'D:/workspace/copilot-data/database/copilot-chat.db',
      sourcePath: 'D:/workspace/copilot-data/backups/copilot-chat.backup.db',
      restoredAt: '2026-04-13T14:09:00Z',
    })),
  }
}

function createToolCatalogFixtures(): Pick<RendererIpcHandlers, 'loadToolCatalog'> {
  return {
    loadToolCatalog: vi.fn(async (): Promise<ToolCatalogLoadResult> => ({
      ok: true,
      directoryVersion: 'tools-v1',
      tools: [{
        toolId: 'functions.read_file',
        kind: 'builtin' as const,
        availability: 'available' as const,
        displayName: '读取文件',
        description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
      }],
    })),
  }
}

function createCopilotRuntimeFixtures(): Pick<RendererIpcHandlers,
  'loadCopilotRuntime' | 'retryCopilotRuntime' | 'getCopilotRuntimeLocalToken'> {
  return {
    loadCopilotRuntime: vi.fn(async (): Promise<CopilotRuntimeLoadResult> => ({
      ok: true,
      snapshot: createCopilotRuntimeSnapshotFixture('ready', 'development'),
    })),
    retryCopilotRuntime: vi.fn(async (): Promise<CopilotRuntimeLoadResult> => ({
      ok: true,
      snapshot: createCopilotRuntimeSnapshotFixture('starting', null),
    })),
    getCopilotRuntimeLocalToken: vi.fn(async () => 'runtime-token'),
  }
}

function createAttachmentManagerFixtures(): Pick<RendererIpcHandlers,
  'readClipboardAttachmentData' | 'writeAttachmentTempFile'
  | 'readAttachmentPreview' | 'cleanupAttachmentTempFiles'> {
  const attachmentData = {
    mimeType: 'image/png' as const,
    base64Data: 'cG5nLWRhdGE=',
    byteLength: 8,
    width: 320,
    height: 180,
    suggestedName: 'pasted-image.png',
  }

  return {
    readClipboardAttachmentData: vi.fn(async (): Promise<ReadClipboardAttachmentDataResult> => ({
      ok: true,
      status: 'image' as const,
      availableFormats: ['image/png'],
      data: attachmentData,
    })),
    writeAttachmentTempFile: vi.fn(async (): Promise<WriteAttachmentTempFileResult> => ({
      ok: true,
      file: {
        path: '/tmp/candue-attachments/pasted-image.png',
        name: 'pasted-image.png',
        mimeType: 'image/png',
        size: 8,
        createdAt: '2026-05-09T06:00:00.000Z',
        isTemporary: true,
      },
    })),
    readAttachmentPreview: vi.fn(async (): Promise<ReadAttachmentPreviewResult> => ({
      ok: true,
      kind: 'text' as const,
      path: '/tmp/readme.txt',
      name: 'readme.txt',
      size: 16,
      mimeType: 'text/plain',
      text: 'hello attachment',
      truncated: false,
      maxBytes: 1024,
      encoding: 'utf-8',
    })),
    cleanupAttachmentTempFiles: vi.fn(async (): Promise<CleanupTemporaryAttachmentFilesResult> => ({
      ok: true,
      deletedPaths: ['/tmp/candue-attachments/pasted-image.png'],
      missingPaths: [],
      skippedPaths: [],
    })),
  }
}

function createDesktopWindowFixtures(): Pick<RendererIpcHandlers,
  'notifyDesktopNotification' | 'loadDesktopWindowState'
  | 'minimizeDesktopWindow' | 'toggleMaximizeDesktopWindow'
  | 'closeDesktopWindow' | 'notifyBootstrapWindowReady'> {
  return {
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
  }
}

function createFileManagerFixtures(): Pick<RendererIpcHandlers,
  'selectRootDirectory' | 'listDirectory' | 'probeDirectory'
  | 'createDirectory' | 'copyEntries' | 'moveEntries'
  | 'renameEntry' | 'trashEntries' | 'deleteEntriesPermanently'
  | 'watchDirectories' | 'unwatchDirectories'
  | 'loadLastRootDirectory' | 'saveLastRootDirectory' | 'clearLastRootDirectory'
  | 'openEntryWithSystem' | 'revealEntryInFolder' | 'copyTextToClipboard'> {
  const okResult: FileOperationResult = { ok: true, affectedPaths: [] }

  return {
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
    createDirectory: vi.fn(async (): Promise<FileOperationResult> => okResult),
    copyEntries: vi.fn(async (): Promise<FileOperationResult> => okResult),
    moveEntries: vi.fn(async (): Promise<FileOperationResult> => okResult),
    renameEntry: vi.fn(async (): Promise<FileOperationResult> => okResult),
    trashEntries: vi.fn(async (): Promise<FileOperationResult> => okResult),
    deleteEntriesPermanently: vi.fn(async (): Promise<FileOperationResult> => okResult),
    watchDirectories: vi.fn(async (): Promise<FileOperationResult> => okResult),
    unwatchDirectories: vi.fn(async (): Promise<FileOperationResult> => okResult),
    loadLastRootDirectory: vi.fn(async (): Promise<LoadLastRootDirectoryResult> => ({
      ok: true,
      rootPath: '/test/last-root',
    })),
    saveLastRootDirectory: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: ['/test/saved-root'],
    })),
    clearLastRootDirectory: vi.fn(async (): Promise<FileOperationResult> => okResult),
    openEntryWithSystem: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: ['/test/opened-file.txt'],
    })),
    revealEntryInFolder: vi.fn(async (): Promise<FileOperationResult> => ({
      ok: true,
      affectedPaths: ['/test/revealed-entry'],
    })),
    copyTextToClipboard: vi.fn(async (): Promise<FileOperationResult> => okResult),
  }
}
