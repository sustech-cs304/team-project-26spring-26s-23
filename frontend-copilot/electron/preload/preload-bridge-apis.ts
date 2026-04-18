import type { IpcRenderer } from 'electron'
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
import { TOOL_CATALOG_LOAD_CHANNEL, type ToolCatalogApi } from '../tool-catalog/ipc'

export interface PreloadBridgeApis {
  copilotRuntime: CopilotRuntimeApi
  copilotHistory: CopilotHistoryApi
  configCenterPublicSnapshot: ConfigCenterPublicSnapshotApi
  configCenterPublicSnapshotSubscription: ConfigCenterPublicSnapshotSubscriptionApi
  configCenterPublicPatch: ConfigCenterPublicPatchApi
  settingsWorkspaceState: SettingsWorkspaceStateApi
  settingsWorkspaceSecrets: SettingsWorkspaceSecretsApi
  toolCatalog: ToolCatalogApi
  desktopNotification: DesktopNotificationApi
  bootstrapWindow: BootstrapWindowApi
}

type IpcRendererLike = Pick<IpcRenderer, 'invoke' | 'on' | 'off'>

export function createPreloadBridgeApis(ipcRenderer: IpcRendererLike): PreloadBridgeApis {
  return {
    copilotRuntime: {
      load() {
        return ipcRenderer.invoke(COPILOT_RUNTIME_LOAD_CHANNEL)
      },
      retry() {
        return ipcRenderer.invoke(COPILOT_RUNTIME_RETRY_CHANNEL)
      },
    },
    copilotHistory: {
      listThreads() {
        return ipcRenderer.invoke(COPILOT_HISTORY_LIST_THREADS_CHANNEL)
      },
      getThreadDetail(threadId) {
        return ipcRenderer.invoke(COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL, threadId)
      },
      getRunReplay(runId) {
        return ipcRenderer.invoke(COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL, runId)
      },
      renameThread(threadId, request) {
        return ipcRenderer.invoke(COPILOT_HISTORY_RENAME_THREAD_CHANNEL, threadId, request)
      },
      duplicateThread(threadId, request) {
        return ipcRenderer.invoke(COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL, threadId, request)
      },
      deleteThread(threadId) {
        return ipcRenderer.invoke(COPILOT_HISTORY_DELETE_THREAD_CHANNEL, threadId)
      },
      backupDatabase(request) {
        return ipcRenderer.invoke(COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL, request)
      },
      restoreDatabase(request) {
        return ipcRenderer.invoke(COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL, request)
      },
    },
    configCenterPublicSnapshot: {
      load() {
        return ipcRenderer.invoke(CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL)
      },
    },
    configCenterPublicSnapshotSubscription: createConfigCenterPublicSnapshotSubscriptionApi(ipcRenderer),
    configCenterPublicPatch: {
      apply(patch) {
        return ipcRenderer.invoke(CONFIG_CENTER_PUBLIC_PATCH_CHANNEL, patch)
      },
    },
    settingsWorkspaceState: {
      load() {
        return ipcRenderer.invoke(SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL)
      },
      save(input) {
        return ipcRenderer.invoke(SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL, input)
      },
    },
    settingsWorkspaceSecrets: {
      loadStatuses(request) {
        return ipcRenderer.invoke(SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL, request)
      },
      loadSustechCasPassword() {
        return ipcRenderer.invoke(SETTINGS_WORKSPACE_SECRETS_LOAD_SUSTECH_CAS_CHANNEL)
      },
      saveProfileApiKey(request) {
        return ipcRenderer.invoke(SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL, request)
      },
      clearProfileApiKey(request) {
        return ipcRenderer.invoke(SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL, request)
      },
      saveSustechCasPassword(request) {
        return ipcRenderer.invoke(SETTINGS_WORKSPACE_SECRETS_SAVE_SUSTECH_CAS_CHANNEL, request)
      },
      clearSustechCasPassword() {
        return ipcRenderer.invoke(SETTINGS_WORKSPACE_SECRETS_CLEAR_SUSTECH_CAS_CHANNEL)
      },
    },
    toolCatalog: {
      load(request) {
        return ipcRenderer.invoke(TOOL_CATALOG_LOAD_CHANNEL, request)
      },
    },
    desktopNotification: {
      show(request) {
        return ipcRenderer.invoke(DESKTOP_NOTIFICATION_SHOW_CHANNEL, request)
      },
    },
    bootstrapWindow: {
      signalBootstrapScreenReady() {
        return ipcRenderer.invoke(BOOTSTRAP_WINDOW_READY_CHANNEL)
      },
    },
  }
}
