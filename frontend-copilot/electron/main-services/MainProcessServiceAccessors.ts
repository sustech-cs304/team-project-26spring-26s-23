import {
  createElectronUnifiedConfigService,
  type ElectronUnifiedConfigService,
} from '../config-center/main-process'
import {
  createElectronSettingsWorkspaceService,
  type ElectronSettingsWorkspaceService,
} from '../settings-workspace/main-process'
import type { CreateMainProcessServicesOptions } from './MainProcessServiceTypes'

export interface MainProcessServiceAccessors {
  getUnifiedConfigService: () => ElectronUnifiedConfigService
  getSettingsWorkspaceService: () => ElectronSettingsWorkspaceService
}

export function createMainProcessServiceAccessors(
  options: CreateMainProcessServicesOptions,
): MainProcessServiceAccessors {
  let unifiedConfigService: ElectronUnifiedConfigService | null = null
  let settingsWorkspaceService: ElectronSettingsWorkspaceService | null = null

  return {
    getUnifiedConfigService(): ElectronUnifiedConfigService {
      unifiedConfigService ??= createElectronUnifiedConfigService({
        prepareRuntimePaths: options.prepareRuntimePaths,
        appendLog(level, message, context) {
          return options.appendMainRuntimeLog(level, message, context)
        },
        publishPublicSnapshotUpdate(snapshot) {
          return options.publishConfigCenterPublicSnapshotUpdate(snapshot)
        },
      })

      return unifiedConfigService
    },
    getSettingsWorkspaceService(): ElectronSettingsWorkspaceService {
      settingsWorkspaceService ??= createElectronSettingsWorkspaceService({
        prepareRuntimePaths: options.prepareRuntimePaths,
        appendLog(level, message, context) {
          return options.appendMainRuntimeLog(level, message, context)
        },
      })

      return settingsWorkspaceService
    },
  }
}
