"use strict";
const electron = require("electron");
const COPILOT_SETTINGS_LOAD_CHANNEL = "copilot-settings:load";
const COPILOT_SETTINGS_SAVE_CHANNEL = "copilot-settings:save";
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  }
  // You can expose other APTs you need here.
  // ...
});
const copilotSettingsApi = {
  load() {
    return electron.ipcRenderer.invoke(COPILOT_SETTINGS_LOAD_CHANNEL);
  },
  save(patch) {
    return electron.ipcRenderer.invoke(COPILOT_SETTINGS_SAVE_CHANNEL, patch);
  }
};
electron.contextBridge.exposeInMainWorld("copilotSettings", copilotSettingsApi);
