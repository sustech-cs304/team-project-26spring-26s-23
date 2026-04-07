import type { IpcMain } from 'electron'
import {
  CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
  type ConfigCenterPublicPatch,
  type ConfigCenterPublicPatchResult,
} from './config-center/public-patch'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  type ConfigCenterPublicSnapshotLoadResult,
} from './config-center/public-snapshot'
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
} from './settings-workspace/ipc'
import type { SettingsWorkspaceStateSaveInput } from './settings-workspace/state-schema'
import {
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
  type CopilotRuntimeLoadResult,
} from './copilot-runtime'
import { BOOTSTRAP_WINDOW_READY_CHANNEL } from './bootstrap-window'

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>

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
  notifyBootstrapWindowReady: () => Promise<void>
}

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
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
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

  ipcMain.handle(COPILOT_RUNTIME_LOAD_CHANNEL, async (): Promise<CopilotRuntimeLoadResult> => {
    return await handlers.loadCopilotRuntime()
  })

  ipcMain.handle(COPILOT_RUNTIME_RETRY_CHANNEL, async (): Promise<CopilotRuntimeLoadResult> => {
    return await handlers.retryCopilotRuntime()
  })

  ipcMain.handle(BOOTSTRAP_WINDOW_READY_CHANNEL, async (): Promise<void> => {
    await handlers.notifyBootstrapWindowReady()
  })
}
