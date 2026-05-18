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
  COPILOT_RUNTIME_RETRY_CHANNEL,
  type CopilotRuntimeLoadResult,
} from '../copilot-runtime'
import {
  DESKTOP_NOTIFICATION_SHOW_CHANNEL,
  type DesktopNotificationRequest,
} from '../desktop-notification'
import { BOOTSTRAP_WINDOW_READY_CHANNEL } from '../bootstrap-window'
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
  DESKTOP_NOTIFICATION_SHOW_CHANNEL,
  BOOTSTRAP_WINDOW_READY_CHANNEL,
] as const

export function registerRendererIpcHandlers(
  ipcMain: IpcMainLike,
  handlers: RendererIpcHandlers,
): void {
  for (const channel of RENDERER_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }

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

  ipcMain.handle(TOOL_CATALOG_LOAD_CHANNEL, async (_event, request?: ToolCatalogLoadRequest): Promise<ToolCatalogLoadResult> => {
    return await handlers.loadToolCatalog(request)
  })

  ipcMain.handle(COPILOT_RUNTIME_LOAD_CHANNEL, async (): Promise<CopilotRuntimeLoadResult> => {
    return await handlers.loadCopilotRuntime()
  })

  ipcMain.handle(COPILOT_RUNTIME_RETRY_CHANNEL, async (): Promise<CopilotRuntimeLoadResult> => {
    return await handlers.retryCopilotRuntime()
  })

  ipcMain.handle(DESKTOP_NOTIFICATION_SHOW_CHANNEL, async (_event, request: DesktopNotificationRequest): Promise<void> => {
    await handlers.notifyDesktopNotification(request)
  })

  ipcMain.handle(BOOTSTRAP_WINDOW_READY_CHANNEL, async (): Promise<void> => {
    await handlers.notifyBootstrapWindowReady()
  })
}
