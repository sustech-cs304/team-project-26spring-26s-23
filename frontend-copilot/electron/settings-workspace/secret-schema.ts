import { asRecord, normalizeNonEmptyString, normalizeString } from './normalize'

export const SETTINGS_WORKSPACE_SECRETS_DOCUMENT_VERSION = 1 as const

export interface SettingsWorkspaceSecretRecord {
  apiKey: string
}

export interface SettingsWorkspaceSustechSecretsRecord {
  casPassword: string
}

export interface SettingsWorkspaceSecretsValues {
  providerSecrets: Record<string, SettingsWorkspaceSecretRecord>
  sustech: SettingsWorkspaceSustechSecretsRecord
}

export interface SettingsWorkspaceSecretsDocument {
  version: typeof SETTINGS_WORKSPACE_SECRETS_DOCUMENT_VERSION
  kind: 'settings-workspace-secrets'
  values: SettingsWorkspaceSecretsValues
}

export interface SettingsWorkspaceProviderSecretState {
  hasApiKey: boolean
  apiKey: string
}

export type SettingsWorkspaceProviderSecretStateById = Record<string, SettingsWorkspaceProviderSecretState>

export interface SettingsWorkspaceSustechCasSecretState {
  hasPassword: boolean
  password: string
}

export function createDefaultSettingsWorkspaceSecretsDocument(): SettingsWorkspaceSecretsDocument {
  return createSettingsWorkspaceSecretsDocument({
    providerSecrets: {},
    sustech: {
      casPassword: '',
    },
  })
}

export function createSettingsWorkspaceSecretsDocument(
  values: SettingsWorkspaceSecretsValues,
): SettingsWorkspaceSecretsDocument {
  return {
    version: SETTINGS_WORKSPACE_SECRETS_DOCUMENT_VERSION,
    kind: 'settings-workspace-secrets',
    values: {
      providerSecrets: Object.fromEntries(
        Object.entries(values.providerSecrets).flatMap(([providerId, secret]) => {
          const normalizedProviderId = normalizeNonEmptyString(providerId, '')
          const normalizedApiKey = normalizeNonEmptyString(secret.apiKey, '')

          if (!normalizedProviderId || !normalizedApiKey) {
            return []
          }

          return [[normalizedProviderId, { apiKey: normalizedApiKey }]]
        }),
      ),
      sustech: {
        casPassword: normalizeString(values.sustech.casPassword, ''),
      },
    },
  }
}

export function normalizeSettingsWorkspaceSecretsDocument(input: unknown): SettingsWorkspaceSecretsDocument {
  const record = asRecord(input)
  const values = asRecord(record.values)
  const providerSecrets = asRecord(values.providerSecrets)
  const sustech = asRecord(values.sustech)

  return createSettingsWorkspaceSecretsDocument({
    providerSecrets: Object.fromEntries(
      Object.entries(providerSecrets).flatMap(([providerId, secretRecord]) => {
        const normalizedProviderId = normalizeNonEmptyString(providerId, '')
        const normalizedApiKey = normalizeNonEmptyString(asRecord(secretRecord).apiKey, '')

        if (!normalizedProviderId || !normalizedApiKey) {
          return []
        }

        return [[normalizedProviderId, { apiKey: normalizedApiKey }]]
      }),
    ),
    sustech: {
      casPassword: normalizeString(sustech.casPassword, ''),
    },
  })
}

export function projectProviderSecretStateById(
  providerIds: readonly string[],
  secretsDocument: SettingsWorkspaceSecretsDocument,
): SettingsWorkspaceProviderSecretStateById {
  return Object.fromEntries(
    providerIds.map((providerId) => {
      const normalizedProviderId = normalizeNonEmptyString(providerId, '')
      const apiKey =
        normalizedProviderId === ''
          ? ''
          : normalizeNonEmptyString(secretsDocument.values.providerSecrets[normalizedProviderId]?.apiKey, '')

      return [
        providerId,
        {
          hasApiKey: apiKey !== '',
          apiKey,
        },
      ]
    }),
  )
}

export function projectSustechCasSecretState(
  secretsDocument: SettingsWorkspaceSecretsDocument,
): SettingsWorkspaceSustechCasSecretState {
  const password = normalizeString(secretsDocument.values.sustech.casPassword, '')

  return {
    hasPassword: password !== '',
    password,
  }
}
