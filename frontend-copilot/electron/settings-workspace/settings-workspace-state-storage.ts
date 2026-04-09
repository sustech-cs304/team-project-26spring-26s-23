import {
  projectProviderSecretStateById,
  type SettingsWorkspaceProviderSecretStateById,
} from './secret-schema'
import type { SettingsWorkspaceDocumentIO } from './settings-workspace-document-io'
import { pruneSettingsWorkspaceSecretsDocument } from './settings-workspace-serialization'
import {
  createSettingsWorkspaceStateDocument,
  normalizeSettingsWorkspaceStateValues,
  projectSettingsWorkspaceEditableState,
  type SettingsWorkspaceEditableState,
  type SettingsWorkspaceStateSaveInput,
  type SettingsWorkspaceStateSource,
} from './state-schema'

export interface SettingsWorkspaceStateStorage {
  loadState: () => Promise<{
    state: SettingsWorkspaceEditableState
    source: SettingsWorkspaceStateSource
  }>
  saveState: (input: SettingsWorkspaceStateSaveInput) => Promise<{
    state: SettingsWorkspaceEditableState
  }>
}

export function createSettingsWorkspaceStateStorage(documentIO: SettingsWorkspaceDocumentIO): SettingsWorkspaceStateStorage {
  const loadState = async () => {
    const stateResult = await documentIO.readStateDocument()
    const secretsResult = await documentIO.readSecretsDocument()
    const source: SettingsWorkspaceStateSource = stateResult.missing ? 'initialized-defaults' : 'stored'

    if (stateResult.dirty || secretsResult.dirty) {
      await documentIO.writeDocuments(stateResult.document, secretsResult.document)
    }

    return {
      state: projectLoadedState(stateResult.document.values.providerProfiles.map((profile) => profile.profileId), {
        values: stateResult.document.values,
        secretStates: projectProviderSecretStateById(
          stateResult.document.values.providerProfiles.map((profile) => profile.profileId),
          secretsResult.document,
        ),
      }),
      source,
    }
  }

  const saveState = async (input: SettingsWorkspaceStateSaveInput) => {
    const stateDocument = createSettingsWorkspaceStateDocument(normalizeSettingsWorkspaceStateValues(input))
    const secretsDocument = pruneSettingsWorkspaceSecretsDocument(
      (await documentIO.readSecretsDocument()).document,
      new Set(stateDocument.values.providerProfiles.map((profile) => profile.profileId)),
    )

    await documentIO.writeDocuments(stateDocument, secretsDocument)

    return {
      state: projectLoadedState(stateDocument.values.providerProfiles.map((profile) => profile.profileId), {
        values: stateDocument.values,
        secretStates: projectProviderSecretStateById(
          stateDocument.values.providerProfiles.map((profile) => profile.profileId),
          secretsDocument,
        ),
      }),
    }
  }

  return {
    loadState,
    saveState,
  }
}

function projectLoadedState(
  _providerIds: readonly string[],
  input: {
    values: SettingsWorkspaceStateSaveInput
    secretStates: SettingsWorkspaceProviderSecretStateById
  },
): SettingsWorkspaceEditableState {
  return projectSettingsWorkspaceEditableState(input.values, input.secretStates)
}
