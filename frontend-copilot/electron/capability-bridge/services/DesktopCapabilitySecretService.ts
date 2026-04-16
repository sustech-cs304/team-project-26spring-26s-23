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

type AllowedSecretLookup =
  | {
      kind: 'username'
      normalizedSecretName: string
      source: 'settings-workspace-state.sustech'
    }
  | {
      kind: 'password'
      normalizedSecretName: string
      source: 'settings-workspace-secrets.sustech'
    }
  | {
      kind: 'provider-api-key'
      normalizedSecretName: string
      source: 'settings-workspace-secrets.provider'
      profileId: string
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
        case 'get_secret':
        case 'has_secret': {
          const secretLookup = resolveAllowedSecretLookup(request.payload.secretName)
          const value = secretLookup === null
            ? null
            : await resolveSecretValue(getSettingsWorkspaceService(), secretLookup)

          await options.appendLog?.('info', '[capability-bridge] Secret lookup completed.', {
            capability: request.capability,
            operation: request.operation,
            toolId: request.toolId,
            runId: request.runId,
            toolCallId: request.toolCallId,
            secretName: secretLookup?.normalizedSecretName ?? normalizeOptionalString(request.payload.secretName) ?? '',
            source: secretLookup?.source ?? 'not_whitelisted',
            present: value !== null,
            ...(secretLookup?.kind === 'provider-api-key'
              ? { profileId: secretLookup.profileId }
              : {}),
          })

          return request.operation === 'get_secret'
            ? { value }
            : { present: value !== null }
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

function resolveAllowedSecretLookup(secretNameValue: unknown): AllowedSecretLookup | null {
  const normalizedSecretName = normalizeOptionalString(secretNameValue)
  if (normalizedSecretName === null) {
    return null
  }

  if (USERNAME_SECRET_NAMES.has(normalizedSecretName)) {
    return {
      kind: 'username',
      normalizedSecretName,
      source: 'settings-workspace-state.sustech',
    }
  }

  if (PASSWORD_SECRET_NAMES.has(normalizedSecretName)) {
    return {
      kind: 'password',
      normalizedSecretName,
      source: 'settings-workspace-secrets.sustech',
    }
  }

  const providerMatch = PROVIDER_API_KEY_SECRET_NAME_PATTERN.exec(normalizedSecretName)
  if (providerMatch === null) {
    return null
  }

  const profileId = providerMatch[1]?.trim() ?? ''
  if (profileId === '') {
    return null
  }

  return {
    kind: 'provider-api-key',
    normalizedSecretName,
    source: 'settings-workspace-secrets.provider',
    profileId,
  }
}

async function resolveSecretValue(
  settingsWorkspaceService: ElectronSettingsWorkspaceService,
  secretLookup: AllowedSecretLookup,
): Promise<string | null> {
  switch (secretLookup.kind) {
    case 'username': {
      const stateResult = await settingsWorkspaceService.loadState()
      if (!stateResult.ok) {
        throw new DesktopCapabilityBridgeError('internal_error', stateResult.error, {
          details: {
            secretName: secretLookup.normalizedSecretName,
            source: secretLookup.source,
          },
        })
      }

      return normalizeOptionalString(stateResult.state.sustech.email)
        ?? normalizeOptionalString(stateResult.state.sustech.studentId)
        ?? null
    }
    case 'password': {
      const secretResult = await settingsWorkspaceService.loadSustechCasSecret()
      if (!secretResult.ok) {
        throw new DesktopCapabilityBridgeError('internal_error', secretResult.error, {
          details: {
            secretName: secretLookup.normalizedSecretName,
            source: secretLookup.source,
          },
        })
      }

      return normalizeOptionalString(secretResult.state.password)
    }
    case 'provider-api-key': {
      const secretStatesResult = await settingsWorkspaceService.loadSecretStates({
        profileIds: [secretLookup.profileId],
      })
      if (!secretStatesResult.ok) {
        throw new DesktopCapabilityBridgeError('internal_error', secretStatesResult.error, {
          details: {
            secretName: secretLookup.normalizedSecretName,
            source: secretLookup.source,
            profileId: secretLookup.profileId,
          },
        })
      }

      return normalizeOptionalString(secretStatesResult.states[secretLookup.profileId]?.apiKey)
    }
  }
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized === '' ? null : normalized
}
