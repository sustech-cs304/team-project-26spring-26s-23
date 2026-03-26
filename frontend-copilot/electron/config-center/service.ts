import { mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises'
import type { UnifiedConfigCenterPaths } from './paths'
import { extractLegacyCopilotSettingsMigrationPatch } from './copilot-settings-bridge'
import {
  UNIFIED_CONFIG_DOMAIN_LIST,
  applyUnifiedConfigFieldPatch,
  createDefaultUnifiedConfigDomainDocument,
  createDefaultUnifiedConfigSnapshot,
  normalizeUnifiedConfigDomainDocument,
  type UnifiedConfigDomainDocument,
  type UnifiedConfigDomainKey,
  type UnifiedConfigFieldPatch,
  type UnifiedConfigSnapshot,
} from './schema'

export type UnifiedConfigSnapshotSource = 'stored' | 'initialized-defaults' | 'migrated-legacy'

export interface UnifiedConfigLoadResult {
  snapshot: UnifiedConfigSnapshot
  source: UnifiedConfigSnapshotSource
  migratedFrom: string | null
}

export interface UnifiedConfigUpdateResult {
  snapshot: UnifiedConfigSnapshot
}

export interface UnifiedConfigCenter {
  loadSnapshot: () => Promise<UnifiedConfigLoadResult>
  applyFieldPatch: (patch: UnifiedConfigFieldPatch) => Promise<UnifiedConfigUpdateResult>
}

interface UnifiedConfigCenterFileSystem {
  mkdir: (path: string, options: { recursive: true }) => Promise<void>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  writeFile: (path: string, content: string, encoding: 'utf8') => Promise<void>
}

export interface CreateUnifiedConfigCenterOptions {
  paths: UnifiedConfigCenterPaths
  fileSystem?: Partial<UnifiedConfigCenterFileSystem>
}

const defaultFileSystem: UnifiedConfigCenterFileSystem = {
  async mkdir(path, options) {
    await fsMkdir(path, options)
  },
  readFile: fsReadFile,
  writeFile: fsWriteFile,
}

export function createUnifiedConfigCenter(options: CreateUnifiedConfigCenterOptions): UnifiedConfigCenter {
  const fileSystem: UnifiedConfigCenterFileSystem = {
    ...defaultFileSystem,
    ...options.fileSystem,
  }

  const loadSnapshot = async (): Promise<UnifiedConfigLoadResult> => {
    const storedSnapshotResult = await loadStoredSnapshot(options.paths, fileSystem)

    if (storedSnapshotResult.allMissing) {
      const migrationResult = await tryLoadLegacyMigration(options.paths, fileSystem)
      const snapshot = migrationResult.patch === null
        ? createDefaultUnifiedConfigSnapshot()
        : applyUnifiedConfigFieldPatch(createDefaultUnifiedConfigSnapshot(), migrationResult.patch)

      await writeSnapshot(options.paths, snapshot, fileSystem)

      return {
        snapshot,
        source: migrationResult.patch === null ? 'initialized-defaults' : 'migrated-legacy',
        migratedFrom: migrationResult.sourceFile,
      }
    }

    if (storedSnapshotResult.dirty) {
      await writeSnapshot(options.paths, storedSnapshotResult.snapshot, fileSystem)
    }

    return {
      snapshot: storedSnapshotResult.snapshot,
      source: 'stored',
      migratedFrom: null,
    }
  }

  return {
    loadSnapshot,
    async applyFieldPatch(patch) {
      const currentSnapshot = (await loadSnapshot()).snapshot
      const nextSnapshot = applyUnifiedConfigFieldPatch(currentSnapshot, patch)
      await writeSnapshot(options.paths, nextSnapshot, fileSystem)
      return {
        snapshot: nextSnapshot,
      }
    },
  }
}

async function loadStoredSnapshot(
  paths: UnifiedConfigCenterPaths,
  fileSystem: UnifiedConfigCenterFileSystem,
): Promise<{
    snapshot: UnifiedConfigSnapshot
    allMissing: boolean
    dirty: boolean
  }> {
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
  fileSystem: UnifiedConfigCenterFileSystem,
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

async function tryLoadLegacyMigration(
  paths: UnifiedConfigCenterPaths,
  fileSystem: UnifiedConfigCenterFileSystem,
): Promise<{
    patch: UnifiedConfigFieldPatch | null
    sourceFile: string | null
  }> {
  for (const legacyFilePath of paths.legacySettingsFiles) {
    try {
      const legacyContent = await fileSystem.readFile(legacyFilePath, 'utf8')
      const patch = extractLegacyCopilotSettingsMigrationPatch(JSON.parse(legacyContent))

      if (patch !== null) {
        return {
          patch,
          sourceFile: legacyFilePath,
        }
      }
    } catch (error) {
      if (isFileNotFoundError(error)) {
        continue
      }

      throw error
    }
  }

  return {
    patch: null,
    sourceFile: null,
  }
}

async function writeSnapshot(
  paths: UnifiedConfigCenterPaths,
  snapshot: UnifiedConfigSnapshot,
  fileSystem: UnifiedConfigCenterFileSystem,
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
