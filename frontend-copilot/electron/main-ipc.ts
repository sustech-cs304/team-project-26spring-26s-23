import type { IpcMain } from 'electron'
import type { CopilotRuntimeLoadResult } from './copilot-runtime'
import type { DesktopNotificationRequest } from './desktop-notification'
import type { MainProcessServices } from './main-services'
import { registerRendererIpcHandlers } from './renderer-ipc-registration'

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>

export interface MainProcessRuntimeIpcHandlers {
  loadCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  retryCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  notifyDesktopNotification: (request: DesktopNotificationRequest) => Promise<void>
  notifyBootstrapWindowReady: () => Promise<void>
}

export function registerMainProcessIpcHandlers(
  ipcMain: IpcMainLike,
  options: {
    services: MainProcessServices
  } & MainProcessRuntimeIpcHandlers,
): void {
  const { services, loadCopilotRuntime, retryCopilotRuntime, notifyDesktopNotification, notifyBootstrapWindowReady } = options

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
    loadCopilotRuntime,
    retryCopilotRuntime,
    notifyDesktopNotification,
    notifyBootstrapWindowReady,
  })
}
