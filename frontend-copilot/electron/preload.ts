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
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
} from './copilot-runtime'
import type { CopilotRuntimeApi } from './copilot-runtime'

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

contextBridge.exposeInMainWorld('copilotRuntime', copilotRuntimeApi)
contextBridge.exposeInMainWorld('configCenterPublicSnapshot', configCenterPublicSnapshotApi)
contextBridge.exposeInMainWorld('configCenterPublicSnapshotSubscription', configCenterPublicSnapshotSubscriptionApi)
contextBridge.exposeInMainWorld('configCenterPublicPatch', configCenterPublicPatchApi)
