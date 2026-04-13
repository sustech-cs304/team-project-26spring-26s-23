import type { UnifiedConfigFieldPatch } from './field-registry'
import type { UnifiedConfigCenterPaths } from './paths'
import type { ConfigCenterPublicPatch } from './public-patch'
import {
  createConfigCenterBootstrapService,
  type UnifiedConfigLoadResult,
  type UnifiedConfigSnapshotSource,
} from './bootstrap/ConfigCenterBootstrapService'
import {
  createConfigCenterPatchService,
  type UnifiedConfigPublicPatchResult,
  type UnifiedConfigUpdateResult,
} from './patching/ConfigCenterPatchService'
import {
  createConfigCenterStore,
  type ConfigCenterStoreFileSystem as UnifiedConfigCenterFileSystem,
} from './persistence/ConfigCenterStore'

export interface UnifiedConfigCenter {
  loadSnapshot: () => Promise<UnifiedConfigLoadResult>
  applyFieldPatch: (patch: UnifiedConfigFieldPatch) => Promise<UnifiedConfigUpdateResult>
  applyPublicPatch: (patch: ConfigCenterPublicPatch) => Promise<UnifiedConfigPublicPatchResult>
}

export interface CreateUnifiedConfigCenterOptions {
  paths: UnifiedConfigCenterPaths
  fileSystem?: Partial<UnifiedConfigCenterFileSystem>
}

export function createUnifiedConfigCenter(options: CreateUnifiedConfigCenterOptions): UnifiedConfigCenter {
  const store = createConfigCenterStore({
    paths: options.paths,
    fileSystem: options.fileSystem,
  })
  const bootstrapService = createConfigCenterBootstrapService({
    paths: options.paths,
    fileSystem: options.fileSystem,
    store,
  })
  const patchService = createConfigCenterPatchService({
    loadSnapshot: bootstrapService.loadSnapshot,
    writeSnapshot: store.writeSnapshot,
  })

  return {
    loadSnapshot: bootstrapService.loadSnapshot,
    applyFieldPatch: patchService.applyFieldPatch,
    applyPublicPatch: patchService.applyPublicPatch,
  }
}

export type {
  UnifiedConfigLoadResult,
  UnifiedConfigPublicPatchResult,
  UnifiedConfigSnapshotSource,
  UnifiedConfigUpdateResult,
  UnifiedConfigCenterFileSystem,
}
