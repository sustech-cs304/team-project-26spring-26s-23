import type {
  CreateMainProcessServicesOptions,
  MainProcessServices,
} from './MainProcessServiceTypes'
import {
  createEmptyMcpRegistryLoadSuccess,
  createMcpRegistryApiFailure,
} from '../mcp-registry/ipc'
import { createMainProcessServiceAccessors } from './MainProcessServiceAccessors'

export function createMainProcessServices(
  options: CreateMainProcessServicesOptions,
): MainProcessServices {
  const accessors = createMainProcessServiceAccessors(options)
  const copilotHistoryService = options.createCopilotHistoryService()
  const createMcpNotImplementedFailure = () => {
    return createMcpRegistryApiFailure('MCP registry service is intentionally left as a P0 contract stub.')
  }

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
    async loadMcpRegistry() {
      return createEmptyMcpRegistryLoadSuccess()
    },
    async saveMcpServer() {
      return createMcpNotImplementedFailure()
    },
    async deleteMcpServer() {
      return createMcpNotImplementedFailure()
    },
    async setMcpServerEnabled() {
      return createMcpNotImplementedFailure()
    },
    async testMcpConnection() {
      return createMcpNotImplementedFailure()
    },
    async refreshMcpCatalog() {
      return createMcpNotImplementedFailure()
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
  }
}
