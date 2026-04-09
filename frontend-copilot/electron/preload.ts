import { ipcRenderer, contextBridge } from 'electron'
import {
  CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
  type ConfigCenterPublicPatchApi,
} from './config-center/public-patch'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  type ConfigCenterPublicSnapshotApi,
} from './config-center/public-snapshot'
import { createConfigCenterPublicSnapshotSubscriptionApi } from './config-center/public-snapshot-subscription'
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
} from './settings-workspace/ipc'
import {
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
} from './copilot-runtime'
import type { CopilotRuntimeApi } from './copilot-runtime'
import { BOOTSTRAP_WINDOW_READY_CHANNEL, type BootstrapWindowApi } from './bootstrap-window'
import { registerRuntimeConsoleForwarding } from './runtime-console-forwarding'

const copilotRuntimeApi: CopilotRuntimeApi = {
  load() {
    return ipcRenderer.invoke(COPILOT_RUNTIME_LOAD_CHANNEL)
  },
  retry() {
    return ipcRenderer.invoke(COPILOT_RUNTIME_RETRY_CHANNEL)
  },
}

const configCenterPublicSnapshotApi: ConfigCenterPublicSnapshotApi = {
  load() {
    return ipcRenderer.invoke(CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL)
  },
}

const configCenterPublicSnapshotSubscriptionApi = createConfigCenterPublicSnapshotSubscriptionApi(ipcRenderer)

const configCenterPublicPatchApi: ConfigCenterPublicPatchApi = {
  apply(patch) {
    return ipcRenderer.invoke(CONFIG_CENTER_PUBLIC_PATCH_CHANNEL, patch)
  },
}

const settingsWorkspaceStateApi: SettingsWorkspaceStateApi = {
  load() {
    return ipcRenderer.invoke(SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL)
  },
  save(input) {
    return ipcRenderer.invoke(SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL, input)
  },
}

const settingsWorkspaceSecretsApi: SettingsWorkspaceSecretsApi = {
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
}

const bootstrapWindowApi: BootstrapWindowApi = {
  signalBootstrapScreenReady() {
    return ipcRenderer.invoke(BOOTSTRAP_WINDOW_READY_CHANNEL)
  },
}

registerRuntimeConsoleForwarding(ipcRenderer)

contextBridge.exposeInMainWorld('copilotRuntime', copilotRuntimeApi)
contextBridge.exposeInMainWorld('configCenterPublicSnapshot', configCenterPublicSnapshotApi)
contextBridge.exposeInMainWorld('configCenterPublicSnapshotSubscription', configCenterPublicSnapshotSubscriptionApi)
contextBridge.exposeInMainWorld('configCenterPublicPatch', configCenterPublicPatchApi)
contextBridge.exposeInMainWorld('settingsWorkspaceState', settingsWorkspaceStateApi)
contextBridge.exposeInMainWorld('settingsWorkspaceSecrets', settingsWorkspaceSecretsApi)
contextBridge.exposeInMainWorld('bootstrapWindow', bootstrapWindowApi)
