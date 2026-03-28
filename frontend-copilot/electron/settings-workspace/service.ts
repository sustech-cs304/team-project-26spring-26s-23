import { mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises'
import type { SettingsWorkspacePaths } from './paths'
import {
  createDefaultSettingsWorkspaceSecretsDocument,
  createDefaultSettingsWorkspaceStateDocument,
  createSettingsWorkspaceSecretsDocument,
  createSettingsWorkspaceStateDocument,
  normalizeSettingsWorkspaceSecretsDocument,
  normalizeSettingsWorkspaceStateDocument,
  normalizeSettingsWorkspaceStateValues,
  projectProviderSecretStateById,
  projectSettingsWorkspaceEditableState,
  type SettingsWorkspaceEditableState,
  type SettingsWorkspaceProviderSecretState,
  type SettingsWorkspaceProviderSecretStateById,
  type SettingsWorkspaceSecretsDocument,
  type SettingsWorkspaceStateDocument,
  type SettingsWorkspaceStateSaveInput,
  type SettingsWorkspaceStateSource,
} from './schema'

export interface SettingsWorkspaceStorage {
  loadState: () => Promise<{
    state: SettingsWorkspaceEditableState
    source: SettingsWorkspaceStateSource
  }>
  saveState: (input: SettingsWorkspaceStateSaveInput) => Promise<{
    state: SettingsWorkspaceEditableState
  }>
  loadSecretStates: (providerIds?: readonly string[]) => Promise<{
    states: SettingsWorkspaceProviderSecretStateById
  }>
  saveProviderSecret: (providerId: string, apiKey: string) => Promise<{
    state: SettingsWorkspaceProviderSecretState
  }>
  clearProviderSecret: (providerId: string) => Promise<{
    state: SettingsWorkspaceProviderSecretState
  }>
}

interface SettingsWorkspaceFileSystem {
  mkdir: (path: string, options: { recursive: true }) => Promise<void>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  writeFile: (path: string, content: string, encoding: 'utf8') => Promise<void>
}

export interface CreateSettingsWorkspaceStorageOptions {
  paths: SettingsWorkspacePaths
  fileSystem?: Partial<SettingsWorkspaceFileSystem>
}

const defaultFileSystem: SettingsWorkspaceFileSystem = {
  async mkdir(path, options) {
    await fsMkdir(path, options)
  },
  readFile: fsReadFile,
  writeFile: fsWriteFile,
}

export function createSettingsWorkspaceStorage(
  options: CreateSettingsWorkspaceStorageOptions,
): SettingsWorkspaceStorage {
  const fileSystem: SettingsWorkspaceFileSystem = {
    ...defaultFileSystem,
    ...options.fileSystem,
  }

  const loadState = async () => {
    const stateResult = await readStateDocument(options.paths, fileSystem)
    const secretsResult = await readSecretsDocument(options.paths, fileSystem)
    const source: SettingsWorkspaceStateSource = stateResult.missing ? 'initialized-defaults' : 'stored'

    if (stateResult.dirty || secretsResult.dirty) {
      await writeDocuments(options.paths, stateResult.document, secretsResult.document, fileSystem)
    }

    return {
      state: projectSettingsWorkspaceEditableState(
        stateResult.document.values,
        projectProviderSecretStateById(
          stateResult.document.values.providerProfiles.map((profile) => profile.id),
          secretsResult.document,
        ),
      ),
      source,
    }
  }

  const saveState = async (input: SettingsWorkspaceStateSaveInput) => {
    const stateDocument = createSettingsWorkspaceStateDocument(normalizeSettingsWorkspaceStateValues(input))
    const secretsDocument = pruneSecretsDocument(
      (await readSecretsDocument(options.paths, fileSystem)).document,
      new Set(stateDocument.values.providerProfiles.map((profile) => profile.id)),
    )

    await writeDocuments(options.paths, stateDocument, secretsDocument, fileSystem)

    return {
      state: projectSettingsWorkspaceEditableState(
        stateDocument.values,
        projectProviderSecretStateById(
          stateDocument.values.providerProfiles.map((profile) => profile.id),
          secretsDocument,
        ),
      ),
    }
  }

  const loadSecretStates = async (providerIds?: readonly string[]) => {
    const stateDocument = providerIds === undefined ? (await readStateDocument(options.paths, fileSystem)).document : null
    const resolvedProviderIds = providerIds ?? stateDocument?.values.providerProfiles.map((profile) => profile.id) ?? []
    const secretsDocument = (await readSecretsDocument(options.paths, fileSystem)).document

    return {
      states: projectProviderSecretStateById(resolvedProviderIds, secretsDocument),
    }
  }

  const saveProviderSecret = async (providerId: string, apiKey: string) => {
    const normalizedProviderId = normalizeIdentifier(providerId, 'providerId')
    const normalizedApiKey = normalizeIdentifier(apiKey, 'apiKey')
    const secretsDocument = (await readSecretsDocument(options.paths, fileSystem)).document
    const nextSecretsDocument = createSettingsWorkspaceSecretsDocument({
      providerSecrets: {
        ...secretsDocument.values.providerSecrets,
        [normalizedProviderId]: {
          apiKey: normalizedApiKey,
        },
      },
    })

    await writeDocuments(
      options.paths,
      (await readStateDocument(options.paths, fileSystem)).document,
      nextSecretsDocument,
      fileSystem,
    )

    return {
      state: {
        hasApiKey: true,
      },
    }
  }

  const clearProviderSecret = async (providerId: string) => {
    const normalizedProviderId = normalizeIdentifier(providerId, 'providerId')
    const secretsDocument = (await readSecretsDocument(options.paths, fileSystem)).document
    const { [normalizedProviderId]: _removedSecret, ...remainingProviderSecrets } = secretsDocument.values.providerSecrets
    const nextSecretsDocument = createSettingsWorkspaceSecretsDocument({
      providerSecrets: remainingProviderSecrets,
    })

    await writeDocuments(
      options.paths,
      (await readStateDocument(options.paths, fileSystem)).document,
      nextSecretsDocument,
      fileSystem,
    )

    return {
      state: {
        hasApiKey: false,
      },
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

async function readStateDocument(
  paths: SettingsWorkspacePaths,
  fileSystem: SettingsWorkspaceFileSystem,
): Promise<{
  document: SettingsWorkspaceStateDocument
  missing: boolean
  dirty: boolean
}> {
  try {
    const fileContent = await fileSystem.readFile(paths.stateDocument, 'utf8')
    const document = normalizeSettingsWorkspaceStateDocument(JSON.parse(fileContent))

    return {
      document,
      missing: false,
      dirty: serializeDocument(document) !== ensureTrailingNewline(fileContent),
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {
        document: createDefaultSettingsWorkspaceStateDocument(),
        missing: true,
        dirty: true,
      }
    }

    throw error
  }
}

async function readSecretsDocument(
  paths: SettingsWorkspacePaths,
  fileSystem: SettingsWorkspaceFileSystem,
): Promise<{
  document: SettingsWorkspaceSecretsDocument
  missing: boolean
  dirty: boolean
}> {
  try {
    const fileContent = await fileSystem.readFile(paths.secretsDocument, 'utf8')
    const document = normalizeSettingsWorkspaceSecretsDocument(JSON.parse(fileContent))

    return {
      document,
      missing: false,
      dirty: serializeDocument(document) !== ensureTrailingNewline(fileContent),
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {
        document: createDefaultSettingsWorkspaceSecretsDocument(),
        missing: true,
        dirty: true,
      }
    }

    throw error
  }
}

async function writeDocuments(
  paths: SettingsWorkspacePaths,
  stateDocument: SettingsWorkspaceStateDocument,
  secretsDocument: SettingsWorkspaceSecretsDocument,
  fileSystem: SettingsWorkspaceFileSystem,
): Promise<void> {
  await fileSystem.mkdir(paths.rootDir, { recursive: true })

  await Promise.all([
    fileSystem.writeFile(paths.stateDocument, serializeDocument(stateDocument), 'utf8'),
    fileSystem.writeFile(paths.secretsDocument, serializeDocument(secretsDocument), 'utf8'),
  ])
}

function pruneSecretsDocument(
  document: SettingsWorkspaceSecretsDocument,
  validProviderIds: ReadonlySet<string>,
): SettingsWorkspaceSecretsDocument {
  return createSettingsWorkspaceSecretsDocument({
    providerSecrets: Object.fromEntries(
      Object.entries(document.values.providerSecrets).filter(([providerId]) => validProviderIds.has(providerId)),
    ),
  })
}

function serializeDocument(document: SettingsWorkspaceStateDocument | SettingsWorkspaceSecretsDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

function normalizeIdentifier(value: string, name: string): string {
  const normalized = value.trim()

  if (normalized === '') {
    throw new Error(`Missing required ${name}.`)
  }

  return normalized
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
