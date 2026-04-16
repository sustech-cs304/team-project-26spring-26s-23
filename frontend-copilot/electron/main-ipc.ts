import type { IpcMain } from 'electron'
import type { CopilotRuntimeLoadResult } from './copilot-runtime'
import type { MainProcessServices } from './main-services'
import { registerRendererIpcHandlers } from './renderer-ipc-registration'

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>

export interface MainProcessRuntimeIpcHandlers {
  loadCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  retryCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  notifyBootstrapWindowReady: () => Promise<void>
}

export function registerMainProcessIpcHandlers(
  ipcMain: IpcMainLike,
  options: {
    services: MainProcessServices
  } & MainProcessRuntimeIpcHandlers,
): void {
  const { services, loadCopilotRuntime, retryCopilotRuntime, notifyBootstrapWindowReady } = options

  registerRendererIpcHandlers(ipcMain, {
    loadConfigCenterPublicSnapshot: services.loadConfigCenterPublicSnapshot,
    applyConfigCenterPublicPatch: services.applyConfigCenterPublicPatch,
    loadSettingsWorkspaceState: services.loadSettingsWorkspaceState,
    saveSettingsWorkspaceState: services.saveSettingsWorkspaceState,
    loadSettingsWorkspaceSecretStates: services.loadSettingsWorkspaceSecretStates,
    loadSettingsWorkspaceSustechCasSecret: services.loadSettingsWorkspaceSustechCasSecret,
    saveSettingsWorkspaceProfileSecret: services.saveSettingsWorkspaceProfileSecret,
    clearSettingsWorkspaceProfileSecret: services.clearSettingsWorkspaceProfileSecret,
    saveSettingsWorkspaceSustechCasSecret: services.saveSettingsWorkspaceSustechCasSecret,
    clearSettingsWorkspaceSustechCasSecret: services.clearSettingsWorkspaceSustechCasSecret,
    listCopilotHistoryThreads: services.listCopilotHistoryThreads,
    getCopilotHistoryThreadDetail: services.getCopilotHistoryThreadDetail,
    getCopilotHistoryRunReplay: services.getCopilotHistoryRunReplay,
    renameCopilotHistoryThread: services.renameCopilotHistoryThread,
    duplicateCopilotHistoryThread: services.duplicateCopilotHistoryThread,
    deleteCopilotHistoryThread: services.deleteCopilotHistoryThread,
    backupCopilotHistoryDatabase: services.backupCopilotHistoryDatabase,
    restoreCopilotHistoryDatabase: services.restoreCopilotHistoryDatabase,
    loadCopilotRuntime,
    retryCopilotRuntime,
    notifyBootstrapWindowReady,
  })
}
