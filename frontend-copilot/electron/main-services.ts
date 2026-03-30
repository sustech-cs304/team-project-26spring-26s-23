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
import { UNIFIED_CONFIG_DOMAIN_KEYS } from './config-center/domain-schema'
import {
  createElectronSettingsWorkspaceService,
  type ElectronSettingsWorkspaceService,
} from './settings-workspace/main-process'
import type {
  SettingsWorkspaceClearProviderApiKeyRequest,
  SettingsWorkspaceProviderSecretMutationResult,
  SettingsWorkspaceSaveProviderApiKeyRequest,
  SettingsWorkspaceSaveSustechCasPasswordRequest,
  SettingsWorkspaceSecretsLoadStatusesRequest,
  SettingsWorkspaceSecretsLoadStatusesResult,
  SettingsWorkspaceStateLoadResult,
  SettingsWorkspaceStateSaveResult,
  SettingsWorkspaceSustechCasSecretLoadResult,
  SettingsWorkspaceSustechCasSecretMutationResult,
} from './settings-workspace/ipc'
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
  saveSettingsWorkspaceProviderSecret: (
    request: SettingsWorkspaceSaveProviderApiKeyRequest,
  ) => Promise<SettingsWorkspaceProviderSecretMutationResult>
  clearSettingsWorkspaceProviderSecret: (
    request: SettingsWorkspaceClearProviderApiKeyRequest,
  ) => Promise<SettingsWorkspaceProviderSecretMutationResult>
  saveSettingsWorkspaceSustechCasSecret: (
    request: SettingsWorkspaceSaveSustechCasPasswordRequest,
  ) => Promise<SettingsWorkspaceSustechCasSecretMutationResult>
  clearSettingsWorkspaceSustechCasSecret: () => Promise<SettingsWorkspaceSustechCasSecretMutationResult>
  loadConfiguredHostedRuntimeModel: () => Promise<string | null>
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

  async function loadConfiguredHostedRuntimeModel(): Promise<string | null> {
    const loadResult = await getUnifiedConfigService().loadSnapshot()
    return loadResult.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED].values.model
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
    async saveSettingsWorkspaceProviderSecret(
      request: SettingsWorkspaceSaveProviderApiKeyRequest,
    ): Promise<SettingsWorkspaceProviderSecretMutationResult> {
      return await getSettingsWorkspaceService().saveProviderSecret(request)
    },
    async clearSettingsWorkspaceProviderSecret(
      request: SettingsWorkspaceClearProviderApiKeyRequest,
    ): Promise<SettingsWorkspaceProviderSecretMutationResult> {
      return await getSettingsWorkspaceService().clearProviderSecret(request)
    },
    async saveSettingsWorkspaceSustechCasSecret(
      request: SettingsWorkspaceSaveSustechCasPasswordRequest,
    ): Promise<SettingsWorkspaceSustechCasSecretMutationResult> {
      return await getSettingsWorkspaceService().saveSustechCasSecret(request)
    },
    async clearSettingsWorkspaceSustechCasSecret(): Promise<SettingsWorkspaceSustechCasSecretMutationResult> {
      return await getSettingsWorkspaceService().clearSustechCasSecret()
    },
    loadConfiguredHostedRuntimeModel,
  }
}
