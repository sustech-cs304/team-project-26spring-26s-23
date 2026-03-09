import { ipcRenderer, contextBridge } from 'electron'
import {
  COPILOT_SETTINGS_LOAD_CHANNEL,
  COPILOT_SETTINGS_SAVE_CHANNEL,
} from './copilot-settings'
import type { CopilotSettingsApi } from './copilot-settings'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

const copilotSettingsApi: CopilotSettingsApi = {
  load() {
    return ipcRenderer.invoke(COPILOT_SETTINGS_LOAD_CHANNEL)
  },
  save(patch) {
    return ipcRenderer.invoke(COPILOT_SETTINGS_SAVE_CHANNEL, patch)
  },
}

contextBridge.exposeInMainWorld('copilotSettings', copilotSettingsApi)
