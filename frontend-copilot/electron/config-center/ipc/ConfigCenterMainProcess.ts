import type { HostedBackendService } from '../../runtime/hosted-backend-service'
import type { HostedRuntimePaths } from '../../runtime/runtime-paths'
import { createUnifiedConfigCenterPaths } from '../paths'
import type {
  ConfigCenterPublicPatch,
  ConfigCenterPublicPatchResult,
} from '../public-patch'
import {
  projectConfigCenterPublicSnapshot,
  type ConfigCenterPublicSnapshotLoadResult,
} from '../public-snapshot'
import {
  createUnifiedConfigCenter,
  type UnifiedConfigLoadResult,
  type UnifiedConfigSnapshotSource,
  type UnifiedConfigUpdateResult,
} from '../service'
import type { UnifiedConfigFieldPatch } from '../field-registry'
import {
  createConfigCenterSnapshotSubscription,
  type ConfigCenterPublicSnapshotPublisher,
} from '../subscriptions/ConfigCenterSnapshotSubscription'

export interface ElectronUnifiedConfigLogger {
  (
    level: 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown> | null,
  ): void | Promise<void>
}

export interface CreateElectronUnifiedConfigServiceOptions {
  prepareRuntimePaths: () => Promise<HostedRuntimePaths>
  ensureHostedBackendService?: () => Promise<HostedBackendService>
  appendLog?: ElectronUnifiedConfigLogger
  publishPublicSnapshotUpdate?: ConfigCenterPublicSnapshotPublisher
}

export interface ElectronUnifiedConfigService {
  loadSnapshot: () => Promise<UnifiedConfigLoadResult>
  applyFieldPatch: (patch: UnifiedConfigFieldPatch) => Promise<UnifiedConfigUpdateResult>
  loadPublicSnapshot: () => Promise<ConfigCenterPublicSnapshotLoadResult>
  applyPublicPatch: (patch: ConfigCenterPublicPatch) => Promise<ConfigCenterPublicPatchResult>
  getHostedBackendService: () => Promise<HostedBackendService>
}

export function createElectronUnifiedConfigService(
  options: CreateElectronUnifiedConfigServiceOptions,
): ElectronUnifiedConfigService {
  const snapshotSubscription = createConfigCenterSnapshotSubscription(options.publishPublicSnapshotUpdate)

  const loadSnapshot = async (): Promise<UnifiedConfigLoadResult> => {
    const configCenter = await createConfigCenter(options)
    const loadResult = await configCenter.loadSnapshot()

    await logSnapshotLoad(loadResult.source, loadResult.migratedFrom, options.appendLog)
    return loadResult
  }

  const applyFieldPatch = async (patch: UnifiedConfigFieldPatch): Promise<UnifiedConfigUpdateResult> => {
    const configCenter = await createConfigCenter(options)
    return await configCenter.applyFieldPatch(patch)
  }

  const loadPublicSnapshot = async (): Promise<ConfigCenterPublicSnapshotLoadResult> => {
    try {
      const loadResult = await loadSnapshot()
      return {
        ok: true,
        snapshot: projectConfigCenterPublicSnapshot(loadResult.snapshot),
      }
    } catch (error) {
      return {
        ok: false,
        error: `Failed to load config center public snapshot: ${formatUnknownError(error)}`,
      }
    }
  }

  const applyPublicPatch = async (patch: ConfigCenterPublicPatch): Promise<ConfigCenterPublicPatchResult> => {
    try {
      const configCenter = await createConfigCenter(options)
      const updateResult = await configCenter.applyPublicPatch(patch)
      await snapshotSubscription.publishPublicSnapshotUpdate(updateResult.snapshot)
      return {
        ok: true,
        snapshot: updateResult.snapshot,
      }
    } catch (error) {
      return {
        ok: false,
        error: `Failed to apply config center public patch: ${formatUnknownError(error)}`,
      }
    }
  }

  const getHostedBackendService = async (): Promise<HostedBackendService> => {
    if (options.ensureHostedBackendService === undefined) {
      throw new Error('Hosted backend service accessor is unavailable.')
    }

    return await options.ensureHostedBackendService()
  }

  return {
    loadSnapshot,
    applyFieldPatch,
    loadPublicSnapshot,
    applyPublicPatch,
    getHostedBackendService,
  }
}

async function createConfigCenter(
  options: CreateElectronUnifiedConfigServiceOptions,
) {
  const paths = await options.prepareRuntimePaths()
  return createUnifiedConfigCenter({
    paths: createUnifiedConfigCenterPaths(paths),
  })
}

async function logSnapshotLoad(
  source: UnifiedConfigSnapshotSource,
  migratedFrom: string | null,
  appendLog?: ElectronUnifiedConfigLogger,
): Promise<void> {
  if (appendLog === undefined) {
    return
  }

  switch (source) {
    case 'migrated-legacy':
      await appendLog('info', 'Migrated legacy Copilot settings into the unified config center.', {
        migratedFrom,
      })
      return

    case 'initialized-defaults':
      await appendLog('info', 'Initialized the unified config center with default domain documents.', null)
      return

    case 'stored':
      return
  }
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
