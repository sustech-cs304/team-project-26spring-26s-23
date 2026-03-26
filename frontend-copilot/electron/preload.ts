import { ipcRenderer, contextBridge } from 'electron'
import {
  COPILOT_SETTINGS_LOAD_CHANNEL,
  COPILOT_SETTINGS_SAVE_CHANNEL,
} from './copilot-settings'
import {
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
} from './copilot-runtime'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  type ConfigCenterPublicSnapshotApi,
} from './config-center/public-snapshot'
import type { CopilotSettingsApi } from './copilot-settings'
import type { CopilotRuntimeApi } from './copilot-runtime'

const copilotSettingsApi: CopilotSettingsApi = {
  load() {
    return ipcRenderer.invoke(COPILOT_SETTINGS_LOAD_CHANNEL)
  },
  save(patch) {
    return ipcRenderer.invoke(COPILOT_SETTINGS_SAVE_CHANNEL, patch)
  },
}

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

contextBridge.exposeInMainWorld('copilotSettings', copilotSettingsApi)
contextBridge.exposeInMainWorld('copilotRuntime', copilotRuntimeApi)
contextBridge.exposeInMainWorld('configCenterPublicSnapshot', configCenterPublicSnapshotApi)
