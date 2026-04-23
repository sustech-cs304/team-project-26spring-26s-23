import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  createManagedRuntimeApiFailure,
  type ManagedRuntimeApi,
  type ManagedRuntimeLoadResponse,
} from '../../../electron/managed-runtime/ipc'
import type { ManagedRuntimeSnapshot } from '../../../electron/managed-runtime/types'
import {
  createManagedRuntimeStatusViewModel,
  type ManagedRuntimeStatusViewModel,
} from './managed-runtime-view-model'

const MANAGED_RUNTIME_API_UNAVAILABLE_ERROR = 'window.managedRuntime is unavailable in the renderer process.'

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

  const getManagedRuntimeApi = useCallback((): ManagedRuntimeApi | undefined => {
    if (typeof window === 'undefined') {
      return undefined
    }

    return window.managedRuntime
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const api = getManagedRuntimeApi()
      const response = api
        ? await api.load()
        : createManagedRuntimeApiFailure(MANAGED_RUNTIME_API_UNAVAILABLE_ERROR, 'api_unavailable')
      applyResponse(response)
    } finally {
      setLoading(false)
    }
  }, [applyResponse, getManagedRuntimeApi])

  const installOrRepair = useCallback(async () => {
    setBusy(true)
    try {
      const api = getManagedRuntimeApi()
      const response = api
        ? await api.installOrRepair(snapshot?.overallStatus === 'ready' ? 'repair' : 'install')
        : createManagedRuntimeApiFailure(MANAGED_RUNTIME_API_UNAVAILABLE_ERROR, 'api_unavailable')
      applyResponse(response)
    } finally {
      setBusy(false)
    }
  }, [applyResponse, getManagedRuntimeApi, snapshot?.overallStatus])

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
