import { ipcRenderer, contextBridge } from 'electron'

import { createPreloadBridgeApis } from './preload/preload-bridge-apis'
import { exposePreloadBridgeApis } from './preload/preload-bridge-registration'
import { registerPreloadRuntimeSupport } from './preload/preload-runtime-support'

const preloadBridgeApis = createPreloadBridgeApis(ipcRenderer)

registerPreloadRuntimeSupport(ipcRenderer)
exposePreloadBridgeApis(contextBridge, preloadBridgeApis)
