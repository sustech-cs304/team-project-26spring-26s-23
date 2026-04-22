import type { HostedRuntimePaths } from '../runtime/runtime-paths'
import { createManagedRuntimeService, type ManagedRuntimeService } from './ManagedRuntimeService'
import { createManagedRuntimeApiFailure, type ManagedRuntimeLoadResponse } from './ipc'
import type { ManagedRuntimeActionReason } from './types'

export interface ElectronManagedRuntimeLogger {
  (level: 'info' | 'warn' | 'error', message: string, context: Record<string, unknown> | null): void | Promise<void>
}

export interface CreateElectronManagedRuntimeServiceOptions {
  prepareRuntimePaths: () => Promise<HostedRuntimePaths>
  userDataPath: string
  appendLog?: ElectronManagedRuntimeLogger
}

export interface ElectronManagedRuntimeService {
  load: () => Promise<ManagedRuntimeLoadResponse>
  installOrRepair: (reason?: ManagedRuntimeActionReason) => Promise<ManagedRuntimeLoadResponse>
}

export function createElectronManagedRuntimeService(
  options: CreateElectronManagedRuntimeServiceOptions,
): ElectronManagedRuntimeService {
  let servicePromise: Promise<ManagedRuntimeService> | null = null

  const getService = async (): Promise<ManagedRuntimeService> => {
    if (servicePromise === null) {
      const nextServicePromise = (async () => {
        const hostedRuntimePaths = await options.prepareRuntimePaths()
        return createManagedRuntimeService({
          userDataPath: options.userDataPath,
          hostedRuntimePaths,
        })
      })()

      servicePromise = nextServicePromise
      void nextServicePromise.catch(() => {
        if (servicePromise === nextServicePromise) {
          servicePromise = null
        }
      })
    }

    return await servicePromise
  }

  return {
    async load() {
      try {
        const snapshot = await (await getService()).loadSnapshot()
        return {
          ok: true,
          snapshot,
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        await options.appendLog?.('error', '[managed-runtime] Failed to load managed runtime snapshot.', { detail })
        return createManagedRuntimeApiFailure(`Failed to load managed runtime snapshot: ${detail}`)
      }
    },
    async installOrRepair(reason = 'repair') {
      try {
        const snapshot = await (await getService()).installOrRepairAll(reason)
        return {
          ok: true,
          snapshot,
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        await options.appendLog?.('error', '[managed-runtime] Failed to install or repair managed runtime.', {
          detail,
          reason,
        })
        return createManagedRuntimeApiFailure(`Failed to install or repair managed runtime: ${detail}`)
      }
    },
  }
}
