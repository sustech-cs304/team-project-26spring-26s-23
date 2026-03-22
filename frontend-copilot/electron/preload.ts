import { ipcRenderer, contextBridge } from 'electron'
import {
  COPILOT_SETTINGS_LOAD_CHANNEL,
  COPILOT_SETTINGS_SAVE_CHANNEL,
} from './copilot-settings'
import type { CopilotSettingsApi } from './copilot-settings'

const copilotSettingsApi: CopilotSettingsApi = {
  load() {
    return ipcRenderer.invoke(COPILOT_SETTINGS_LOAD_CHANNEL)
  },
  save(patch) {
    return ipcRenderer.invoke(COPILOT_SETTINGS_SAVE_CHANNEL, patch)
  },
}

contextBridge.exposeInMainWorld('copilotSettings', copilotSettingsApi)
