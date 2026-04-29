import type { IpcMain } from 'electron'
import type { CopilotRuntimeLoadResult } from './copilot-runtime'
import type { DesktopNotificationRequest } from './desktop-notification'
import type { MainProcessServices } from './main-services'
import { registerRendererIpcHandlers } from './renderer-ipc-registration'
import type { DesktopWindowState } from './window-controls'

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>

export interface MainProcessRuntimeIpcHandlers {
  loadCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  retryCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  notifyDesktopNotification: (request: DesktopNotificationRequest) => Promise<void>
  loadDesktopWindowState: () => Promise<DesktopWindowState>
  minimizeDesktopWindow: () => Promise<void>
  toggleMaximizeDesktopWindow: () => Promise<DesktopWindowState>
  closeDesktopWindow: () => Promise<void>
  notifyBootstrapWindowReady: () => Promise<void>
}

export function registerMainProcessIpcHandlers(
  ipcMain: IpcMainLike,
  options: {
    services: MainProcessServices
  } & MainProcessRuntimeIpcHandlers,
): void {
  const {
    services,
    loadCopilotRuntime,
    retryCopilotRuntime,
    notifyDesktopNotification,
    loadDesktopWindowState,
    minimizeDesktopWindow,
    toggleMaximizeDesktopWindow,
    closeDesktopWindow,
    notifyBootstrapWindowReady,
  } = options

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
    loadMcpRegistry: services.loadMcpRegistry,
    loadSkillRegistry: services.loadSkillRegistry,
    importSkill: services.importSkill,
    selectAndImportSkill: services.selectAndImportSkill,
    deleteSkill: services.deleteSkill,
    setSkillEnabled: services.setSkillEnabled,
    refreshSkills: services.refreshSkills,
    loadManagedRuntime: services.loadManagedRuntime,
    installOrRepairManagedRuntime: services.installOrRepairManagedRuntime,
    saveMcpServer: services.saveMcpServer,
    deleteMcpServer: services.deleteMcpServer,
    setMcpServerEnabled: services.setMcpServerEnabled,
    testMcpConnection: services.testMcpConnection,
    refreshMcpCatalog: services.refreshMcpCatalog,
    listCopilotHistoryThreads: services.listCopilotHistoryThreads,
    getCopilotHistoryThreadDetail: services.getCopilotHistoryThreadDetail,
    getCopilotHistoryRunReplay: services.getCopilotHistoryRunReplay,
    renameCopilotHistoryThread: services.renameCopilotHistoryThread,
    duplicateCopilotHistoryThread: services.duplicateCopilotHistoryThread,
    deleteCopilotHistoryThread: services.deleteCopilotHistoryThread,
    backupCopilotHistoryDatabase: services.backupCopilotHistoryDatabase,
    restoreCopilotHistoryDatabase: services.restoreCopilotHistoryDatabase,
    loadToolCatalog: services.loadToolCatalog,
    loadCopilotRuntime,
    retryCopilotRuntime,
    selectRootDirectory: services.selectRootDirectory,
    listDirectory: services.listDirectory,
    probeDirectory: services.probeDirectory,
    createDirectory: services.createDirectory,
    copyEntries: services.copyEntries,
    moveEntries: services.moveEntries,
    renameEntry: services.renameEntry,
    trashEntries: services.trashEntries,
    deleteEntriesPermanently: services.deleteEntriesPermanently,
    watchDirectories: services.watchDirectories,
    unwatchDirectories: services.unwatchDirectories,
    loadLastRootDirectory: services.loadLastRootDirectory,
    saveLastRootDirectory: services.saveLastRootDirectory,
    clearLastRootDirectory: services.clearLastRootDirectory,
    openEntryWithSystem: services.openEntryWithSystem,
    revealEntryInFolder: services.revealEntryInFolder,
    copyTextToClipboard: services.copyTextToClipboard,
    notifyDesktopNotification,
    loadDesktopWindowState,
    minimizeDesktopWindow,
    toggleMaximizeDesktopWindow,
    closeDesktopWindow,
    notifyBootstrapWindowReady,
  })
}
