import type { IpcMain } from 'electron'
import {
  CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
  type ConfigCenterPublicPatch,
  type ConfigCenterPublicPatchResult,
} from './config-center/public-patch'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  type ConfigCenterPublicSnapshotLoadResult,
} from './config-center/public-snapshot'
import {
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
  type CopilotRuntimeLoadResult,
} from './copilot-runtime'

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>

export interface RendererIpcHandlers {
  loadConfigCenterPublicSnapshot: () => Promise<ConfigCenterPublicSnapshotLoadResult>
  applyConfigCenterPublicPatch: (patch: ConfigCenterPublicPatch) => Promise<ConfigCenterPublicPatchResult>
  loadCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  retryCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
}

export function registerRendererIpcHandlers(
  ipcMain: IpcMainLike,
  handlers: RendererIpcHandlers,
): void {
  ipcMain.removeHandler(CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL)
  ipcMain.removeHandler(CONFIG_CENTER_PUBLIC_PATCH_CHANNEL)
  ipcMain.removeHandler(COPILOT_RUNTIME_LOAD_CHANNEL)
  ipcMain.removeHandler(COPILOT_RUNTIME_RETRY_CHANNEL)

  ipcMain.handle(CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL, async (): Promise<ConfigCenterPublicSnapshotLoadResult> => {
    return await handlers.loadConfigCenterPublicSnapshot()
  })

  ipcMain.handle(
    CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
    async (_event, patch: ConfigCenterPublicPatch): Promise<ConfigCenterPublicPatchResult> => {
      return await handlers.applyConfigCenterPublicPatch(patch)
    },
  )

  ipcMain.handle(COPILOT_RUNTIME_LOAD_CHANNEL, async (): Promise<CopilotRuntimeLoadResult> => {
    return await handlers.loadCopilotRuntime()
  })

  ipcMain.handle(COPILOT_RUNTIME_RETRY_CHANNEL, async (): Promise<CopilotRuntimeLoadResult> => {
    return await handlers.retryCopilotRuntime()
  })
}
