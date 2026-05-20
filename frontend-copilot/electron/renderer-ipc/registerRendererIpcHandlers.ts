import type { IpcMain } from 'electron'
import {
  CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
  type ConfigCenterPublicPatch,
  type ConfigCenterPublicPatchResult,
} from '../config-center/public-patch'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  type ConfigCenterPublicSnapshotLoadResult,
} from '../config-center/public-snapshot'
import {
  COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL,
  COPILOT_HISTORY_DELETE_THREAD_CHANNEL,
  COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL,
  COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL,
  COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL,
  COPILOT_HISTORY_LIST_THREADS_CHANNEL,
  COPILOT_HISTORY_RENAME_THREAD_CHANNEL,
  COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL,
  type CopilotHistoryBackupDatabaseRequest,
  type CopilotHistoryDatabaseBackupResult,
  type CopilotHistoryDatabaseRestoreResult,
  type CopilotHistoryDuplicateThreadRequest,
  type CopilotHistoryListThreadsResult,
  type CopilotHistoryRenameThreadRequest,
  type CopilotHistoryRestoreDatabaseRequest,
  type CopilotHistoryRunReplayResult,
  type CopilotHistoryThreadDeleteResult,
  type CopilotHistoryThreadDetailResult,
  type CopilotHistoryThreadDuplicateResult,
  type CopilotHistoryThreadRenameResult,
} from '../copilot-history'
import {
  SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_CLEAR_SUSTECH_CAS_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_LOAD_SUSTECH_CAS_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_SAVE_SUSTECH_CAS_CHANNEL,
  SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL,
  SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL,
  type SettingsWorkspaceClearProfileApiKeyRequest,
  type SettingsWorkspaceProfileSecretMutationResult,
  type SettingsWorkspaceSaveProfileApiKeyRequest,
  type SettingsWorkspaceSaveSustechCasPasswordRequest,
  type SettingsWorkspaceSecretsLoadStatusesRequest,
  type SettingsWorkspaceSecretsLoadStatusesResult,
  type SettingsWorkspaceStateLoadResult,
  type SettingsWorkspaceStateSaveResult,
  type SettingsWorkspaceSustechCasSecretLoadResult,
  type SettingsWorkspaceSustechCasSecretMutationResult,
} from '../settings-workspace/ipc'
import type { SettingsWorkspaceStateSaveInput } from '../settings-workspace/state-schema'
import {
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_LOCAL_TOKEN_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
  type CopilotRuntimeLoadResult,
} from '../copilot-runtime'
import {
  DESKTOP_NOTIFICATION_SHOW_CHANNEL,
  type DesktopNotificationRequest,
} from '../desktop-notification'
import { BOOTSTRAP_WINDOW_READY_CHANNEL } from '../bootstrap-window'
import {
  DESKTOP_WINDOW_CLOSE_CHANNEL,
  DESKTOP_WINDOW_MINIMIZE_CHANNEL,
  DESKTOP_WINDOW_STATE_LOAD_CHANNEL,
  DESKTOP_WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
  type DesktopWindowState,
} from '../window-controls'
import {
  MANAGED_RUNTIME_INSTALL_OR_REPAIR_CHANNEL,
  MANAGED_RUNTIME_LOAD_CHANNEL,
  type ManagedRuntimeLoadResponse,
} from '../managed-runtime/ipc'
import type { ManagedRuntimeActionReason } from '../managed-runtime/types'
import {
  MCP_REGISTRY_DELETE_SERVER_CHANNEL,
  MCP_REGISTRY_LOAD_CHANNEL,
  MCP_REGISTRY_REFRESH_CATALOG_CHANNEL,
  MCP_REGISTRY_SAVE_SERVER_CHANNEL,
  MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL,
  MCP_REGISTRY_TEST_CONNECTION_CHANNEL,
  type McpDeleteServerResult,
  type McpRefreshCatalogRequest,
  type McpRefreshCatalogResult,
  type McpRegistryLoadRequest,
  type McpRegistryLoadResult,
  type McpSaveServerResult,
  type McpSetServerEnabledRequest,
  type McpSetServerEnabledResult,
  type McpTestConnectionRequest,
  type McpTestConnectionResult,
} from '../mcp-registry/ipc'
import type { McpServerDraft } from '../mcp-registry/types'
import {
  SKILL_REGISTRY_DELETE_SKILL_CHANNEL,
  SKILL_REGISTRY_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_LOAD_CHANNEL,
  SKILL_REGISTRY_SELECT_AND_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_REFRESH_SKILLS_CHANNEL,
  SKILL_REGISTRY_SET_SKILL_ENABLED_CHANNEL,
  type SkillDeleteResult,
  type SkillImportRequest,
  type SkillImportResult,
  type SkillRefreshRequest,
  type SkillRefreshResult,
  type SkillRegistryLoadRequest,
  type SkillSelectAndImportResult,
  type SkillRegistryLoadResult,
  type SkillSetEnabledRequest,
  type SkillSetEnabledResult,
} from '../skill-registry/ipc'
import {
  TOOL_CATALOG_LOAD_CHANNEL,
  type ToolCatalogLoadRequest,
  type ToolCatalogLoadResult,
} from '../tool-catalog/ipc'
import {
  ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL,
  ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL,
  ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL,
  ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL,
  type CleanupTemporaryAttachmentFilesRequest,
  type CleanupTemporaryAttachmentFilesResult,
  type ReadAttachmentPreviewRequest,
  type ReadAttachmentPreviewResult,
  type ReadClipboardAttachmentDataResult,
  type WriteAttachmentTempFileRequest,
  type WriteAttachmentTempFileResult,
} from '../attachment-service/ipc'
import {
  FILE_MANAGER_COPY_ENTRIES_CHANNEL,
  FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL,
  FILE_MANAGER_CREATE_DIRECTORY_CHANNEL,
  FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL,
  FILE_MANAGER_LIST_DIRECTORY_CHANNEL,
  FILE_MANAGER_MOVE_ENTRIES_CHANNEL,
  FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL,
  FILE_MANAGER_PROBE_DIRECTORY_CHANNEL,
  FILE_MANAGER_RENAME_ENTRY_CHANNEL,
  FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL,
  FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_TRASH_ENTRIES_CHANNEL,
  FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL,
  type CopyEntriesRequest,
  type CopyTextToClipboardRequest,
  type CreateDirectoryRequest,
  type DeleteEntriesRequest,
  type FileOperationResult,
  type ListDirectoryRequest,
  type ListDirectoryResult,
  type LoadLastRootDirectoryResult,
  type MoveEntriesRequest,
  type OpenEntryWithSystemRequest,
  type ProbeDirectoryRequest,
  type ProbeDirectoryResult,
  type RenameEntryRequest,
  type RevealEntryInFolderRequest,
  type SaveLastRootDirectoryRequest,
  type SelectRootDirectoryRequest,
  type SelectDirectoryResult,
  type TrashEntriesRequest,
  type UnwatchDirectoriesRequest,
  type WatchDirectoriesRequest,
} from '../file-manager/ipc'
import {
  TIMELINE_DATABASE_LOAD_EVENTS_CHANNEL,
  TIMELINE_DATABASE_ADD_EVENT_CHANNEL,
} from './timeline-database.ipc'
import type {
  AddTimelineEventRequest,
  AddTimelineEventResult,
  LoadTimelineEventsResult,
} from '../timeline-database/ipc'
import type { RendererIpcHandlers } from './RendererIpcHandlers'

export type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>

const RENDERER_IPC_CHANNELS = [
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
  SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL,
  SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_LOAD_SUSTECH_CAS_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_SAVE_SUSTECH_CAS_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_CLEAR_SUSTECH_CAS_CHANNEL,
  MANAGED_RUNTIME_INSTALL_OR_REPAIR_CHANNEL,
  MANAGED_RUNTIME_LOAD_CHANNEL,
  MCP_REGISTRY_LOAD_CHANNEL,
  MCP_REGISTRY_SAVE_SERVER_CHANNEL,
  MCP_REGISTRY_DELETE_SERVER_CHANNEL,
  MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL,
  MCP_REGISTRY_TEST_CONNECTION_CHANNEL,
  MCP_REGISTRY_REFRESH_CATALOG_CHANNEL,
  SKILL_REGISTRY_LOAD_CHANNEL,
  SKILL_REGISTRY_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_SELECT_AND_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_DELETE_SKILL_CHANNEL,
  SKILL_REGISTRY_SET_SKILL_ENABLED_CHANNEL,
  SKILL_REGISTRY_REFRESH_SKILLS_CHANNEL,
  COPILOT_HISTORY_LIST_THREADS_CHANNEL,
  COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL,
  COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL,
  COPILOT_HISTORY_RENAME_THREAD_CHANNEL,
  COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL,
  COPILOT_HISTORY_DELETE_THREAD_CHANNEL,
  COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL,
  COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL,
  TOOL_CATALOG_LOAD_CHANNEL,
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
  COPILOT_RUNTIME_LOCAL_TOKEN_CHANNEL,
  ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL,
  ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL,
  ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL,
  ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL,
  DESKTOP_NOTIFICATION_SHOW_CHANNEL,
  BOOTSTRAP_WINDOW_READY_CHANNEL,
  DESKTOP_WINDOW_STATE_LOAD_CHANNEL,
  DESKTOP_WINDOW_MINIMIZE_CHANNEL,
  DESKTOP_WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
  DESKTOP_WINDOW_CLOSE_CHANNEL,
  FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_LIST_DIRECTORY_CHANNEL,
  FILE_MANAGER_PROBE_DIRECTORY_CHANNEL,
  FILE_MANAGER_CREATE_DIRECTORY_CHANNEL,
  FILE_MANAGER_COPY_ENTRIES_CHANNEL,
  FILE_MANAGER_MOVE_ENTRIES_CHANNEL,
  FILE_MANAGER_RENAME_ENTRY_CHANNEL,
  FILE_MANAGER_TRASH_ENTRIES_CHANNEL,
  FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL,
  FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL,
  FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL,
  FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL,
  TIMELINE_DATABASE_LOAD_EVENTS_CHANNEL,
  TIMELINE_DATABASE_ADD_EVENT_CHANNEL,
] as const

export function registerRendererIpcHandlers(
  ipcMain: IpcMainLike,
  handlers: RendererIpcHandlers,
): void {
  for (const channel of RENDERER_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }

  registerConfigAndSettingsHandlers(ipcMain, handlers)
  registerManagedRuntimeHandlers(ipcMain, handlers)
  registerMcpRegistryHandlers(ipcMain, handlers)
  registerSkillRegistryHandlers(ipcMain, handlers)
  registerCopilotHistoryHandlers(ipcMain, handlers)
  registerToolAndRuntimeHandlers(ipcMain, handlers)
  registerAttachmentManagerHandlers(ipcMain, handlers)
  registerDesktopNotificationAndWindowHandlers(ipcMain, handlers)
  registerFileManagerHandlers(ipcMain, handlers)
  registerTimelineDatabaseHandlers(ipcMain, handlers)
}

function registerConfigAndSettingsHandlers(ipcMain: IpcMainLike, handlers: RendererIpcHandlers): void {
  ipcMain.handle(CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL, async (): Promise<ConfigCenterPublicSnapshotLoadResult> => {
    return await handlers.loadConfigCenterPublicSnapshot()
  })

  ipcMain.handle(
    CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
    async (_event, patch: ConfigCenterPublicPatch): Promise<ConfigCenterPublicPatchResult> => {
      return await handlers.applyConfigCenterPublicPatch(patch)
    },
  )

  ipcMain.handle(SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL, async (): Promise<SettingsWorkspaceStateLoadResult> => {
    return await handlers.loadSettingsWorkspaceState()
  })

  ipcMain.handle(
    SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL,
    async (_event, input: SettingsWorkspaceStateSaveInput): Promise<SettingsWorkspaceStateSaveResult> => {
      return await handlers.saveSettingsWorkspaceState(input)
    },
  )

  ipcMain.handle(
    SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL,
    async (_event, request?: SettingsWorkspaceSecretsLoadStatusesRequest): Promise<SettingsWorkspaceSecretsLoadStatusesResult> => {
      return await handlers.loadSettingsWorkspaceSecretStates(request)
    },
  )

  ipcMain.handle(
    SETTINGS_WORKSPACE_SECRETS_LOAD_SUSTECH_CAS_CHANNEL,
    async (): Promise<SettingsWorkspaceSustechCasSecretLoadResult> => {
      return await handlers.loadSettingsWorkspaceSustechCasSecret()
    },
  )

  ipcMain.handle(
    SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL,
    async (
      _event,
      request: SettingsWorkspaceSaveProfileApiKeyRequest,
    ): Promise<SettingsWorkspaceProfileSecretMutationResult> => {
      return await handlers.saveSettingsWorkspaceProfileSecret(request)
    },
  )

  ipcMain.handle(
    SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL,
    async (
      _event,
      request: SettingsWorkspaceClearProfileApiKeyRequest,
    ): Promise<SettingsWorkspaceProfileSecretMutationResult> => {
      return await handlers.clearSettingsWorkspaceProfileSecret(request)
    },
  )

  ipcMain.handle(
    SETTINGS_WORKSPACE_SECRETS_SAVE_SUSTECH_CAS_CHANNEL,
    async (
      _event,
      request: SettingsWorkspaceSaveSustechCasPasswordRequest,
    ): Promise<SettingsWorkspaceSustechCasSecretMutationResult> => {
      return await handlers.saveSettingsWorkspaceSustechCasSecret(request)
    },
  )

  ipcMain.handle(
    SETTINGS_WORKSPACE_SECRETS_CLEAR_SUSTECH_CAS_CHANNEL,
    async (): Promise<SettingsWorkspaceSustechCasSecretMutationResult> => {
      return await handlers.clearSettingsWorkspaceSustechCasSecret()
    },
  )
}

function registerManagedRuntimeHandlers(ipcMain: IpcMainLike, handlers: RendererIpcHandlers): void {
  ipcMain.handle(
    MANAGED_RUNTIME_LOAD_CHANNEL,
    async (): Promise<ManagedRuntimeLoadResponse> => {
      return await handlers.loadManagedRuntime()
    },
  )

  ipcMain.handle(
    MANAGED_RUNTIME_INSTALL_OR_REPAIR_CHANNEL,
    async (_event, reason?: ManagedRuntimeActionReason): Promise<ManagedRuntimeLoadResponse> => {
      return await handlers.installOrRepairManagedRuntime(reason)
    },
  )
}

function registerMcpRegistryHandlers(ipcMain: IpcMainLike, handlers: RendererIpcHandlers): void {
  ipcMain.handle(
    MCP_REGISTRY_LOAD_CHANNEL,
    async (_event, request?: McpRegistryLoadRequest): Promise<McpRegistryLoadResult> => {
      return await handlers.loadMcpRegistry(request)
    },
  )

  ipcMain.handle(
    MCP_REGISTRY_SAVE_SERVER_CHANNEL,
    async (_event, draft: McpServerDraft): Promise<McpSaveServerResult> => {
      return await handlers.saveMcpServer(draft)
    },
  )

  ipcMain.handle(
    MCP_REGISTRY_DELETE_SERVER_CHANNEL,
    async (_event, serverId: string): Promise<McpDeleteServerResult> => {
      return await handlers.deleteMcpServer(serverId)
    },
  )

  ipcMain.handle(
    MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL,
    async (_event, request: McpSetServerEnabledRequest): Promise<McpSetServerEnabledResult> => {
      return await handlers.setMcpServerEnabled(request)
    },
  )

  ipcMain.handle(
    MCP_REGISTRY_TEST_CONNECTION_CHANNEL,
    async (_event, request: McpTestConnectionRequest): Promise<McpTestConnectionResult> => {
      return await handlers.testMcpConnection(request)
    },
  )

  ipcMain.handle(
    MCP_REGISTRY_REFRESH_CATALOG_CHANNEL,
    async (_event, request?: McpRefreshCatalogRequest): Promise<McpRefreshCatalogResult> => {
      return await handlers.refreshMcpCatalog(request)
    },
  )
}

function registerSkillRegistryHandlers(ipcMain: IpcMainLike, handlers: RendererIpcHandlers): void {
  ipcMain.handle(
    SKILL_REGISTRY_LOAD_CHANNEL,
    async (_event, request?: SkillRegistryLoadRequest): Promise<SkillRegistryLoadResult> => {
      return await handlers.loadSkillRegistry(request)
    },
  )

  ipcMain.handle(
    SKILL_REGISTRY_IMPORT_SKILL_CHANNEL,
    async (_event, request: SkillImportRequest): Promise<SkillImportResult> => {
      return await handlers.importSkill(request)
    },
  )

  ipcMain.handle(
    SKILL_REGISTRY_SELECT_AND_IMPORT_SKILL_CHANNEL,
    async (): Promise<SkillSelectAndImportResult> => {
      return await handlers.selectAndImportSkill()
    },
  )

  ipcMain.handle(
    SKILL_REGISTRY_DELETE_SKILL_CHANNEL,
    async (_event, skillId: string): Promise<SkillDeleteResult> => {
      return await handlers.deleteSkill(skillId)
    },
  )

  ipcMain.handle(
    SKILL_REGISTRY_SET_SKILL_ENABLED_CHANNEL,
    async (_event, request: SkillSetEnabledRequest): Promise<SkillSetEnabledResult> => {
      return await handlers.setSkillEnabled(request)
    },
  )

  ipcMain.handle(
    SKILL_REGISTRY_REFRESH_SKILLS_CHANNEL,
    async (_event, request?: SkillRefreshRequest): Promise<SkillRefreshResult> => {
      return await handlers.refreshSkills(request)
    },
  )
}

function registerCopilotHistoryHandlers(ipcMain: IpcMainLike, handlers: RendererIpcHandlers): void {
  ipcMain.handle(COPILOT_HISTORY_LIST_THREADS_CHANNEL, async (): Promise<CopilotHistoryListThreadsResult> => {
    return await handlers.listCopilotHistoryThreads()
  })

  ipcMain.handle(
    COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL,
    async (_event, threadId: string): Promise<CopilotHistoryThreadDetailResult> => {
      return await handlers.getCopilotHistoryThreadDetail(threadId)
    },
  )

  ipcMain.handle(
    COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL,
    async (_event, runId: string): Promise<CopilotHistoryRunReplayResult> => {
      return await handlers.getCopilotHistoryRunReplay(runId)
    },
  )

  ipcMain.handle(
    COPILOT_HISTORY_RENAME_THREAD_CHANNEL,
    async (
      _event,
      threadId: string,
      request: CopilotHistoryRenameThreadRequest,
    ): Promise<CopilotHistoryThreadRenameResult> => {
      return await handlers.renameCopilotHistoryThread(threadId, request)
    },
  )

  ipcMain.handle(
    COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL,
    async (
      _event,
      threadId: string,
      request?: CopilotHistoryDuplicateThreadRequest,
    ): Promise<CopilotHistoryThreadDuplicateResult> => {
      return await handlers.duplicateCopilotHistoryThread(threadId, request)
    },
  )

  ipcMain.handle(
    COPILOT_HISTORY_DELETE_THREAD_CHANNEL,
    async (_event, threadId: string): Promise<CopilotHistoryThreadDeleteResult> => {
      return await handlers.deleteCopilotHistoryThread(threadId)
    },
  )

  ipcMain.handle(
    COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL,
    async (
      _event,
      request?: CopilotHistoryBackupDatabaseRequest,
    ): Promise<CopilotHistoryDatabaseBackupResult> => {
      return await handlers.backupCopilotHistoryDatabase(request)
    },
  )

  ipcMain.handle(
    COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL,
    async (
      _event,
      request: CopilotHistoryRestoreDatabaseRequest,
    ): Promise<CopilotHistoryDatabaseRestoreResult> => {
      return await handlers.restoreCopilotHistoryDatabase(request)
    },
  )
}

function registerToolAndRuntimeHandlers(ipcMain: IpcMainLike, handlers: RendererIpcHandlers): void {
  ipcMain.handle(TOOL_CATALOG_LOAD_CHANNEL, async (_event, request?: ToolCatalogLoadRequest): Promise<ToolCatalogLoadResult> => {
    return await handlers.loadToolCatalog(request)
  })

  ipcMain.handle(COPILOT_RUNTIME_LOAD_CHANNEL, async (): Promise<CopilotRuntimeLoadResult> => {
    return await handlers.loadCopilotRuntime()
  })

  ipcMain.handle(COPILOT_RUNTIME_RETRY_CHANNEL, async (): Promise<CopilotRuntimeLoadResult> => {
    return await handlers.retryCopilotRuntime()
  })

  ipcMain.handle(COPILOT_RUNTIME_LOCAL_TOKEN_CHANNEL, async (): Promise<string | null> => {
    return await handlers.getCopilotRuntimeLocalToken()
  })
}

function registerAttachmentManagerHandlers(ipcMain: IpcMainLike, handlers: RendererIpcHandlers): void {
  ipcMain.handle(ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL, async (): Promise<ReadClipboardAttachmentDataResult> => {
    return await handlers.readClipboardAttachmentData()
  })

  ipcMain.handle(
    ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL,
    async (_event, request: WriteAttachmentTempFileRequest): Promise<WriteAttachmentTempFileResult> => {
      return await handlers.writeAttachmentTempFile(request)
    },
  )

  ipcMain.handle(
    ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL,
    async (_event, request: ReadAttachmentPreviewRequest): Promise<ReadAttachmentPreviewResult> => {
      return await handlers.readAttachmentPreview(request)
    },
  )

  ipcMain.handle(
    ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL,
    async (
      _event,
      request: CleanupTemporaryAttachmentFilesRequest,
    ): Promise<CleanupTemporaryAttachmentFilesResult> => {
      return await handlers.cleanupAttachmentTempFiles(request)
    },
  )
}

function registerDesktopNotificationAndWindowHandlers(ipcMain: IpcMainLike, handlers: RendererIpcHandlers): void {
  ipcMain.handle(DESKTOP_NOTIFICATION_SHOW_CHANNEL, async (_event, request: DesktopNotificationRequest): Promise<void> => {
    await handlers.notifyDesktopNotification(request)
  })

  ipcMain.handle(BOOTSTRAP_WINDOW_READY_CHANNEL, async (): Promise<void> => {
    await handlers.notifyBootstrapWindowReady()
  })

  ipcMain.handle(DESKTOP_WINDOW_STATE_LOAD_CHANNEL, async (): Promise<DesktopWindowState> => {
    return await handlers.loadDesktopWindowState()
  })

  ipcMain.handle(DESKTOP_WINDOW_MINIMIZE_CHANNEL, async (): Promise<void> => {
    await handlers.minimizeDesktopWindow()
  })

  ipcMain.handle(DESKTOP_WINDOW_TOGGLE_MAXIMIZE_CHANNEL, async (): Promise<DesktopWindowState> => {
    return await handlers.toggleMaximizeDesktopWindow()
  })

  ipcMain.handle(DESKTOP_WINDOW_CLOSE_CHANNEL, async (): Promise<void> => {
    await handlers.closeDesktopWindow()
  })
}

function registerFileManagerHandlers(ipcMain: IpcMainLike, handlers: RendererIpcHandlers): void {
  ipcMain.handle(FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL, async (_event, request?: SelectRootDirectoryRequest): Promise<SelectDirectoryResult> => {
    return request === undefined
      ? await handlers.selectRootDirectory()
      : await handlers.selectRootDirectory(request)
  })

  ipcMain.handle(
    FILE_MANAGER_LIST_DIRECTORY_CHANNEL,
    async (_event, request: ListDirectoryRequest): Promise<ListDirectoryResult> => {
      return await handlers.listDirectory(request)
    },
  )

  ipcMain.handle(
    FILE_MANAGER_PROBE_DIRECTORY_CHANNEL,
    async (_event, request: ProbeDirectoryRequest): Promise<ProbeDirectoryResult> => {
      return await handlers.probeDirectory(request)
    },
  )

  ipcMain.handle(
    FILE_MANAGER_CREATE_DIRECTORY_CHANNEL,
    async (_event, request: CreateDirectoryRequest): Promise<FileOperationResult> => {
      return await handlers.createDirectory(request)
    },
  )

  ipcMain.handle(
    FILE_MANAGER_COPY_ENTRIES_CHANNEL,
    async (_event, request: CopyEntriesRequest): Promise<FileOperationResult> => {
      return await handlers.copyEntries(request)
    },
  )

  ipcMain.handle(
    FILE_MANAGER_MOVE_ENTRIES_CHANNEL,
    async (_event, request: MoveEntriesRequest): Promise<FileOperationResult> => {
      return await handlers.moveEntries(request)
    },
  )

  ipcMain.handle(
    FILE_MANAGER_RENAME_ENTRY_CHANNEL,
    async (_event, request: RenameEntryRequest): Promise<FileOperationResult> => {
      return await handlers.renameEntry(request)
    },
  )

  ipcMain.handle(
    FILE_MANAGER_TRASH_ENTRIES_CHANNEL,
    async (_event, request: TrashEntriesRequest): Promise<FileOperationResult> => {
      return await handlers.trashEntries(request)
    },
  )

  ipcMain.handle(
    FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL,
    async (_event, request: DeleteEntriesRequest): Promise<FileOperationResult> => {
      return await handlers.deleteEntriesPermanently(request)
    },
  )

  ipcMain.handle(
    FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL,
    async (_event, request: WatchDirectoriesRequest): Promise<FileOperationResult> => {
      return await handlers.watchDirectories(request)
    },
  )

  ipcMain.handle(
    FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL,
    async (_event, request: UnwatchDirectoriesRequest): Promise<FileOperationResult> => {
      return await handlers.unwatchDirectories(request)
    },
  )

  ipcMain.handle(FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL, async (): Promise<LoadLastRootDirectoryResult> => {
    return await handlers.loadLastRootDirectory()
  })

  ipcMain.handle(
    FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL,
    async (_event, request: SaveLastRootDirectoryRequest): Promise<FileOperationResult> => {
      return await handlers.saveLastRootDirectory(request)
    },
  )

  ipcMain.handle(FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL, async (): Promise<FileOperationResult> => {
    return await handlers.clearLastRootDirectory()
  })

  ipcMain.handle(
    FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL,
    async (_event, request: OpenEntryWithSystemRequest): Promise<FileOperationResult> => {
      return await handlers.openEntryWithSystem(request)
    },
  )

  ipcMain.handle(
    FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL,
    async (_event, request: RevealEntryInFolderRequest): Promise<FileOperationResult> => {
      return await handlers.revealEntryInFolder(request)
    },
  )

  ipcMain.handle(
    FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL,
    async (_event, request: CopyTextToClipboardRequest): Promise<FileOperationResult> => {
      return await handlers.copyTextToClipboard(request)
    },
  )
}

function registerTimelineDatabaseHandlers(ipcMain: IpcMainLike, handlers: RendererIpcHandlers): void {
  ipcMain.handle(
    TIMELINE_DATABASE_LOAD_EVENTS_CHANNEL,
    async (): Promise<LoadTimelineEventsResult> => {
      return await handlers.loadTimelineEvents()
    },
  )

  ipcMain.handle(
    TIMELINE_DATABASE_ADD_EVENT_CHANNEL,
    async (_event, request: AddTimelineEventRequest): Promise<AddTimelineEventResult> => {
      return await handlers.addTimelineEvent(request)
    },
  )
}
