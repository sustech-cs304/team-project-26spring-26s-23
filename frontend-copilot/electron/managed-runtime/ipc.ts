import type { ManagedRuntimeSnapshot } from './types'

export const MANAGED_RUNTIME_LOAD_CHANNEL = 'managed-runtime:load'

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
}

export function createManagedRuntimeApiFailure(error: string, code: string = 'internal_error'): ManagedRuntimeApiFailure {
  return {
    ok: false,
    error,
    code,
  }
}

