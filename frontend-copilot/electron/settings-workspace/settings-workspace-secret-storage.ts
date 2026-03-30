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
  loadSecretStates: (providerIds?: readonly string[]) => Promise<{
    states: SettingsWorkspaceProviderSecretStateById
  }>
  loadSustechCasSecret: () => Promise<{
    state: SettingsWorkspaceSustechCasSecretState
  }>
  saveProviderSecret: (providerId: string, apiKey: string) => Promise<{
    state: SettingsWorkspaceProviderSecretState
  }>
  clearProviderSecret: (providerId: string) => Promise<{
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
  const loadSecretStates = async (providerIds?: readonly string[]) => {
    const stateDocument = providerIds === undefined ? (await documentIO.readStateDocument()).document : null
    const resolvedProviderIds = providerIds ?? stateDocument?.values.providerProfiles.map((profile) => profile.id) ?? []
    const secretsDocument = (await documentIO.readSecretsDocument()).document

    return {
      states: projectProviderSecretStateById(resolvedProviderIds, secretsDocument),
    }
  }

  const loadSustechCasSecret = async () => {
    const secretsDocument = (await documentIO.readSecretsDocument()).document

    return {
      state: projectSustechCasSecretState(secretsDocument),
    }
  }

  const saveProviderSecret = async (providerId: string, apiKey: string) => {
    const normalizedProviderId = normalizeSettingsWorkspaceIdentifier(providerId, 'providerId')
    const normalizedApiKey = normalizeSettingsWorkspaceIdentifier(apiKey, 'apiKey')
    const secretsDocument = (await documentIO.readSecretsDocument()).document
    const nextSecretsDocument = createSettingsWorkspaceSecretsDocument({
      providerSecrets: {
        ...secretsDocument.values.providerSecrets,
        [normalizedProviderId]: {
          apiKey: normalizedApiKey,
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

  const clearProviderSecret = async (providerId: string) => {
    const normalizedProviderId = normalizeSettingsWorkspaceIdentifier(providerId, 'providerId')
    const secretsDocument = (await documentIO.readSecretsDocument()).document
    const { [normalizedProviderId]: _removedSecret, ...remainingProviderSecrets } = secretsDocument.values.providerSecrets
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
    saveProviderSecret,
    clearProviderSecret,
    saveSustechCasSecret,
    clearSustechCasSecret,
  }
}
