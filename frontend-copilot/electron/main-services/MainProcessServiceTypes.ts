import type {
  ConfigCenterPublicPatch,
  ConfigCenterPublicPatchResult,
} from '../config-center/public-patch'
import type {
  ConfigCenterPublicSnapshot,
  ConfigCenterPublicSnapshotLoadResult,
} from '../config-center/public-snapshot'
import type {
  CopilotHistoryListThreadsResult,
  CopilotHistoryRunReplayResult,
  CopilotHistoryThreadDetailResult,
} from '../copilot-history'
import type { ElectronCopilotHistoryService } from '../copilot-history-service'
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
import type { HostedRuntimePaths } from '../runtime/runtime-paths'

export type MainProcessServiceLogLevel = 'info' | 'warn' | 'error'

export interface CreateMainProcessServicesOptions {
  prepareRuntimePaths: () => Promise<HostedRuntimePaths>
  appendMainRuntimeLog: (
    level: MainProcessServiceLogLevel,
    message: string,
    context: Record<string, unknown> | null,
  ) => void | Promise<void>
  publishConfigCenterPublicSnapshotUpdate: (
    snapshot: ConfigCenterPublicSnapshot,
  ) => void | Promise<void>
  createCopilotHistoryService: () => ElectronCopilotHistoryService
}

export interface MainProcessServices {
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
  resolveSettingsWorkspaceProviderRoute: (
    request: SettingsWorkspaceProviderRouteResolveRequest,
  ) => Promise<SettingsWorkspaceProviderRouteResolveResult>
  listCopilotHistoryThreads: () => Promise<CopilotHistoryListThreadsResult>
  getCopilotHistoryThreadDetail: (threadId: string) => Promise<CopilotHistoryThreadDetailResult>
  getCopilotHistoryRunReplay: (runId: string) => Promise<CopilotHistoryRunReplayResult>
}
