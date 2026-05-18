import {
  createElectronDesktopCapabilityBridgeService,
  type ElectronDesktopCapabilityBridgeService,
} from '../capability-bridge/main-process'
import {
  createElectronUnifiedConfigService,
  type ElectronUnifiedConfigService,
} from '../config-center/main-process'
import {
  createElectronSettingsWorkspaceService,
  type ElectronSettingsWorkspaceService,
} from '../settings-workspace/main-process'
import {
  createElectronToolCatalogService,
  type ElectronToolCatalogService,
} from '../tool-catalog/service'
import {
  createElectronMcpRegistryService,
  type ElectronMcpRegistryService,
} from '../mcp-registry/main-process'
import {
  createElectronSkillRegistryService,
  type ElectronSkillRegistryService,
} from '../skill-registry/main-process'
import {
  createElectronManagedRuntimeService,
  type ElectronManagedRuntimeService,
} from '../managed-runtime/main-process'
import type {
  CreateMainProcessServicesOptions,
  MainProcessServiceLogLevel,
  MainProcessServiceLogOptions,
} from './MainProcessServiceTypes'

export interface MainProcessServiceAccessors {
  getUnifiedConfigService: () => ElectronUnifiedConfigService
  getSettingsWorkspaceService: () => ElectronSettingsWorkspaceService
  getDesktopCapabilityBridgeService: () => ElectronDesktopCapabilityBridgeService
  getMcpRegistryService: () => ElectronMcpRegistryService
  getSkillRegistryService: () => ElectronSkillRegistryService
  getManagedRuntimeService: () => ElectronManagedRuntimeService
  getToolCatalogService: () => ElectronToolCatalogService
}

export function createMainProcessServiceAccessors(
  options: CreateMainProcessServicesOptions,
): MainProcessServiceAccessors {
  let unifiedConfigService: ElectronUnifiedConfigService | null = null
  let settingsWorkspaceService: ElectronSettingsWorkspaceService | null = null
  let desktopCapabilityBridgeService: ElectronDesktopCapabilityBridgeService | null = null
  let toolCatalogService: ElectronToolCatalogService | null = null
  let mcpRegistryService: ElectronMcpRegistryService | null = null
  let skillRegistryService: ElectronSkillRegistryService | null = null
  let managedRuntimeService: ElectronManagedRuntimeService | null = null

  const forwardServiceLog = (
    level: MainProcessServiceLogLevel,
    message: string,
    context: Record<string, unknown> | null,
  ): void | Promise<void> => {
    return options.appendMainRuntimeLog(level, message, context)
  }

  const forwardCapabilityLog = (
    level: MainProcessServiceLogLevel,
    message: string,
    context: Record<string, unknown> | null,
    logOptions?: MainProcessServiceLogOptions,
  ): void | Promise<void> => {
    if (logOptions === undefined) {
      return options.appendMainRuntimeLog(level, message, context)
    }

    return options.appendMainRuntimeLog(level, message, context, logOptions)
  }

  const getSettingsWorkspaceService = (): ElectronSettingsWorkspaceService => {
    settingsWorkspaceService ??= createElectronSettingsWorkspaceService({
      prepareRuntimePaths: options.prepareRuntimePaths,
      appendLog(level, message, context) {
        return forwardServiceLog(level, message, context)
      },
    })

    return settingsWorkspaceService
  }

  return {
    getUnifiedConfigService(): ElectronUnifiedConfigService {
      unifiedConfigService ??= createElectronUnifiedConfigService({
        prepareRuntimePaths: options.prepareRuntimePaths,
        ensureHostedBackendService: options.ensureHostedBackendService,
        appendLog(level, message, context) {
          return forwardServiceLog(level, message, context)
        },
        publishPublicSnapshotUpdate(snapshot) {
          return options.publishConfigCenterPublicSnapshotUpdate(snapshot)
        },
      })

      return unifiedConfigService
    },
    getSettingsWorkspaceService,
    getDesktopCapabilityBridgeService(): ElectronDesktopCapabilityBridgeService {
      desktopCapabilityBridgeService ??= createElectronDesktopCapabilityBridgeService({
        prepareRuntimePaths: options.prepareRuntimePaths,
        appendLog(level, message, context, logOptions) {
          return forwardCapabilityLog(level, message, context, logOptions)
        },
        getSettingsWorkspaceService,
        getMcpRegistryService: () => this.getMcpRegistryService(),
      })

      return desktopCapabilityBridgeService
    },
    getMcpRegistryService(): ElectronMcpRegistryService {
      mcpRegistryService ??= createElectronMcpRegistryService({
        prepareRuntimePaths: options.prepareRuntimePaths,
        appendLog(level, message, context) {
          return forwardServiceLog(level, message, context)
        },
        publishRegistryEvent(event) {
          return options.publishMcpRegistryEvent(event)
        },
      })

      return mcpRegistryService
    },
    getSkillRegistryService(): ElectronSkillRegistryService {
      skillRegistryService ??= createElectronSkillRegistryService({
        prepareRuntimePaths: options.prepareRuntimePaths,
        appendLog(level, message, context) {
          return forwardServiceLog(level, message, context)
        },
        publishRegistryEvent(event) {
          return options.publishSkillRegistryEvent(event)
        },
      })

      return skillRegistryService
    },
    getManagedRuntimeService(): ElectronManagedRuntimeService {
      managedRuntimeService ??= createElectronManagedRuntimeService({
        prepareRuntimePaths: options.prepareRuntimePaths,
        userDataPath: options.userDataPath,
        appendLog(level, message, context) {
          return forwardServiceLog(level, message, context)
        },
      })

      return managedRuntimeService
    },
    getToolCatalogService(): ElectronToolCatalogService {
      toolCatalogService ??= createElectronToolCatalogService({
        ensureHostedBackendService: async () => this.getUnifiedConfigService().getHostedBackendService(),
        getLocalToken: async () => {
          const service = await this.getUnifiedConfigService().getHostedBackendService()
          return service.getLocalToken()
        },
        loadConfigCenterPublicSnapshot: async () => {
          const result = await this.getUnifiedConfigService().loadPublicSnapshot()
          return result.ok ? result.snapshot : null
        },
      })
      return toolCatalogService
    },
  }
}
