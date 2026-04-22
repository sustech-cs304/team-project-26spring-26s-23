import type { ManagedRuntimeActionReason, ManagedRuntimeSnapshot } from './types'

export const MANAGED_RUNTIME_LOAD_CHANNEL = 'managed-runtime:load'
export const MANAGED_RUNTIME_INSTALL_OR_REPAIR_CHANNEL = 'managed-runtime:install-or-repair'

export interface ManagedRuntimeLoadResult {
  ok: true
  snapshot: ManagedRuntimeSnapshot
}

export interface ManagedRuntimeApiFailure {
  ok: false
  error: string
  code: string
}

export type ManagedRuntimeLoadResponse = ManagedRuntimeLoadResult | ManagedRuntimeApiFailure

export interface ManagedRuntimeApi {
  load: () => Promise<ManagedRuntimeLoadResponse>
  installOrRepair: (reason?: ManagedRuntimeActionReason) => Promise<ManagedRuntimeLoadResponse>
}

export function createManagedRuntimeApiFailure(error: string, code: string = 'internal_error'): ManagedRuntimeApiFailure {
  return {
    ok: false,
    error,
    code,
  }
}
