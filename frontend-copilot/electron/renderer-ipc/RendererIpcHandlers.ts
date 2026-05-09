import type {
  ConfigCenterPublicPatch,
  ConfigCenterPublicPatchResult,
} from '../config-center/public-patch'
import type { ConfigCenterPublicSnapshotLoadResult } from '../config-center/public-snapshot'
import type {
  CopilotHistoryBackupDatabaseRequest,
  CopilotHistoryDatabaseBackupResult,
  CopilotHistoryDatabaseRestoreResult,
  CopilotHistoryDuplicateThreadRequest,
  CopilotHistoryListThreadsResult,
  CopilotHistoryRenameThreadRequest,
  CopilotHistoryRestoreDatabaseRequest,
  CopilotHistoryRunReplayResult,
  CopilotHistoryThreadDeleteResult,
  CopilotHistoryThreadDetailResult,
  CopilotHistoryThreadDuplicateResult,
  CopilotHistoryThreadRenameResult,
} from '../copilot-history'
import type {
  SettingsWorkspaceClearProfileApiKeyRequest,
  SettingsWorkspaceProfileSecretMutationResult,
  SettingsWorkspaceSaveProfileApiKeyRequest,
  SettingsWorkspaceSaveSustechCasPasswordRequest,
  SettingsWorkspaceSecretsLoadStatusesRequest,
  SettingsWorkspaceSecretsLoadStatusesResult,
  SettingsWorkspaceStateLoadResult,
  SettingsWorkspaceStateSaveResult,
  SettingsWorkspaceSustechCasSecretLoadResult,
  SettingsWorkspaceSustechCasSecretMutationResult,
} from '../settings-workspace/ipc'
import type { SettingsWorkspaceStateSaveInput } from '../settings-workspace/state-schema'
import type { CopilotRuntimeLoadResult } from '../copilot-runtime'
import type { DesktopNotificationRequest } from '../desktop-notification'
import type { DesktopWindowState } from '../window-controls'
import type { ManagedRuntimeLoadResponse } from '../managed-runtime/ipc'
import type { ManagedRuntimeActionReason } from '../managed-runtime/types'
import type {
  McpDeleteServerResult,
  McpRefreshCatalogRequest,
  McpRefreshCatalogResult,
  McpRegistryLoadRequest,
  McpRegistryLoadResult,
  McpSaveServerResult,
  McpSetServerEnabledRequest,
  McpSetServerEnabledResult,
  McpTestConnectionRequest,
  McpTestConnectionResult,
} from '../mcp-registry/ipc'
import type { McpServerDraft } from '../mcp-registry/types'
import type {
  SkillDeleteResult,
  SkillImportRequest,
  SkillImportResult,
  SkillRefreshRequest,
  SkillSelectAndImportResult,
  SkillRefreshResult,
  SkillRegistryLoadRequest,
  SkillRegistryLoadResult,
  SkillSetEnabledRequest,
  SkillSetEnabledResult,
} from '../skill-registry/ipc'
import type { ToolCatalogLoadRequest, ToolCatalogLoadResult } from '../tool-catalog/ipc'
import type {
  CopyEntriesRequest,
  CopyTextToClipboardRequest,
  CreateDirectoryRequest,
  DeleteEntriesRequest,
  FileOperationResult,
  ListDirectoryRequest,
  ListDirectoryResult,
  LoadLastRootDirectoryResult,
  MoveEntriesRequest,
  OpenEntryWithSystemRequest,
  ProbeDirectoryRequest,
  ProbeDirectoryResult,
  RenameEntryRequest,
  RevealEntryInFolderRequest,
  SaveLastRootDirectoryRequest,
  SavePastedFileRequest,
  SelectRootDirectoryRequest,
  SelectDirectoryResult,
  TrashEntriesRequest,
  UnwatchDirectoriesRequest,
  WatchDirectoriesRequest,
} from '../file-manager/ipc'

export interface RendererIpcHandlers {
  loadConfigCenterPublicSnapshot: () => Promise<ConfigCenterPublicSnapshotLoadResult>
  applyConfigCenterPublicPatch: (patch: ConfigCenterPublicPatch) => Promise<ConfigCenterPublicPatchResult>
  loadSettingsWorkspaceState: () => Promise<SettingsWorkspaceStateLoadResult>
  saveSettingsWorkspaceState: (input: SettingsWorkspaceStateSaveInput) => Promise<SettingsWorkspaceStateSaveResult>
  loadSettingsWorkspaceSecretStates: (
    request?: SettingsWorkspaceSecretsLoadStatusesRequest,
  ) => Promise<SettingsWorkspaceSecretsLoadStatusesResult>
  loadSettingsWorkspaceSustechCasSecret: () => Promise<SettingsWorkspaceSustechCasSecretLoadResult>
  saveSettingsWorkspaceProfileSecret: (
    request: SettingsWorkspaceSaveProfileApiKeyRequest,
  ) => Promise<SettingsWorkspaceProfileSecretMutationResult>
  clearSettingsWorkspaceProfileSecret: (
    request: SettingsWorkspaceClearProfileApiKeyRequest,
  ) => Promise<SettingsWorkspaceProfileSecretMutationResult>
  saveSettingsWorkspaceSustechCasSecret: (
    request: SettingsWorkspaceSaveSustechCasPasswordRequest,
  ) => Promise<SettingsWorkspaceSustechCasSecretMutationResult>
  clearSettingsWorkspaceSustechCasSecret: () => Promise<SettingsWorkspaceSustechCasSecretMutationResult>
  loadMcpRegistry: (request?: McpRegistryLoadRequest) => Promise<McpRegistryLoadResult>
  loadSkillRegistry: (request?: SkillRegistryLoadRequest) => Promise<SkillRegistryLoadResult>
  importSkill: (request: SkillImportRequest) => Promise<SkillImportResult>
  selectAndImportSkill: () => Promise<SkillSelectAndImportResult>
  deleteSkill: (skillId: string) => Promise<SkillDeleteResult>
  setSkillEnabled: (request: SkillSetEnabledRequest) => Promise<SkillSetEnabledResult>
  refreshSkills: (request?: SkillRefreshRequest) => Promise<SkillRefreshResult>
  loadManagedRuntime: () => Promise<ManagedRuntimeLoadResponse>
  installOrRepairManagedRuntime: (reason?: ManagedRuntimeActionReason) => Promise<ManagedRuntimeLoadResponse>
  saveMcpServer: (draft: McpServerDraft) => Promise<McpSaveServerResult>
  deleteMcpServer: (serverId: string) => Promise<McpDeleteServerResult>
  setMcpServerEnabled: (request: McpSetServerEnabledRequest) => Promise<McpSetServerEnabledResult>
  testMcpConnection: (request: McpTestConnectionRequest) => Promise<McpTestConnectionResult>
  refreshMcpCatalog: (request?: McpRefreshCatalogRequest) => Promise<McpRefreshCatalogResult>
  listCopilotHistoryThreads: () => Promise<CopilotHistoryListThreadsResult>
  getCopilotHistoryThreadDetail: (threadId: string) => Promise<CopilotHistoryThreadDetailResult>
  getCopilotHistoryRunReplay: (runId: string) => Promise<CopilotHistoryRunReplayResult>
  renameCopilotHistoryThread: (
    threadId: string,
    request: CopilotHistoryRenameThreadRequest,
  ) => Promise<CopilotHistoryThreadRenameResult>
  duplicateCopilotHistoryThread: (
    threadId: string,
    request?: CopilotHistoryDuplicateThreadRequest,
  ) => Promise<CopilotHistoryThreadDuplicateResult>
  deleteCopilotHistoryThread: (threadId: string) => Promise<CopilotHistoryThreadDeleteResult>
  backupCopilotHistoryDatabase: (
    request?: CopilotHistoryBackupDatabaseRequest,
  ) => Promise<CopilotHistoryDatabaseBackupResult>
  restoreCopilotHistoryDatabase: (
    request: CopilotHistoryRestoreDatabaseRequest,
  ) => Promise<CopilotHistoryDatabaseRestoreResult>
  loadToolCatalog: (request?: ToolCatalogLoadRequest) => Promise<ToolCatalogLoadResult>
  loadCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  retryCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  notifyDesktopNotification: (request: DesktopNotificationRequest) => Promise<void>
  loadDesktopWindowState: () => Promise<DesktopWindowState>
  minimizeDesktopWindow: () => Promise<void>
  toggleMaximizeDesktopWindow: () => Promise<DesktopWindowState>
  closeDesktopWindow: () => Promise<void>
  savePastedFile: (request: SavePastedFileRequest) => Promise<import('../file-manager/ipc').SavePastedFileResult>
  notifyBootstrapWindowReady: () => Promise<void>
  selectRootDirectory: (request?: SelectRootDirectoryRequest) => Promise<SelectDirectoryResult>
  listDirectory: (request: ListDirectoryRequest) => Promise<ListDirectoryResult>
  probeDirectory: (request: ProbeDirectoryRequest) => Promise<ProbeDirectoryResult>
  createDirectory: (request: CreateDirectoryRequest) => Promise<FileOperationResult>
  copyEntries: (request: CopyEntriesRequest) => Promise<FileOperationResult>
  moveEntries: (request: MoveEntriesRequest) => Promise<FileOperationResult>
  renameEntry: (request: RenameEntryRequest) => Promise<FileOperationResult>
  trashEntries: (request: TrashEntriesRequest) => Promise<FileOperationResult>
  deleteEntriesPermanently: (request: DeleteEntriesRequest) => Promise<FileOperationResult>
  watchDirectories: (request: WatchDirectoriesRequest) => Promise<FileOperationResult>
  unwatchDirectories: (request: UnwatchDirectoriesRequest) => Promise<FileOperationResult>
  loadLastRootDirectory: () => Promise<LoadLastRootDirectoryResult>
  saveLastRootDirectory: (request: SaveLastRootDirectoryRequest) => Promise<FileOperationResult>
  clearLastRootDirectory: () => Promise<FileOperationResult>
  openEntryWithSystem: (request: OpenEntryWithSystemRequest) => Promise<FileOperationResult>
  revealEntryInFolder: (request: RevealEntryInFolderRequest) => Promise<FileOperationResult>
  copyTextToClipboard: (request: CopyTextToClipboardRequest) => Promise<FileOperationResult>
}
