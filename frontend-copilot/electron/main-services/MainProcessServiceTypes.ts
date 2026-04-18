import type {
  DesktopCapabilityBridgeRequest,
  DesktopCapabilityBridgeResponse,
} from '../capability-bridge/protocol'
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
import type { ElectronCopilotHistoryService } from '../copilot-history-service'
import type { HostedBackendService } from '../runtime/hosted-backend-service'
import type {
  ConfigCenterPublicPatch,
  ConfigCenterPublicPatchResult,
} from '../config-center/public-patch'
import type {
  ConfigCenterPublicSnapshot,
  ConfigCenterPublicSnapshotLoadResult,
} from '../config-center/public-snapshot'
import type { HostedRuntimePaths } from '../runtime/runtime-paths'
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
import type {
  SettingsWorkspaceProviderRouteResolveRequest,
  SettingsWorkspaceProviderRouteResolveResult,
} from '../settings-workspace/provider-route-resolver'
import type { SettingsWorkspaceStateSaveInput } from '../settings-workspace/state-schema'
import type { ToolCatalogLoadResult } from '../tool-catalog/ipc'

export type MainProcessServiceLogLevel = 'info' | 'warn' | 'error'

export interface MainProcessServiceLogOptions {
  relayToRenderer?: boolean
}

export interface CreateMainProcessServicesOptions {
  prepareRuntimePaths: () => Promise<HostedRuntimePaths>
  ensureHostedBackendService: () => Promise<HostedBackendService>
  appendMainRuntimeLog: (
    level: MainProcessServiceLogLevel,
    message: string,
    context: Record<string, unknown> | null,
    options?: MainProcessServiceLogOptions,
  ) => void | Promise<void>
  publishConfigCenterPublicSnapshotUpdate: (
    snapshot: ConfigCenterPublicSnapshot,
  ) => void | Promise<void>
  createCopilotHistoryService: () => ElectronCopilotHistoryService
}

export interface MainProcessServices {
  loadConfigCenterPublicSnapshot: () => Promise<ConfigCenterPublicSnapshotLoadResult>
  loadToolCatalog: () => Promise<ToolCatalogLoadResult>
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
  resolveSettingsWorkspaceProviderRoute: (
    request: SettingsWorkspaceProviderRouteResolveRequest,
  ) => Promise<SettingsWorkspaceProviderRouteResolveResult>
  handleDesktopCapabilityBridgeRequest: (
    request: DesktopCapabilityBridgeRequest,
  ) => Promise<DesktopCapabilityBridgeResponse>
}
