import {
  createSettingsWorkspaceSecretsDocument,
  projectProviderSecretStateById,
  projectSustechCasSecretState,
  type SettingsWorkspaceProviderSecretState,
  type SettingsWorkspaceProviderSecretStateById,
  type SettingsWorkspaceSustechCasSecretState,
} from './secret-schema'
import type { SettingsWorkspaceDocumentIO } from './settings-workspace-document-io'
import { normalizeSettingsWorkspaceIdentifier } from './settings-workspace-serialization'

export interface SettingsWorkspaceSecretStorage {
  loadSecretStates: (profileIds?: readonly string[]) => Promise<{
    states: SettingsWorkspaceProviderSecretStateById
  }>
  loadSustechCasSecret: () => Promise<{
    state: SettingsWorkspaceSustechCasSecretState
  }>
  saveProfileSecret: (profileId: string, apiKey: string) => Promise<{
    state: SettingsWorkspaceProviderSecretState
  }>
  clearProfileSecret: (profileId: string) => Promise<{
    state: SettingsWorkspaceProviderSecretState
  }>
  saveSustechCasSecret: (password: string) => Promise<{
    state: SettingsWorkspaceSustechCasSecretState
  }>
  clearSustechCasSecret: () => Promise<{
    state: SettingsWorkspaceSustechCasSecretState
  }>
}

export function createSettingsWorkspaceSecretStorage(
  documentIO: SettingsWorkspaceDocumentIO,
): SettingsWorkspaceSecretStorage {
  const loadSecretStates = async (profileIds?: readonly string[]) => {
    const stateDocument = profileIds === undefined ? (await documentIO.readStateDocument()).document : null
    const resolvedProfileIds = profileIds ?? stateDocument?.values.providerProfiles.map((profile) => profile.profileId) ?? []
    const secretsDocument = (await documentIO.readSecretsDocument()).document

    return {
      states: projectProviderSecretStateById(resolvedProfileIds, secretsDocument),
    }
  }

  const loadSustechCasSecret = async () => {
    const secretsDocument = (await documentIO.readSecretsDocument()).document

    return {
      state: projectSustechCasSecretState(secretsDocument),
    }
  }

  const saveProfileSecret = async (profileId: string, apiKey: string) => {
    const normalizedProfileId = normalizeSettingsWorkspaceIdentifier(profileId, 'profileId')
    const normalizedApiKey = normalizeSettingsWorkspaceIdentifier(apiKey, 'apiKey')
    const secretsDocument = (await documentIO.readSecretsDocument()).document
    const nextSecretsDocument = createSettingsWorkspaceSecretsDocument({
      providerSecrets: {
        ...secretsDocument.values.providerSecrets,
        [normalizedProfileId]: {
          profileId: normalizedProfileId,
          authKind: 'api-key',
          secretValues: {
            apiKey: normalizedApiKey,
          },
        },
      },
      sustech: secretsDocument.values.sustech,
    })

    await documentIO.writeDocuments((await documentIO.readStateDocument()).document, nextSecretsDocument)

    return {
      state: {
        hasApiKey: true,
        apiKey: normalizedApiKey,
      },
    }
  }

  const clearProfileSecret = async (profileId: string) => {
    const normalizedProfileId = normalizeSettingsWorkspaceIdentifier(profileId, 'profileId')
    const secretsDocument = (await documentIO.readSecretsDocument()).document
    const { [normalizedProfileId]: _removedSecret, ...remainingProviderSecrets } = secretsDocument.values.providerSecrets
    const nextSecretsDocument = createSettingsWorkspaceSecretsDocument({
      providerSecrets: remainingProviderSecrets,
      sustech: secretsDocument.values.sustech,
    })

    await documentIO.writeDocuments((await documentIO.readStateDocument()).document, nextSecretsDocument)

    return {
      state: {
        hasApiKey: false,
        apiKey: '',
      },
    }
  }

  const saveSustechCasSecret = async (password: string) => {
    const normalizedPassword = normalizeSettingsWorkspaceIdentifier(password, 'password')
    const secretsDocument = (await documentIO.readSecretsDocument()).document
    const nextSecretsDocument = createSettingsWorkspaceSecretsDocument({
      providerSecrets: secretsDocument.values.providerSecrets,
      sustech: {
        casPassword: normalizedPassword,
      },
    })

    await documentIO.writeDocuments((await documentIO.readStateDocument()).document, nextSecretsDocument)

    return {
      state: {
        hasPassword: true,
        password: normalizedPassword,
      },
    }
  }

  const clearSustechCasSecret = async () => {
    const secretsDocument = (await documentIO.readSecretsDocument()).document
    const nextSecretsDocument = createSettingsWorkspaceSecretsDocument({
      providerSecrets: secretsDocument.values.providerSecrets,
      sustech: {
        casPassword: '',
      },
    })

    await documentIO.writeDocuments((await documentIO.readStateDocument()).document, nextSecretsDocument)

    return {
      state: {
        hasPassword: false,
        password: '',
      },
    }
  }

  return {
    loadSecretStates,
    loadSustechCasSecret,
    saveProfileSecret,
    clearProfileSecret,
    saveSustechCasSecret,
    clearSustechCasSecret,
  }
}
