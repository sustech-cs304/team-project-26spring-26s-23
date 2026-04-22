import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ManagedRuntimeLoadResponse } from '../../../electron/managed-runtime/ipc'
import type { ManagedRuntimeSnapshot } from '../../../electron/managed-runtime/types'
import {
  createManagedRuntimeStatusViewModel,
  type ManagedRuntimeStatusViewModel,
} from './managed-runtime-view-model'

interface UseManagedRuntimeResult {
  snapshot: ManagedRuntimeSnapshot | null
  viewModel: ManagedRuntimeStatusViewModel | null
  loading: boolean
  busy: boolean
  error: string | null
  refresh: () => Promise<void>
  installOrRepair: () => Promise<void>
}

export function useManagedRuntime(enabled: boolean): UseManagedRuntimeResult {
  const [snapshot, setSnapshot] = useState<ManagedRuntimeSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyResponse = useCallback((response: ManagedRuntimeLoadResponse) => {
    if (response.ok) {
      setSnapshot(response.snapshot)
      setError(null)
      return
    }

    setError(response.error)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    const response = await window.managedRuntime.load()
    applyResponse(response)
    setLoading(false)
  }, [applyResponse])

  const installOrRepair = useCallback(async () => {
    setBusy(true)
    const response = await window.managedRuntime.installOrRepair(snapshot?.overallStatus === 'ready' ? 'repair' : 'install')
    applyResponse(response)
    setBusy(false)
  }, [applyResponse, snapshot?.overallStatus])

  useEffect(() => {
    if (!enabled) {
      return
    }

    void refresh()
  }, [enabled, refresh])

  return {
    snapshot,
    viewModel: useMemo(() => (snapshot ? createManagedRuntimeStatusViewModel(snapshot) : null), [snapshot]),
    loading,
    busy,
    error,
    refresh,
    installOrRepair,
  }
}
