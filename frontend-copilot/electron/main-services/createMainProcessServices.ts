import type {
  CreateMainProcessServicesOptions,
  MainProcessServices,
} from './MainProcessServiceTypes'
import { createMainProcessServiceAccessors } from './MainProcessServiceAccessors'
import type { ManagedRuntimeActionReason } from '../managed-runtime/types'
import { createElectronFileManagerService } from '../file-manager/service'

export function createMainProcessServices(
  options: CreateMainProcessServicesOptions,
): MainProcessServices {
  const accessors = createMainProcessServiceAccessors(options)
  const copilotHistoryService = options.createCopilotHistoryService()
  const fileManagerService = createElectronFileManagerService({
    getMainWindow: options.getMainWindow,
    userDataPath: options.userDataPath,
    appendLog(level, message, context) {
      return options.appendMainRuntimeLog(level, `[file-manager] ${message}`, context ?? null)
    },
  })

  return {
    async loadConfigCenterPublicSnapshot() {
      return await accessors.getUnifiedConfigService().loadPublicSnapshot()
    },
    async applyConfigCenterPublicPatch(patch) {
      return await accessors.getUnifiedConfigService().applyPublicPatch(patch)
    },
    async loadToolCatalog() {
      return await accessors.getToolCatalogService().load()
    },
    async loadSettingsWorkspaceState() {
      return await accessors.getSettingsWorkspaceService().loadState()
    },
    async saveSettingsWorkspaceState(input) {
      return await accessors.getSettingsWorkspaceService().saveState(input)
    },
    async loadSettingsWorkspaceSecretStates(request) {
      return await accessors.getSettingsWorkspaceService().loadSecretStates(request)
    },
    async loadSettingsWorkspaceSustechCasSecret() {
      return await accessors.getSettingsWorkspaceService().loadSustechCasSecret()
    },
    async saveSettingsWorkspaceProfileSecret(request) {
      return await accessors.getSettingsWorkspaceService().saveProfileSecret(request)
    },
    async clearSettingsWorkspaceProfileSecret(request) {
      return await accessors.getSettingsWorkspaceService().clearProfileSecret(request)
    },
    async saveSettingsWorkspaceSustechCasSecret(request) {
      return await accessors.getSettingsWorkspaceService().saveSustechCasSecret(request)
    },
    async clearSettingsWorkspaceSustechCasSecret() {
      return await accessors.getSettingsWorkspaceService().clearSustechCasSecret()
    },
    async loadMcpRegistry(request) {
      return await accessors.getMcpRegistryService().loadRegistry(request)
    },
    async loadSkillRegistry(request) {
      return await accessors.getSkillRegistryService().loadRegistry(request)
    },
    async importSkill(request) {
      return await accessors.getSkillRegistryService().importSkill(request)
    },
    async selectAndImportSkill() {
      return await accessors.getSkillRegistryService().selectAndImportSkill()
    },
    async deleteSkill(skillId) {
      return await accessors.getSkillRegistryService().deleteSkill(skillId)
    },
    async setSkillEnabled(request) {
      return await accessors.getSkillRegistryService().setSkillEnabled(request)
    },
    async refreshSkills(request) {
      return await accessors.getSkillRegistryService().refreshSkills(request)
    },
    async loadManagedRuntime() {
      return await accessors.getManagedRuntimeService().load()
    },
    async installOrRepairManagedRuntime(reason?: ManagedRuntimeActionReason) {
      return await accessors.getManagedRuntimeService().installOrRepair(reason)
    },
    async saveMcpServer(draft) {
      return await accessors.getMcpRegistryService().saveServer(draft)
    },
    async deleteMcpServer(serverId) {
      return await accessors.getMcpRegistryService().deleteServer(serverId)
    },
    async setMcpServerEnabled(request) {
      return await accessors.getMcpRegistryService().setServerEnabled(request)
    },
    async testMcpConnection(request) {
      return await accessors.getMcpRegistryService().testConnection(request)
    },
    async refreshMcpCatalog(request) {
      return await accessors.getMcpRegistryService().refreshCatalog(request)
    },
    async warmupEnabledMcpServersOnStartup() {
      await accessors.getMcpRegistryService().warmupEnabledServersOnStartup()
    },
    async listCopilotHistoryThreads() {
      return await copilotHistoryService.listThreads()
    },
    async getCopilotHistoryThreadDetail(threadId) {
      return await copilotHistoryService.getThreadDetail(threadId)
    },
    async getCopilotHistoryRunReplay(runId) {
      return await copilotHistoryService.getRunReplay(runId)
    },
    async renameCopilotHistoryThread(threadId, request) {
      return await copilotHistoryService.renameThread(threadId, request)
    },
    async duplicateCopilotHistoryThread(threadId, request) {
      return await copilotHistoryService.duplicateThread(threadId, request)
    },
    async deleteCopilotHistoryThread(threadId) {
      return await copilotHistoryService.deleteThread(threadId)
    },
    async backupCopilotHistoryDatabase(request) {
      return await copilotHistoryService.backupDatabase(request)
    },
    async restoreCopilotHistoryDatabase(request) {
      return await copilotHistoryService.restoreDatabase(request)
    },
    async resolveSettingsWorkspaceProviderRoute(request) {
      return await accessors.getSettingsWorkspaceService().resolveProviderRoute(request)
    },
    async handleDesktopCapabilityBridgeRequest(request) {
      return await accessors.getDesktopCapabilityBridgeService().handleRequest(request)
    },
    async selectRootDirectory() {
      return await fileManagerService.selectRootDirectory()
    },
    async listDirectory(request) {
      return await fileManagerService.listDirectory(request)
    },
    async probeDirectory(request) {
      return await fileManagerService.probeDirectory(request)
    },
    async createDirectory(request) {
      return await fileManagerService.createDirectory(request)
    },
    async copyEntries(request) {
      return await fileManagerService.copyEntries(request)
    },
    async moveEntries(request) {
      return await fileManagerService.moveEntries(request)
    },
    async renameEntry(request) {
      return await fileManagerService.renameEntry(request)
    },
    async trashEntries(request) {
      return await fileManagerService.trashEntries(request)
    },
    async deleteEntriesPermanently(request) {
      return await fileManagerService.deleteEntriesPermanently(request)
    },
    async watchDirectories(request) {
      return await fileManagerService.watchDirectories(request)
    },
    async unwatchDirectories(request) {
      return await fileManagerService.unwatchDirectories(request)
    },
    async loadLastRootDirectory() {
      return await fileManagerService.loadLastRootDirectory()
    },
    async saveLastRootDirectory(request) {
      return await fileManagerService.saveLastRootDirectory(request)
    },
    async clearLastRootDirectory() {
      return await fileManagerService.clearLastRootDirectory()
    },
    async openEntryWithSystem(request) {
      return await fileManagerService.openEntryWithSystem(request)
    },
    async revealEntryInFolder(request) {
      return await fileManagerService.revealEntryInFolder(request)
    },
    async copyTextToClipboard(request) {
      return await fileManagerService.copyTextToClipboard(request)
    },
  }
}
