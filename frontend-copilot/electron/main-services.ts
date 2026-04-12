import type {
  ConfigCenterPublicPatch,
  ConfigCenterPublicPatchResult,
} from './config-center/public-patch'
import type {
  ConfigCenterPublicSnapshot,
  ConfigCenterPublicSnapshotLoadResult,
} from './config-center/public-snapshot'
import {
  createElectronUnifiedConfigService,
  type ElectronUnifiedConfigService,
} from './config-center/main-process'
import {
  createElectronSettingsWorkspaceService,
  type ElectronSettingsWorkspaceService,
} from './settings-workspace/main-process'
import type {
  SettingsWorkspaceClearProfileApiKeyRequest,
  SettingsWorkspaceProfileSecretMutationResult,
  SettingsWorkspaceSaveProfileApiKeyRequest,
  SettingsWorkspaceSaveSustechCasPasswordRequest,
  SettingsWorkspaceSecretsLoadStatusesRequest,
  SettingsWorkspaceSecretsLoadStatusesResult,
  SettingsWorkspaceStateLoadResult,
  SettingsWorkspaceStateSaveResult,
  SettingsWorkspaceSustechCasSecretLoadResult,
  SettingsWorkspaceSustechCasSecretMutationResult,
} from './settings-workspace/ipc'
import type { SettingsWorkspaceProviderRouteResolveRequest, SettingsWorkspaceProviderRouteResolveResult } from './settings-workspace/provider-route-resolver'
import type { SettingsWorkspaceStateSaveInput } from './settings-workspace/state-schema'
import type { HostedRuntimePaths } from './runtime/runtime-paths'

type MainProcessServiceLogLevel = 'info' | 'warn' | 'error'

export interface CreateMainProcessServicesOptions {
  prepareRuntimePaths: () => Promise<HostedRuntimePaths>
  appendMainRuntimeLog: (
    level: MainProcessServiceLogLevel,
    message: string,
    context: Record<string, unknown> | null,
  ) => void | Promise<void>
  publishConfigCenterPublicSnapshotUpdate: (
    snapshot: ConfigCenterPublicSnapshot,
  ) => void | Promise<void>
}

export interface MainProcessServices {
  loadConfigCenterPublicSnapshot: () => Promise<ConfigCenterPublicSnapshotLoadResult>
  applyConfigCenterPublicPatch: (patch: ConfigCenterPublicPatch) => Promise<ConfigCenterPublicPatchResult>
  loadSettingsWorkspaceState: () => Promise<SettingsWorkspaceStateLoadResult>
  saveSettingsWorkspaceState: (input: SettingsWorkspaceStateSaveInput) => Promise<SettingsWorkspaceStateSaveResult>
  loadSettingsWorkspaceSecretStates: (
    request?: SettingsWorkspaceSecretsLoadStatusesRequest,
  ) => Promise<SettingsWorkspaceSecretsLoadStatusesResult>
  loadSettingsWorkspaceSustechCasSecret: () => Promise<SettingsWorkspaceSustechCasSecretLoadResult>
  saveSettingsWorkspaceProfileSecret: (
    request: SettingsWorkspaceSaveProfileApiKeyRequest,
  ) => Promise<SettingsWorkspaceProfileSecretMutationResult>
  clearSettingsWorkspaceProfileSecret: (
    request: SettingsWorkspaceClearProfileApiKeyRequest,
  ) => Promise<SettingsWorkspaceProfileSecretMutationResult>
  saveSettingsWorkspaceSustechCasSecret: (
    request: SettingsWorkspaceSaveSustechCasPasswordRequest,
  ) => Promise<SettingsWorkspaceSustechCasSecretMutationResult>
  clearSettingsWorkspaceSustechCasSecret: () => Promise<SettingsWorkspaceSustechCasSecretMutationResult>
  resolveSettingsWorkspaceProviderRoute: (
    request: SettingsWorkspaceProviderRouteResolveRequest,
  ) => Promise<SettingsWorkspaceProviderRouteResolveResult>
}

export function createMainProcessServices(
  options: CreateMainProcessServicesOptions,
): MainProcessServices {
  let unifiedConfigService: ElectronUnifiedConfigService | null = null
  let settingsWorkspaceService: ElectronSettingsWorkspaceService | null = null

  function getUnifiedConfigService(): ElectronUnifiedConfigService {
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
  }

  function getSettingsWorkspaceService(): ElectronSettingsWorkspaceService {
    settingsWorkspaceService ??= createElectronSettingsWorkspaceService({
      prepareRuntimePaths: options.prepareRuntimePaths,
      appendLog(level, message, context) {
        return options.appendMainRuntimeLog(level, message, context)
      },
    })

    return settingsWorkspaceService
  }

  return {
    async loadConfigCenterPublicSnapshot(): Promise<ConfigCenterPublicSnapshotLoadResult> {
      return await getUnifiedConfigService().loadPublicSnapshot()
    },
    async applyConfigCenterPublicPatch(
      patch: ConfigCenterPublicPatch,
    ): Promise<ConfigCenterPublicPatchResult> {
      return await getUnifiedConfigService().applyPublicPatch(patch)
    },
    async loadSettingsWorkspaceState(): Promise<SettingsWorkspaceStateLoadResult> {
      return await getSettingsWorkspaceService().loadState()
    },
    async saveSettingsWorkspaceState(
      input: SettingsWorkspaceStateSaveInput,
    ): Promise<SettingsWorkspaceStateSaveResult> {
      return await getSettingsWorkspaceService().saveState(input)
    },
    async loadSettingsWorkspaceSecretStates(
      request?: SettingsWorkspaceSecretsLoadStatusesRequest,
    ): Promise<SettingsWorkspaceSecretsLoadStatusesResult> {
      return await getSettingsWorkspaceService().loadSecretStates(request)
    },
    async loadSettingsWorkspaceSustechCasSecret(): Promise<SettingsWorkspaceSustechCasSecretLoadResult> {
      return await getSettingsWorkspaceService().loadSustechCasSecret()
    },
    async saveSettingsWorkspaceProfileSecret(
      request: SettingsWorkspaceSaveProfileApiKeyRequest,
    ): Promise<SettingsWorkspaceProfileSecretMutationResult> {
      return await getSettingsWorkspaceService().saveProfileSecret(request)
    },
    async clearSettingsWorkspaceProfileSecret(
      request: SettingsWorkspaceClearProfileApiKeyRequest,
    ): Promise<SettingsWorkspaceProfileSecretMutationResult> {
      return await getSettingsWorkspaceService().clearProfileSecret(request)
    },
    async saveSettingsWorkspaceSustechCasSecret(
      request: SettingsWorkspaceSaveSustechCasPasswordRequest,
    ): Promise<SettingsWorkspaceSustechCasSecretMutationResult> {
      return await getSettingsWorkspaceService().saveSustechCasSecret(request)
    },
    async clearSettingsWorkspaceSustechCasSecret(): Promise<SettingsWorkspaceSustechCasSecretMutationResult> {
      return await getSettingsWorkspaceService().clearSustechCasSecret()
    },
    async resolveSettingsWorkspaceProviderRoute(
      request: SettingsWorkspaceProviderRouteResolveRequest,
    ): Promise<SettingsWorkspaceProviderRouteResolveResult> {
      return await getSettingsWorkspaceService().resolveProviderRoute(request)
    },
  }
}
