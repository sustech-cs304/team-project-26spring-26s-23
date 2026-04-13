import { extractLegacyCopilotSettingsMigrationPatch } from '../copilot-settings-bridge'
import { createDefaultUnifiedConfigSnapshot } from '../defaults'
import type { UnifiedConfigFieldPatch } from '../field-registry'
import { applyUnifiedConfigFieldPatch } from '../patch'
import type { UnifiedConfigCenterPaths } from '../paths'
import {
  createConfigCenterStore,
  type ConfigCenterStore,
  type ConfigCenterStoreFileSystem,
} from '../persistence/ConfigCenterStore'

export type UnifiedConfigSnapshotSource = 'stored' | 'initialized-defaults' | 'migrated-legacy'

export interface UnifiedConfigLoadResult {
  snapshot: ReturnType<typeof createDefaultUnifiedConfigSnapshot>
  source: UnifiedConfigSnapshotSource
  migratedFrom: string | null
}

export interface ConfigCenterBootstrapService {
  loadSnapshot: () => Promise<UnifiedConfigLoadResult>
}

export interface CreateConfigCenterBootstrapServiceOptions {
  paths: UnifiedConfigCenterPaths
  fileSystem?: Partial<ConfigCenterStoreFileSystem>
  store?: ConfigCenterStore
}

export function createConfigCenterBootstrapService(
  options: CreateConfigCenterBootstrapServiceOptions,
): ConfigCenterBootstrapService {
  const store = options.store ?? createConfigCenterStore({
    paths: options.paths,
    fileSystem: options.fileSystem,
  })
  const readFile: ConfigCenterStoreFileSystem['readFile'] = store.readFile

  return {
    async loadSnapshot(): Promise<UnifiedConfigLoadResult> {
      const storedSnapshotResult = await store.loadStoredSnapshot()

      if (storedSnapshotResult.allMissing) {
        const migrationResult = await tryLoadLegacyMigration(options.paths, readFile)
        const snapshot = migrationResult.patch === null
          ? createDefaultUnifiedConfigSnapshot()
          : applyUnifiedConfigFieldPatch(createDefaultUnifiedConfigSnapshot(), migrationResult.patch)

        await store.writeSnapshot(snapshot)

        return {
          snapshot,
          source: migrationResult.patch === null ? 'initialized-defaults' : 'migrated-legacy',
          migratedFrom: migrationResult.sourceFile,
        }
      }

      if (storedSnapshotResult.dirty) {
        await store.writeSnapshot(storedSnapshotResult.snapshot)
      }

      return {
        snapshot: storedSnapshotResult.snapshot,
        source: 'stored',
        migratedFrom: null,
      }
    },
  }
}

async function tryLoadLegacyMigration(
  paths: UnifiedConfigCenterPaths,
  readFile: ConfigCenterStoreFileSystem['readFile'],
): Promise<{
    patch: UnifiedConfigFieldPatch | null
    sourceFile: string | null
  }> {
  for (const legacyFilePath of paths.legacySettingsFiles) {
    try {
      const legacyContent = await readFile(legacyFilePath, 'utf8')
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

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
