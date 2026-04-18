import type { IpcRendererLike } from '../renderer-ipc-contract'
import { registerRuntimeConsoleForwarding } from '../runtime-console-forwarding'

export function registerPreloadRuntimeSupport(ipcRenderer: IpcRendererLike): void {
  registerRuntimeConsoleForwarding(ipcRenderer)
}
