import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { DesktopCapabilityBridgeError } from '../errors'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'
import {
  createElectronSettingsWorkspaceService,
  type ElectronSettingsWorkspaceService,
} from '../../settings-workspace/main-process'

export interface DesktopCapabilitySecretService {
  handle(request: DesktopCapabilityBridgeRequest): Promise<Record<string, unknown>>
}

export interface CreateDesktopCapabilitySecretServiceOptions extends CreateDesktopCapabilityBridgeServiceOptions {
  getSettingsWorkspaceService?: () => ElectronSettingsWorkspaceService
}

const PROVIDER_API_KEY_SECRET_NAME_PATTERN = /^provider\.(.+)\.apiKey$/
const USERNAME_SECRET_NAMES = new Set([
  'bb.username',
  'blackboard.username',
  'tis.username',
  'sustech.username',
])
const PASSWORD_SECRET_NAMES = new Set([
  'bb.password',
  'blackboard.password',
  'tis.password',
  'sustech.password',
  'sustech.casPassword',
])

export function createDesktopCapabilitySecretService(
  options: CreateDesktopCapabilitySecretServiceOptions,
): DesktopCapabilitySecretService {
  let settingsWorkspaceService: ElectronSettingsWorkspaceService | null = null

  function getSettingsWorkspaceService(): ElectronSettingsWorkspaceService {
    settingsWorkspaceService ??= options.getSettingsWorkspaceService?.() ?? createElectronSettingsWorkspaceService({
      prepareRuntimePaths: options.prepareRuntimePaths,
      appendLog: options.appendLog,
    })

    return settingsWorkspaceService
  }

  return {
    async handle(request) {
      switch (request.operation) {
        case 'get_secret': {
          return {
            value: await resolveSecretValue(getSettingsWorkspaceService(), String(request.payload.secretName ?? '')),
          }
        }
        case 'has_secret': {
          return {
            present: await resolveSecretValue(getSettingsWorkspaceService(), String(request.payload.secretName ?? '')) !== null,
          }
        }
        default:
          throw new DesktopCapabilityBridgeError(
            'unsupported_operation',
            `Secret capability does not support operation '${request.operation}'.`,
            {
              details: {
                capability: request.capability,
                operation: request.operation,
              },
            },
          )
      }
    },
  }
}

async function resolveSecretValue(
  settingsWorkspaceService: ElectronSettingsWorkspaceService,
  secretName: string,
): Promise<string | null> {
  const normalizedSecretName = secretName.trim()
  if (normalizedSecretName === '') {
    return null
  }

  if (USERNAME_SECRET_NAMES.has(normalizedSecretName)) {
    const stateResult = await settingsWorkspaceService.loadState()
    if (!stateResult.ok) {
      throw new DesktopCapabilityBridgeError('internal_error', stateResult.error, {
        details: {
          secretName: normalizedSecretName,
          source: 'settings-workspace-state',
        },
      })
    }

    return normalizeOptionalString(stateResult.state.sustech.studentId)
      ?? normalizeOptionalString(stateResult.state.sustech.email)
      ?? null
  }

  if (PASSWORD_SECRET_NAMES.has(normalizedSecretName)) {
    const secretResult = await settingsWorkspaceService.loadSustechCasSecret()
    if (!secretResult.ok) {
      throw new DesktopCapabilityBridgeError('internal_error', secretResult.error, {
        details: {
          secretName: normalizedSecretName,
          source: 'settings-workspace-secrets.sustech',
        },
      })
    }

    return normalizeOptionalString(secretResult.state.password)
  }

  const providerMatch = PROVIDER_API_KEY_SECRET_NAME_PATTERN.exec(normalizedSecretName)
  if (providerMatch !== null) {
    const profileId = providerMatch[1]?.trim() ?? ''
    if (profileId === '') {
      return null
    }

    const secretStatesResult = await settingsWorkspaceService.loadSecretStates({
      profileIds: [profileId],
    })
    if (!secretStatesResult.ok) {
      throw new DesktopCapabilityBridgeError('internal_error', secretStatesResult.error, {
        details: {
          secretName: normalizedSecretName,
          source: 'settings-workspace-secrets.provider',
          profileId,
        },
      })
    }

    return normalizeOptionalString(secretStatesResult.states[profileId]?.apiKey)
  }

  return null
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized === '' ? null : normalized
}
