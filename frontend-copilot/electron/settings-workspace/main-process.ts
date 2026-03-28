import type { HostedRuntimePaths } from '../runtime/runtime-paths'
import { createSettingsWorkspacePaths } from './paths'
import { createSettingsWorkspaceStorage } from './service'
import type {
  SettingsWorkspaceClearProviderApiKeyRequest,
  SettingsWorkspaceProviderSecretMutationResult,
  SettingsWorkspaceSaveProviderApiKeyRequest,
  SettingsWorkspaceSecretsLoadStatusesRequest,
  SettingsWorkspaceSecretsLoadStatusesResult,
  SettingsWorkspaceStateLoadResult,
  SettingsWorkspaceStateSaveResult,
} from './ipc'
import type { SettingsWorkspaceStateSaveInput } from './schema'

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
  saveProviderSecret: (
    request: SettingsWorkspaceSaveProviderApiKeyRequest,
  ) => Promise<SettingsWorkspaceProviderSecretMutationResult>
  clearProviderSecret: (
    request: SettingsWorkspaceClearProviderApiKeyRequest,
  ) => Promise<SettingsWorkspaceProviderSecretMutationResult>
}

export function createElectronSettingsWorkspaceService(
  options: CreateElectronSettingsWorkspaceServiceOptions,
): ElectronSettingsWorkspaceService {
  const loadState = async (): Promise<SettingsWorkspaceStateLoadResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.loadState()

      if (result.source === 'initialized-defaults') {
        await options.appendLog?.('info', 'Initialized settings workspace persistence documents.', null)
      }

      return {
        ok: true,
        source: result.source,
        state: result.state,
      }
    } catch (error) {
      return {
        ok: false,
        error: `Failed to load settings workspace state: ${formatUnknownError(error)}`,
      }
    }
  }

  const saveState = async (input: SettingsWorkspaceStateSaveInput): Promise<SettingsWorkspaceStateSaveResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.saveState(input)

      return {
        ok: true,
        state: result.state,
      }
    } catch (error) {
      return {
        ok: false,
        error: `Failed to save settings workspace state: ${formatUnknownError(error)}`,
      }
    }
  }

  const loadSecretStates = async (
    request?: SettingsWorkspaceSecretsLoadStatusesRequest,
  ): Promise<SettingsWorkspaceSecretsLoadStatusesResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.loadSecretStates(request?.providerIds)

      return {
        ok: true,
        states: result.states,
      }
    } catch (error) {
      return {
        ok: false,
        error: `Failed to load settings workspace secret states: ${formatUnknownError(error)}`,
      }
    }
  }

  const saveProviderSecret = async (
    request: SettingsWorkspaceSaveProviderApiKeyRequest,
  ): Promise<SettingsWorkspaceProviderSecretMutationResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.saveProviderSecret(request.providerId, request.apiKey)

      return {
        ok: true,
        providerId: request.providerId,
        state: result.state,
      }
    } catch (error) {
      return {
        ok: false,
        error: `Failed to save settings workspace provider secret: ${formatUnknownError(error)}`,
      }
    }
  }

  const clearProviderSecret = async (
    request: SettingsWorkspaceClearProviderApiKeyRequest,
  ): Promise<SettingsWorkspaceProviderSecretMutationResult> => {
    try {
      const storage = await createStorage(options)
      const result = await storage.clearProviderSecret(request.providerId)

      return {
        ok: true,
        providerId: request.providerId,
        state: result.state,
      }
    } catch (error) {
      return {
        ok: false,
        error: `Failed to clear settings workspace provider secret: ${formatUnknownError(error)}`,
      }
    }
  }

  return {
    loadState,
    saveState,
    loadSecretStates,
    saveProviderSecret,
    clearProviderSecret,
  }
}

async function createStorage(options: CreateElectronSettingsWorkspaceServiceOptions) {
  const paths = await options.prepareRuntimePaths()
  return createSettingsWorkspaceStorage({
    paths: createSettingsWorkspacePaths(paths),
  })
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
