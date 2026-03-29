import type { IpcMain } from 'electron'
import type { CopilotRuntimeLoadResult } from './copilot-runtime'
import type { MainProcessServices } from './main-services'
import { registerRendererIpcHandlers } from './renderer-ipc'

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
    saveSettingsWorkspaceProviderSecret: services.saveSettingsWorkspaceProviderSecret,
    clearSettingsWorkspaceProviderSecret: services.clearSettingsWorkspaceProviderSecret,
    saveSettingsWorkspaceSustechCasSecret: services.saveSettingsWorkspaceSustechCasSecret,
    clearSettingsWorkspaceSustechCasSecret: services.clearSettingsWorkspaceSustechCasSecret,
    loadCopilotRuntime,
    retryCopilotRuntime,
    notifyBootstrapWindowReady,
  })
}
