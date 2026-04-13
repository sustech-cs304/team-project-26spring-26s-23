import { useEffect, useState } from 'react'

import {
  applyConfigCenterPublicPatch,
  loadConfigCenterPublicSnapshot,
  projectDebugModeEnabledFromConfigCenterPublicSnapshot,
  subscribeToConfigCenterPublicSnapshotUpdates,
} from '../../../../features/copilot/config-center'

export function useConfigCenterDebugModeState() {
  const [debugModeEnabled, setDebugModeEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false

    void loadConfigCenterPublicSnapshot().then((result) => {
      if (cancelled || !result.ok) {
        return
      }

      setDebugModeEnabled(projectDebugModeEnabledFromConfigCenterPublicSnapshot(result.snapshot))
    })

    const unsubscribe = subscribeToConfigCenterPublicSnapshotUpdates((snapshot) => {
      if (cancelled) {
        return
      }

      setDebugModeEnabled(projectDebugModeEnabledFromConfigCenterPublicSnapshot(snapshot))
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const handleDebugModeEnabledChange = (value: boolean) => {
    const previousValue = debugModeEnabled
    setDebugModeEnabled(value)

    void applyConfigCenterPublicPatch({
      domains: {
        assistantBehavior: {
          debugModeEnabled: value,
        },
      },
    }).then((result) => {
      if (!result.ok) {
        setDebugModeEnabled(previousValue)
        return
      }

      setDebugModeEnabled(projectDebugModeEnabledFromConfigCenterPublicSnapshot(result.snapshot))
    })
  }

  return {
    debugModeEnabled,
    handleDebugModeEnabledChange,
  }
}
