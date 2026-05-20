import type { IpcRenderer } from 'electron'
import {
  ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL,
  ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL,
  ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL,
  ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL,
  type AttachmentManagerApi,
} from '../attachment-service/ipc'
import {
  CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
  type ConfigCenterPublicPatchApi,
} from '../config-center/public-patch'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  type ConfigCenterPublicSnapshotApi,
  type ConfigCenterPublicSnapshotSubscriptionApi,
} from '../config-center/public-snapshot'
import { createConfigCenterPublicSnapshotSubscriptionApi } from '../config-center/public-snapshot-subscription'
import {
  COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL,
  COPILOT_HISTORY_DELETE_THREAD_CHANNEL,
  COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL,
  COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL,
  COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL,
  COPILOT_HISTORY_LIST_THREADS_CHANNEL,
  COPILOT_HISTORY_RENAME_THREAD_CHANNEL,
  COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL,
  type CopilotHistoryApi,
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
  type SettingsWorkspaceSecretsApi,
  type SettingsWorkspaceStateApi,
} from '../settings-workspace/ipc'
import {
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
  type CopilotRuntimeApi,
} from '../copilot-runtime'
import {
  DESKTOP_NOTIFICATION_SHOW_CHANNEL,
  type DesktopNotificationApi,
} from '../desktop-notification'
import { BOOTSTRAP_WINDOW_READY_CHANNEL, type BootstrapWindowApi } from '../bootstrap-window'
import {
  DESKTOP_WINDOW_CLOSE_CHANNEL,
  DESKTOP_WINDOW_MINIMIZE_CHANNEL,
  DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
  DESKTOP_WINDOW_STATE_LOAD_CHANNEL,
  DESKTOP_WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
  type DesktopWindowControlsApi,
  type DesktopWindowState,
} from '../window-controls'
import {
  MANAGED_RUNTIME_INSTALL_OR_REPAIR_CHANNEL,
  MANAGED_RUNTIME_LOAD_CHANNEL,
  type ManagedRuntimeApi,
} from '../managed-runtime/ipc'
import {
  MCP_REGISTRY_DELETE_SERVER_CHANNEL,
  MCP_REGISTRY_LOAD_CHANNEL,
  MCP_REGISTRY_REFRESH_CATALOG_CHANNEL,
  MCP_REGISTRY_SAVE_SERVER_CHANNEL,
  MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL,
  MCP_REGISTRY_TEST_CONNECTION_CHANNEL,
  createMcpRegistrySubscriptionApi,
  type McpRegistryApi,
  type McpRegistrySubscriptionApi,
} from '../mcp-registry/ipc'
import {
  SKILL_REGISTRY_DELETE_SKILL_CHANNEL,
  SKILL_REGISTRY_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_LOAD_CHANNEL,
  SKILL_REGISTRY_REFRESH_SKILLS_CHANNEL,
  SKILL_REGISTRY_SELECT_AND_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_SET_SKILL_ENABLED_CHANNEL,
  createSkillRegistrySubscriptionApi,
  type SkillRegistryApi,
  type SkillRegistrySubscriptionApi,
} from '../skill-registry/ipc'
import { TOOL_CATALOG_LOAD_CHANNEL, type ToolCatalogApi } from '../tool-catalog/ipc'
import {
  FILE_MANAGER_COPY_ENTRIES_CHANNEL,
  FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL,
  FILE_MANAGER_CREATE_DIRECTORY_CHANNEL,
  FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL,
  FILE_MANAGER_DIRECTORY_CHANGED_CHANNEL,
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
  type DirectoryChangedEvent,
  type FileManagerApi,
} from '../file-manager/ipc'
import {
  TIMELINE_DATABASE_LOAD_EVENTS_CHANNEL,
  TIMELINE_DATABASE_ADD_EVENT_CHANNEL,
  type TimelineDatabaseApi,
} from '../renderer-ipc/timeline-database.ipc'

export interface PreloadBridgeApis {
  copilotRuntime: CopilotRuntimeApi
  copilotHistory: CopilotHistoryApi
  configCenterPublicSnapshot: ConfigCenterPublicSnapshotApi
  configCenterPublicSnapshotSubscription: ConfigCenterPublicSnapshotSubscriptionApi
  configCenterPublicPatch: ConfigCenterPublicPatchApi
  settingsWorkspaceState: SettingsWorkspaceStateApi
  settingsWorkspaceSecrets: SettingsWorkspaceSecretsApi
  managedRuntime: ManagedRuntimeApi
  mcpRegistry: McpRegistryApi
  mcpRegistrySubscription: McpRegistrySubscriptionApi
  skillRegistry: SkillRegistryApi
  skillRegistrySubscription: SkillRegistrySubscriptionApi
  toolCatalog: ToolCatalogApi
  attachmentManager: AttachmentManagerApi
  desktopNotification: DesktopNotificationApi
  windowControls: DesktopWindowControlsApi
  bootstrapWindow: BootstrapWindowApi
  fileManager: FileManagerApi
  timelineDatabase: TimelineDatabaseApi
}

type IpcRendererLike = Pick<IpcRenderer, 'invoke' | 'on' | 'off'>

function buildCopilotRuntimeApi(ipcRenderer: IpcRendererLike): CopilotRuntimeApi {
  return {
    load() { return ipcRenderer.invoke(COPILOT_RUNTIME_LOAD_CHANNEL) },
    retry() { return ipcRenderer.invoke(COPILOT_RUNTIME_RETRY_CHANNEL) },
  }
}

function buildCopilotHistoryApi(ipcRenderer: IpcRendererLike): CopilotHistoryApi {
  return {
    listThreads() { return ipcRenderer.invoke(COPILOT_HISTORY_LIST_THREADS_CHANNEL) },
    getThreadDetail(threadId) { return ipcRenderer.invoke(COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL, threadId) },
    getRunReplay(runId) { return ipcRenderer.invoke(COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL, runId) },
    renameThread(threadId, request) { return ipcRenderer.invoke(COPILOT_HISTORY_RENAME_THREAD_CHANNEL, threadId, request) },
    duplicateThread(threadId, request) { return ipcRenderer.invoke(COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL, threadId, request) },
    deleteThread(threadId) { return ipcRenderer.invoke(COPILOT_HISTORY_DELETE_THREAD_CHANNEL, threadId) },
    backupDatabase(request) { return ipcRenderer.invoke(COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL, request) },
    restoreDatabase(request) { return ipcRenderer.invoke(COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL, request) },
  }
}

function buildConfigCenterPublicSnapshotApi(ipcRenderer: IpcRendererLike): ConfigCenterPublicSnapshotApi {
  return {
    load() { return ipcRenderer.invoke(CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL) },
  }
}

function buildConfigCenterPublicPatchApi(ipcRenderer: IpcRendererLike): ConfigCenterPublicPatchApi {
  return {
    apply(patch) { return ipcRenderer.invoke(CONFIG_CENTER_PUBLIC_PATCH_CHANNEL, patch) },
  }
}

function buildSettingsWorkspaceStateApi(ipcRenderer: IpcRendererLike): SettingsWorkspaceStateApi {
  return {
    load() { return ipcRenderer.invoke(SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL) },
    save(input) { return ipcRenderer.invoke(SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL, input) },
  }
}

function buildSettingsWorkspaceSecretsApi(ipcRenderer: IpcRendererLike): SettingsWorkspaceSecretsApi {
  return {
    loadStatuses(request) { return ipcRenderer.invoke(SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL, request) },
    loadSustechCasPassword() { return ipcRenderer.invoke(SETTINGS_WORKSPACE_SECRETS_LOAD_SUSTECH_CAS_CHANNEL) },
    saveProfileApiKey(request) { return ipcRenderer.invoke(SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL, request) },
    clearProfileApiKey(request) { return ipcRenderer.invoke(SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL, request) },
    saveSustechCasPassword(request) { return ipcRenderer.invoke(SETTINGS_WORKSPACE_SECRETS_SAVE_SUSTECH_CAS_CHANNEL, request) },
    clearSustechCasPassword() { return ipcRenderer.invoke(SETTINGS_WORKSPACE_SECRETS_CLEAR_SUSTECH_CAS_CHANNEL) },
  }
}

function buildManagedRuntimeApi(ipcRenderer: IpcRendererLike): ManagedRuntimeApi {
  return {
    load() { return ipcRenderer.invoke(MANAGED_RUNTIME_LOAD_CHANNEL) },
    installOrRepair(reason) { return ipcRenderer.invoke(MANAGED_RUNTIME_INSTALL_OR_REPAIR_CHANNEL, reason) },
  }
}

function buildMcpRegistryApi(ipcRenderer: IpcRendererLike): McpRegistryApi {
  return {
    loadRegistry(request) { return ipcRenderer.invoke(MCP_REGISTRY_LOAD_CHANNEL, request) },
    saveServer(draft) { return ipcRenderer.invoke(MCP_REGISTRY_SAVE_SERVER_CHANNEL, draft) },
    deleteServer(serverId) { return ipcRenderer.invoke(MCP_REGISTRY_DELETE_SERVER_CHANNEL, serverId) },
    setServerEnabled(request) { return ipcRenderer.invoke(MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL, request) },
    testConnection(request) { return ipcRenderer.invoke(MCP_REGISTRY_TEST_CONNECTION_CHANNEL, request) },
    refreshCatalog(request) { return ipcRenderer.invoke(MCP_REGISTRY_REFRESH_CATALOG_CHANNEL, request) },
  }
}

function buildSkillRegistryApi(ipcRenderer: IpcRendererLike): SkillRegistryApi {
  return {
    loadRegistry(request) { return ipcRenderer.invoke(SKILL_REGISTRY_LOAD_CHANNEL, request) },
    importSkill(request) { return ipcRenderer.invoke(SKILL_REGISTRY_IMPORT_SKILL_CHANNEL, request) },
    selectAndImportSkill() { return ipcRenderer.invoke(SKILL_REGISTRY_SELECT_AND_IMPORT_SKILL_CHANNEL) },
    deleteSkill(skillId) { return ipcRenderer.invoke(SKILL_REGISTRY_DELETE_SKILL_CHANNEL, skillId) },
    setSkillEnabled(request) { return ipcRenderer.invoke(SKILL_REGISTRY_SET_SKILL_ENABLED_CHANNEL, request) },
    refreshSkills(request) { return ipcRenderer.invoke(SKILL_REGISTRY_REFRESH_SKILLS_CHANNEL, request) },
  }
}

function buildToolCatalogApi(ipcRenderer: IpcRendererLike): ToolCatalogApi {
  return {
    load(request) { return ipcRenderer.invoke(TOOL_CATALOG_LOAD_CHANNEL, request) },
  }
}

function buildAttachmentManagerApi(
  ipcRenderer: IpcRendererLike,
  helpers: { resolveFilePath?: (file: File) => string | null },
): AttachmentManagerApi {
  return {
    resolveFilePath(file) { return helpers.resolveFilePath?.(file) ?? null },
    readClipboardData() { return ipcRenderer.invoke(ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL) },
    writeTempFile(request) { return ipcRenderer.invoke(ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL, request) },
    readPreview(request) { return ipcRenderer.invoke(ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL, request) },
    cleanupTempFiles(request) { return ipcRenderer.invoke(ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL, request) },
  }
}

function buildDesktopNotificationApi(ipcRenderer: IpcRendererLike): DesktopNotificationApi {
  return {
    show(request) { return ipcRenderer.invoke(DESKTOP_NOTIFICATION_SHOW_CHANNEL, request) },
  }
}

function buildWindowControlsApi(ipcRenderer: IpcRendererLike): DesktopWindowControlsApi {
  return {
    loadState() { return ipcRenderer.invoke(DESKTOP_WINDOW_STATE_LOAD_CHANNEL) },
    minimize() { return ipcRenderer.invoke(DESKTOP_WINDOW_MINIMIZE_CHANNEL) },
    toggleMaximize() { return ipcRenderer.invoke(DESKTOP_WINDOW_TOGGLE_MAXIMIZE_CHANNEL) },
    close() { return ipcRenderer.invoke(DESKTOP_WINDOW_CLOSE_CHANNEL) },
    onStateChanged(listener: (state: DesktopWindowState) => void): () => void {
      const handler = (_event: unknown, state: DesktopWindowState) => { listener(state) }
      ipcRenderer.on(DESKTOP_WINDOW_STATE_CHANGED_CHANNEL, handler)
      return () => { ipcRenderer.off(DESKTOP_WINDOW_STATE_CHANGED_CHANNEL, handler) }
    },
  }
}

function buildBootstrapWindowApi(ipcRenderer: IpcRendererLike): BootstrapWindowApi {
  return {
    signalBootstrapScreenReady() { return ipcRenderer.invoke(BOOTSTRAP_WINDOW_READY_CHANNEL) },
  }
}

function buildFileManagerApi(ipcRenderer: IpcRendererLike): FileManagerApi {
  return {
    selectRootDirectory(request) {
      return request === undefined
        ? ipcRenderer.invoke(FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL)
        : ipcRenderer.invoke(FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL, request)
    },
    listDirectory(request) { return ipcRenderer.invoke(FILE_MANAGER_LIST_DIRECTORY_CHANNEL, request) },
    probeDirectory(request) { return ipcRenderer.invoke(FILE_MANAGER_PROBE_DIRECTORY_CHANNEL, request) },
    createDirectory(request) { return ipcRenderer.invoke(FILE_MANAGER_CREATE_DIRECTORY_CHANNEL, request) },
    copyEntries(request) { return ipcRenderer.invoke(FILE_MANAGER_COPY_ENTRIES_CHANNEL, request) },
    moveEntries(request) { return ipcRenderer.invoke(FILE_MANAGER_MOVE_ENTRIES_CHANNEL, request) },
    renameEntry(request) { return ipcRenderer.invoke(FILE_MANAGER_RENAME_ENTRY_CHANNEL, request) },
    trashEntries(request) { return ipcRenderer.invoke(FILE_MANAGER_TRASH_ENTRIES_CHANNEL, request) },
    deleteEntriesPermanently(request) { return ipcRenderer.invoke(FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL, request) },
    watchDirectories(request) { return ipcRenderer.invoke(FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL, request) },
    unwatchDirectories(request) { return ipcRenderer.invoke(FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL, request) },
    onDirectoryChanged(listener: (event: DirectoryChangedEvent) => void): () => void {
      const handler = (_event: unknown, event: DirectoryChangedEvent) => { listener(event) }
      ipcRenderer.on(FILE_MANAGER_DIRECTORY_CHANGED_CHANNEL, handler)
      return () => { ipcRenderer.off(FILE_MANAGER_DIRECTORY_CHANGED_CHANNEL, handler) }
    },
    loadLastRootDirectory() { return ipcRenderer.invoke(FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL) },
    saveLastRootDirectory(request) { return ipcRenderer.invoke(FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL, request) },
    clearLastRootDirectory() { return ipcRenderer.invoke(FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL) },
    openEntryWithSystem(request) { return ipcRenderer.invoke(FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL, request) },
    revealEntryInFolder(request) { return ipcRenderer.invoke(FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL, request) },
    copyTextToClipboard(request) { return ipcRenderer.invoke(FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL, request) },
  }
}

function buildTimelineDatabaseApi(ipcRenderer: IpcRendererLike): TimelineDatabaseApi {
  return {
    loadEvents() { return ipcRenderer.invoke(TIMELINE_DATABASE_LOAD_EVENTS_CHANNEL) },
    addEvent(request) { return ipcRenderer.invoke(TIMELINE_DATABASE_ADD_EVENT_CHANNEL, request) },
  }
}

export function createPreloadBridgeApis(
  ipcRenderer: IpcRendererLike,
  helpers: {
    resolveFilePath?: (file: File) => string | null
  } = {},
): PreloadBridgeApis {
  return {
    copilotRuntime: buildCopilotRuntimeApi(ipcRenderer),
    copilotHistory: buildCopilotHistoryApi(ipcRenderer),
    configCenterPublicSnapshot: buildConfigCenterPublicSnapshotApi(ipcRenderer),
    configCenterPublicSnapshotSubscription: createConfigCenterPublicSnapshotSubscriptionApi(ipcRenderer),
    configCenterPublicPatch: buildConfigCenterPublicPatchApi(ipcRenderer),
    settingsWorkspaceState: buildSettingsWorkspaceStateApi(ipcRenderer),
    settingsWorkspaceSecrets: buildSettingsWorkspaceSecretsApi(ipcRenderer),
    managedRuntime: buildManagedRuntimeApi(ipcRenderer),
    mcpRegistry: buildMcpRegistryApi(ipcRenderer),
    mcpRegistrySubscription: createMcpRegistrySubscriptionApi(ipcRenderer),
    skillRegistry: buildSkillRegistryApi(ipcRenderer),
    skillRegistrySubscription: createSkillRegistrySubscriptionApi(ipcRenderer),
    toolCatalog: buildToolCatalogApi(ipcRenderer),
    attachmentManager: buildAttachmentManagerApi(ipcRenderer, helpers),
    desktopNotification: buildDesktopNotificationApi(ipcRenderer),
    windowControls: buildWindowControlsApi(ipcRenderer),
    bootstrapWindow: buildBootstrapWindowApi(ipcRenderer),
    fileManager: buildFileManagerApi(ipcRenderer),
    timelineDatabase: buildTimelineDatabaseApi(ipcRenderer),
  }
}
