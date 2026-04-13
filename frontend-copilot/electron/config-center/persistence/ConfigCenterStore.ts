import { mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises'

import {
  createDefaultUnifiedConfigDomainDocument,
  createDefaultUnifiedConfigSnapshot,
} from '../defaults'
import {
  UNIFIED_CONFIG_DOMAIN_LIST,
  type UnifiedConfigDomainDocument,
  type UnifiedConfigDomainKey,
  type UnifiedConfigSnapshot,
} from '../domain-schema'
import { normalizeUnifiedConfigDomainDocument } from '../normalize'
import type { UnifiedConfigCenterPaths } from '../paths'

export interface ConfigCenterStoreFileSystem {
  mkdir: (path: string, options: { recursive: true }) => Promise<void>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  writeFile: (path: string, content: string, encoding: 'utf8') => Promise<void>
}

export interface CreateConfigCenterStoreOptions {
  paths: UnifiedConfigCenterPaths
  fileSystem?: Partial<ConfigCenterStoreFileSystem>
}

export interface ConfigCenterStoredSnapshotLoadResult {
  snapshot: UnifiedConfigSnapshot
  allMissing: boolean
  dirty: boolean
}

export interface ConfigCenterStore {
  loadStoredSnapshot: () => Promise<ConfigCenterStoredSnapshotLoadResult>
  writeSnapshot: (snapshot: UnifiedConfigSnapshot) => Promise<void>
  readFile: ConfigCenterStoreFileSystem['readFile']
}

const defaultFileSystem: ConfigCenterStoreFileSystem = {
  async mkdir(path, options) {
    await fsMkdir(path, options)
  },
  readFile: fsReadFile,
  writeFile: fsWriteFile,
}

export function createConfigCenterStore(options: CreateConfigCenterStoreOptions): ConfigCenterStore {
  const fileSystem: ConfigCenterStoreFileSystem = {
    ...defaultFileSystem,
    ...options.fileSystem,
  }

  return {
    loadStoredSnapshot: () => loadStoredSnapshot(options.paths, fileSystem),
    writeSnapshot: (snapshot) => writeSnapshot(options.paths, snapshot, fileSystem),
    readFile: fileSystem.readFile,
  }
}

async function loadStoredSnapshot(
  paths: UnifiedConfigCenterPaths,
  fileSystem: ConfigCenterStoreFileSystem,
): Promise<ConfigCenterStoredSnapshotLoadResult> {
  const snapshot = createDefaultUnifiedConfigSnapshot()
  const documents = snapshot.documents as Record<UnifiedConfigDomainKey, UnifiedConfigDomainDocument>
  let allMissing = true
  let dirty = false

  for (const domain of UNIFIED_CONFIG_DOMAIN_LIST) {
    const documentResult = await readStoredDomainDocument(domain, paths.documents[domain], fileSystem)
    documents[domain] = documentResult.document as UnifiedConfigDomainDocument
    allMissing = allMissing && documentResult.missing
    dirty = dirty || documentResult.dirty
  }

  return {
    snapshot,
    allMissing,
    dirty,
  }
}

async function readStoredDomainDocument<TDomain extends UnifiedConfigDomainKey>(
  domain: TDomain,
  filePath: string,
  fileSystem: ConfigCenterStoreFileSystem,
): Promise<{
    document: UnifiedConfigDomainDocument<TDomain>
    missing: boolean
    dirty: boolean
  }> {
  try {
    const fileContent = await fileSystem.readFile(filePath, 'utf8')
    const document = normalizeUnifiedConfigDomainDocument(domain, JSON.parse(fileContent))

    return {
      document,
      missing: false,
      dirty: serializeDomainDocument(document) !== ensureTrailingNewline(fileContent),
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {
        document: createDefaultUnifiedConfigDomainDocument(domain),
        missing: true,
        dirty: true,
      }
    }

    throw error
  }
}

async function writeSnapshot(
  paths: UnifiedConfigCenterPaths,
  snapshot: UnifiedConfigSnapshot,
  fileSystem: ConfigCenterStoreFileSystem,
): Promise<void> {
  await fileSystem.mkdir(paths.rootDir, { recursive: true })

  await Promise.all(
    UNIFIED_CONFIG_DOMAIN_LIST.map(async (domain) => {
      await fileSystem.writeFile(
        paths.documents[domain],
        serializeDomainDocument(snapshot.documents[domain]),
        'utf8',
      )
    }),
  )
}

function serializeDomainDocument(document: UnifiedConfigDomainDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
