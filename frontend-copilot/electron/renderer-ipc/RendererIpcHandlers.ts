import type {
  ConfigCenterPublicPatch,
  ConfigCenterPublicPatchResult,
} from '../config-center/public-patch'
import type { ConfigCenterPublicSnapshotLoadResult } from '../config-center/public-snapshot'
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
  loadCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  retryCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  notifyDesktopNotification: (request: DesktopNotificationRequest) => Promise<void>
  notifyBootstrapWindowReady: () => Promise<void>
}
