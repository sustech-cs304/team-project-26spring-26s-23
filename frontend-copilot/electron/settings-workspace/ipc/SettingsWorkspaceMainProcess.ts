import type { HostedRuntimePaths } from '../../runtime/runtime-paths'
import { createSettingsWorkspacePaths } from '../paths'
import type {
  SettingsWorkspaceProviderRouteResolveRequest,
  SettingsWorkspaceProviderRouteResolveResult,
} from '../provider-route-resolver'
import { createSettingsWorkspaceStorage } from '../service'
import type {
  SettingsWorkspaceClearProfileApiKeyRequest,
  SettingsWorkspaceProfileSecretMutationResult,
  SettingsWorkspaceSaveProfileApiKeyRequest,
  SettingsWorkspaceSaveSustechCasPasswordRequest,
  SettingsWorkspaceSustechCasSecretLoadResult,
  SettingsWorkspaceSustechCasSecretMutationResult,
  SettingsWorkspaceSecretsLoadStatusesRequest,
  SettingsWorkspaceSecretsLoadStatusesResult,
  SettingsWorkspaceStateLoadResult,
  SettingsWorkspaceStateSaveResult,
} from '../ipc'
import {
  createSettingsWorkspaceSnapshotSubscription,
} from '../subscriptions/SettingsWorkspaceSnapshotSubscription'
import type { SettingsWorkspaceStateSaveInput } from '../state-schema'

export interface ElectronSettingsWorkspaceLogger {
  (
    level: 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown> | null,
  ): void | Promise<void>
}

export interface CreateElectronSettingsWorkspaceServiceOptions {
  prepareRuntimePaths: () => Promise<HostedRuntimePaths>
  appendLog?: ElectronSettingsWorkspaceLogger
}

export interface ElectronSettingsWorkspaceService {
  loadState: () => Promise<SettingsWorkspaceStateLoadResult>
  saveState: (input: SettingsWorkspaceStateSaveInput) => Promise<SettingsWorkspaceStateSaveResult>
  loadSecretStates: (
    request?: SettingsWorkspaceSecretsLoadStatusesRequest,
  ) => Promise<SettingsWorkspaceSecretsLoadStatusesResult>
  loadSustechCasSecret: () => Promise<SettingsWorkspaceSustechCasSecretLoadResult>
  saveProfileSecret: (
    request: SettingsWorkspaceSaveProfileApiKeyRequest,
  ) => Promise<SettingsWorkspaceProfileSecretMutationResult>
  clearProfileSecret: (
    request: SettingsWorkspaceClearProfileApiKeyRequest,
  ) => Promise<SettingsWorkspaceProfileSecretMutationResult>
  saveSustechCasSecret: (
    request: SettingsWorkspaceSaveSustechCasPasswordRequest,
  ) => Promise<SettingsWorkspaceSustechCasSecretMutationResult>
  clearSustechCasSecret: () => Promise<SettingsWorkspaceSustechCasSecretMutationResult>
  resolveProviderRoute: (
    request: SettingsWorkspaceProviderRouteResolveRequest,
  ) => Promise<SettingsWorkspaceProviderRouteResolveResult>
}

export function createElectronSettingsWorkspaceService(
  options: CreateElectronSettingsWorkspaceServiceOptions,
): ElectronSettingsWorkspaceService {
  const snapshotSubscription = createSettingsWorkspaceSnapshotSubscription()

  const loadState = async (): Promise<SettingsWorkspaceStateLoadResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.loadState()

      if (result.source === 'initialized-defaults') {
        await options.appendLog?.('info', 'Initialized settings workspace persistence documents.', null)
      }

      return { ok: true, source: result.source, state: result.state }
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'load settings workspace state') }
    }
  }

  const saveState = async (input: SettingsWorkspaceStateSaveInput): Promise<SettingsWorkspaceStateSaveResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.saveState(input)
      await snapshotSubscription.publishStateSnapshot(result.state)
      return { ok: true, state: result.state }
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'save settings workspace state') }
    }
  }

  const loadSecretStates = async (
    request?: SettingsWorkspaceSecretsLoadStatusesRequest,
  ): Promise<SettingsWorkspaceSecretsLoadStatusesResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.loadSecretStates(request?.profileIds)
      return { ok: true, states: result.states }
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'load settings workspace secret states') }
    }
  }

  const loadSustechCasSecret = async (): Promise<SettingsWorkspaceSustechCasSecretLoadResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.loadSustechCasSecret()
      return { ok: true, state: result.state }
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'load settings workspace sustech CAS secret') }
    }
  }

  const saveProfileSecret = async (
    request: SettingsWorkspaceSaveProfileApiKeyRequest,
  ): Promise<SettingsWorkspaceProfileSecretMutationResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.saveProfileSecret(request.profileId, request.apiKey)
      await snapshotSubscription.publishProfileSecretSnapshot(request.profileId, result.state)
      return { ok: true, profileId: request.profileId, state: result.state }
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'save settings workspace profile secret') }
    }
  }

  const clearProfileSecret = async (
    request: SettingsWorkspaceClearProfileApiKeyRequest,
  ): Promise<SettingsWorkspaceProfileSecretMutationResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.clearProfileSecret(request.profileId)
      await snapshotSubscription.publishProfileSecretSnapshot(request.profileId, result.state)
      return { ok: true, profileId: request.profileId, state: result.state }
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'clear settings workspace profile secret') }
    }
  }

  const saveSustechCasSecret = async (
    request: SettingsWorkspaceSaveSustechCasPasswordRequest,
  ): Promise<SettingsWorkspaceSustechCasSecretMutationResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.saveSustechCasSecret(request.password)
      await snapshotSubscription.publishSustechCasSecretSnapshot(result.state)
      return { ok: true, state: result.state }
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'save settings workspace sustech CAS secret') }
    }
  }

  const clearSustechCasSecret = async (): Promise<SettingsWorkspaceSustechCasSecretMutationResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.clearSustechCasSecret()
      await snapshotSubscription.publishSustechCasSecretSnapshot(result.state)
      return { ok: true, state: result.state }
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'clear settings workspace sustech CAS secret') }
    }
  }

  const resolveProviderRoute = async (
    request: SettingsWorkspaceProviderRouteResolveRequest,
  ): Promise<SettingsWorkspaceProviderRouteResolveResult> => {
    const storage = await createStorage(options)
    return await storage.resolveProviderRoute(request)
  }

  return {
    loadState, saveState, loadSecretStates, loadSustechCasSecret,
    saveProfileSecret, clearProfileSecret, saveSustechCasSecret, clearSustechCasSecret,
    resolveProviderRoute,
  }
}

async function createStorage(options: CreateElectronSettingsWorkspaceServiceOptions) {
  const paths = await options.prepareRuntimePaths()
  return createSettingsWorkspaceStorage({ paths: createSettingsWorkspacePaths(paths) })
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function errorMessage(error: unknown, context: string): string {
  return `Failed to ${context}: ${formatUnknownError(error)}`
}
