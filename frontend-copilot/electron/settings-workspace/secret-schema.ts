import { asRecord, normalizeNonEmptyString, normalizeString } from './normalize'

export const SETTINGS_WORKSPACE_SECRETS_DOCUMENT_VERSION = 2 as const

export type SettingsWorkspaceProviderSecretAuthKind = string

export interface SettingsWorkspaceSecretRecord {
  profileId: string
  authKind: SettingsWorkspaceProviderSecretAuthKind
  secretValues: Record<string, string>
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
        Object.entries(values.providerSecrets).flatMap(([profileId, secret]) => {
          const normalizedSecret = normalizeProviderSecretRecord(secret, profileId)
          return normalizedSecret === null ? [] : [[normalizedSecret.profileId, normalizedSecret]]
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
      Object.entries(providerSecrets).flatMap(([profileId, secretRecord]) => {
        const normalizedSecret = normalizeProviderSecretRecord(secretRecord, profileId)
        return normalizedSecret === null ? [] : [[normalizedSecret.profileId, normalizedSecret]]
      }),
    ),
    sustech: {
      casPassword: normalizeString(sustech.casPassword, ''),
    },
  })
}

export function projectProviderSecretStateById(
  profileIds: readonly string[],
  secretsDocument: SettingsWorkspaceSecretsDocument,
): SettingsWorkspaceProviderSecretStateById {
  return Object.fromEntries(
    profileIds.map((profileId) => {
      const normalizedProfileId = normalizeNonEmptyString(profileId, '')
      const secret = normalizedProfileId === ''
        ? null
        : secretsDocument.values.providerSecrets[normalizedProfileId] ?? null
      const apiKey = normalizeNonEmptyString(secret?.secretValues.apiKey, '')

      return [
        profileId,
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

function normalizeProviderSecretRecord(
  input: unknown,
  fallbackProfileId: string,
): SettingsWorkspaceSecretRecord | null {
  const record = asRecord(input)
  const profileId = normalizeNonEmptyString(record.profileId, normalizeNonEmptyString(fallbackProfileId, ''))

  if (profileId === '') {
    return null
  }

  const hasLegacyApiKeyField = typeof record.apiKey === 'string'
  const secretValues = normalizeProviderSecretValues(
    'secretValues' in record ? record.secretValues : { apiKey: record.apiKey },
  )
  const authKind = normalizeProviderSecretAuthKind(
    record.authKind,
    hasLegacyApiKeyField || secretValues.apiKey !== undefined ? 'api-key' : 'none',
  )

  if (authKind === 'none' && Object.keys(secretValues).length === 0) {
    return null
  }

  if (authKind !== 'none' && Object.keys(secretValues).length === 0) {
    return null
  }

  return {
    profileId,
    authKind,
    secretValues,
  }
}

function normalizeProviderSecretValues(input: unknown): Record<string, string> {
  const record = asRecord(input)

  return Object.fromEntries(
    Object.entries(record).flatMap(([key, value]) => {
      const normalizedKey = normalizeNonEmptyString(key, '')
      const normalizedValue = normalizeNonEmptyString(value, '')

      if (normalizedKey === '' || normalizedValue === '') {
        return []
      }

      return [[normalizedKey, normalizedValue]]
    }),
  )
}

function normalizeProviderSecretAuthKind(input: unknown, fallback: string): string {
  return normalizeNonEmptyString(input, fallback)
}
