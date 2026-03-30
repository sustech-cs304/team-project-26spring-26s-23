import { mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises'
import type { SettingsWorkspacePaths } from './paths'
import {
  createDefaultSettingsWorkspaceSecretsDocument,
  normalizeSettingsWorkspaceSecretsDocument,
  type SettingsWorkspaceSecretsDocument,
} from './secret-schema'
import {
  isSettingsWorkspaceDocumentDirty,
  serializeSettingsWorkspaceDocument,
} from './settings-workspace-serialization'
import {
  createDefaultSettingsWorkspaceStateDocument,
  normalizeSettingsWorkspaceStateDocument,
  type SettingsWorkspaceStateDocument,
} from './state-schema'

export interface SettingsWorkspaceFileSystem {
  mkdir: (path: string, options: { recursive: true }) => Promise<void>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  writeFile: (path: string, content: string, encoding: 'utf8') => Promise<void>
}

export interface CreateSettingsWorkspaceDocumentIOOptions {
  paths: SettingsWorkspacePaths
  fileSystem?: Partial<SettingsWorkspaceFileSystem>
}

export interface SettingsWorkspaceDocumentReadResult<TDocument> {
  document: TDocument
  missing: boolean
  dirty: boolean
}

export interface SettingsWorkspaceDocumentIO {
  readStateDocument: () => Promise<SettingsWorkspaceDocumentReadResult<SettingsWorkspaceStateDocument>>
  readSecretsDocument: () => Promise<SettingsWorkspaceDocumentReadResult<SettingsWorkspaceSecretsDocument>>
  writeDocuments: (
    stateDocument: SettingsWorkspaceStateDocument,
    secretsDocument: SettingsWorkspaceSecretsDocument,
  ) => Promise<void>
}

const defaultFileSystem: SettingsWorkspaceFileSystem = {
  async mkdir(path, options) {
    await fsMkdir(path, options)
  },
  readFile: fsReadFile,
  writeFile: fsWriteFile,
}

export function createSettingsWorkspaceDocumentIO(
  options: CreateSettingsWorkspaceDocumentIOOptions,
): SettingsWorkspaceDocumentIO {
  const fileSystem: SettingsWorkspaceFileSystem = {
    ...defaultFileSystem,
    ...options.fileSystem,
  }

  return {
    readStateDocument: () =>
      readDocument({
        path: options.paths.stateDocument,
        fileSystem,
        normalizeDocument: normalizeSettingsWorkspaceStateDocument,
        createDefaultDocument: createDefaultSettingsWorkspaceStateDocument,
      }),
    readSecretsDocument: () =>
      readDocument({
        path: options.paths.secretsDocument,
        fileSystem,
        normalizeDocument: normalizeSettingsWorkspaceSecretsDocument,
        createDefaultDocument: createDefaultSettingsWorkspaceSecretsDocument,
      }),
    writeDocuments: async (stateDocument, secretsDocument) => {
      await fileSystem.mkdir(options.paths.rootDir, { recursive: true })

      await Promise.all([
        fileSystem.writeFile(options.paths.stateDocument, serializeSettingsWorkspaceDocument(stateDocument), 'utf8'),
        fileSystem.writeFile(
          options.paths.secretsDocument,
          serializeSettingsWorkspaceDocument(secretsDocument),
          'utf8',
        ),
      ])
    },
  }
}

async function readDocument<TDocument extends SettingsWorkspaceStateDocument | SettingsWorkspaceSecretsDocument>(options: {
  path: string
  fileSystem: SettingsWorkspaceFileSystem
  normalizeDocument: (input: unknown) => TDocument
  createDefaultDocument: () => TDocument
}): Promise<SettingsWorkspaceDocumentReadResult<TDocument>> {
  try {
    const fileContent = await options.fileSystem.readFile(options.path, 'utf8')
    const document = options.normalizeDocument(JSON.parse(fileContent))

    return {
      document,
      missing: false,
      dirty: isSettingsWorkspaceDocumentDirty(document, fileContent),
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {
        document: options.createDefaultDocument(),
        missing: true,
        dirty: true,
      }
    }

    throw error
  }
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
