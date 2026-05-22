import { ipcRenderer, contextBridge, webUtils } from 'electron'

import { createPreloadBridgeApis } from './preload/preload-bridge-apis'
import { exposePreloadBridgeApis } from './preload/preload-bridge-registration'
import { registerPreloadRuntimeSupport } from './preload/preload-runtime-support'

const preloadBridgeApis = createPreloadBridgeApis(ipcRenderer, {
  resolveFilePath(file) {
    try {
      const path = webUtils.getPathForFile(file).trim()
      return path === '' ? null : path
    } catch {
      return null
    }
  },
})

registerPreloadRuntimeSupport(ipcRenderer)
exposePreloadBridgeApis(contextBridge, preloadBridgeApis)
