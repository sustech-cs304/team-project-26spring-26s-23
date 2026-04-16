import type {
  CreateMainProcessServicesOptions,
  MainProcessServices,
} from './MainProcessServiceTypes'
import { createMainProcessServiceAccessors } from './MainProcessServiceAccessors'

export function createMainProcessServices(
  options: CreateMainProcessServicesOptions,
): MainProcessServices {
  const accessors = createMainProcessServiceAccessors(options)

  return {
    async loadConfigCenterPublicSnapshot() {
      return await accessors.getUnifiedConfigService().loadPublicSnapshot()
    },
    async applyConfigCenterPublicPatch(patch) {
      return await accessors.getUnifiedConfigService().applyPublicPatch(patch)
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
    async resolveSettingsWorkspaceProviderRoute(request) {
      return await accessors.getSettingsWorkspaceService().resolveProviderRoute(request)
    },
    async listCopilotHistoryThreads() {
      return await accessors.getCopilotHistoryService().listThreads()
    },
    async getCopilotHistoryThreadDetail(threadId) {
      return await accessors.getCopilotHistoryService().getThreadDetail(threadId)
    },
    async getCopilotHistoryRunReplay(runId) {
      return await accessors.getCopilotHistoryService().getRunReplay(runId)
    },
    async renameCopilotHistoryThread(threadId, request) {
      return await accessors.getCopilotHistoryService().renameThread(threadId, request)
    },
    async duplicateCopilotHistoryThread(threadId, request) {
      return await accessors.getCopilotHistoryService().duplicateThread(threadId, request)
    },
    async deleteCopilotHistoryThread(threadId) {
      return await accessors.getCopilotHistoryService().deleteThread(threadId)
    },
    async purgeCopilotHistoryThread(threadId) {
      return await accessors.getCopilotHistoryService().purgeThread(threadId)
    },
    async backupCopilotHistoryDatabase(request) {
      return await accessors.getCopilotHistoryService().backupDatabase(request)
    },
    async restoreCopilotHistoryDatabase(request) {
      return await accessors.getCopilotHistoryService().restoreDatabase(request)
    },
  }
}
