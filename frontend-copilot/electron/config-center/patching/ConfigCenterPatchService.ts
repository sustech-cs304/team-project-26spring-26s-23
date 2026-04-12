import type { UnifiedConfigSnapshot } from '../domain-schema'
import type { UnifiedConfigFieldPatch } from '../field-registry'
import { applyUnifiedConfigFieldPatch } from '../patch'
import {
  parseConfigCenterPublicPatch,
  type ConfigCenterPublicPatch,
} from '../public-patch'
import {
  projectConfigCenterPublicSnapshot,
  type ConfigCenterPublicSnapshot,
} from '../public-snapshot'
import type { UnifiedConfigLoadResult } from '../bootstrap/ConfigCenterBootstrapService'

export interface UnifiedConfigUpdateResult {
  snapshot: UnifiedConfigSnapshot
}

export interface UnifiedConfigPublicPatchResult {
  snapshot: ConfigCenterPublicSnapshot
}

export interface ConfigCenterPatchService {
  applyFieldPatch: (patch: UnifiedConfigFieldPatch) => Promise<UnifiedConfigUpdateResult>
  applyPublicPatch: (patch: ConfigCenterPublicPatch) => Promise<UnifiedConfigPublicPatchResult>
}

export interface CreateConfigCenterPatchServiceOptions {
  loadSnapshot: () => Promise<UnifiedConfigLoadResult>
  writeSnapshot: (snapshot: UnifiedConfigSnapshot) => Promise<void>
}

export function createConfigCenterPatchService(
  options: CreateConfigCenterPatchServiceOptions,
): ConfigCenterPatchService {
  const applyFieldPatch = async (patch: UnifiedConfigFieldPatch): Promise<UnifiedConfigUpdateResult> => {
    const currentSnapshot = (await options.loadSnapshot()).snapshot
    const nextSnapshot = applyUnifiedConfigFieldPatch(currentSnapshot, patch)
    await options.writeSnapshot(nextSnapshot)

    return {
      snapshot: nextSnapshot,
    }
  }

  const applyPublicPatch = async (
    patch: ConfigCenterPublicPatch,
  ): Promise<UnifiedConfigPublicPatchResult> => {
    const updateResult = await applyFieldPatch(parseConfigCenterPublicPatch(patch))

    return {
      snapshot: projectConfigCenterPublicSnapshot(updateResult.snapshot),
    }
  }

  return {
    applyFieldPatch,
    applyPublicPatch,
  }
}
