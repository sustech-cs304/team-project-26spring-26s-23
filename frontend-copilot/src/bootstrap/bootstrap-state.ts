import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ConfigCenterPublicSnapshot } from '../../electron/config-center/public-snapshot'
import {
  loadCopilotConfigStateFromPublicSnapshot,
  retryCopilotConfigState,
} from '../features/copilot/config'
import { subscribeToConfigCenterPublicSnapshotUpdates } from '../features/copilot/config-center'
import type {
  CopilotBootstrapController,
  CopilotBootstrapState,
} from '../features/copilot/types'
import {
  loadInitialConfigState,
  loadWorkbenchApp,
  rememberCopilotBootstrapState,
} from './bootstrap-cache'
import {
  formatErrorMessage,
  logCopilotRootStartupTrace,
} from './startup-tracing'

export interface RefreshCopilotBootstrapStateFromPublicSnapshotInput {
  snapshot: ConfigCenterPublicSnapshot
  applyState: (state: CopilotBootstrapState) => void
}

export async function refreshCopilotBootstrapStateFromPublicSnapshot(
  input: RefreshCopilotBootstrapStateFromPublicSnapshotInput,
): Promise<CopilotBootstrapState> {
  try {
    const nextState = await loadCopilotConfigStateFromPublicSnapshot(input.snapshot)
    rememberCopilotBootstrapState(nextState)
    input.applyState(nextState)
    return nextState
  } catch (error) {
    const nextState = {
      status: 'error',
      error: formatErrorMessage(error),
    } satisfies CopilotBootstrapState

    rememberCopilotBootstrapState(nextState)
    input.applyState(nextState)
    return nextState
  }
}

export interface UseCopilotBootstrapStateResult {
  bootstrap: CopilotBootstrapController
  configState: CopilotBootstrapState
  retrying: boolean
  handleRetryConfig: () => void
}

export function useCopilotBootstrapState(): UseCopilotBootstrapStateResult {
  const [configState, setConfigState] = useState<CopilotBootstrapState>({ status: 'loading' })
  const [retrying, setRetrying] = useState(false)

  const readConfigState = useCallback(async (source: 'initial' | 'retry') => {
    const startedAt = performance.now()
    logCopilotRootStartupTrace('config-state:read:start', { source })

    if (source === 'retry') {
      setRetrying(true)
    }

    try {
      const nextState = source === 'retry'
        ? await retryCopilotConfigState()
        : await loadInitialConfigState()

      rememberCopilotBootstrapState(nextState)
      setConfigState(nextState)
      logCopilotRootStartupTrace('config-state:read:resolved', {
        source,
        durationMs: Math.round(performance.now() - startedAt),
        status: nextState.status,
      })
    } catch (error) {
      const nextState: CopilotBootstrapState = {
        status: 'error',
        error: formatErrorMessage(error),
      }
      rememberCopilotBootstrapState(nextState)
      setConfigState(nextState)
      logCopilotRootStartupTrace('config-state:read:failed', {
        source,
        durationMs: Math.round(performance.now() - startedAt),
        error: nextState.error,
      })
    } finally {
      if (source === 'retry') {
        setRetrying(false)
      }
    }
  }, [])

  useEffect(() => {
    logCopilotRootStartupTrace('root-mounted')
    void loadWorkbenchApp()
    void readConfigState('initial')

    return () => {
      logCopilotRootStartupTrace('root-unmounted')
    }
  }, [readConfigState])

  useEffect(() => {
    let disposed = false
    const unsubscribe = subscribeToConfigCenterPublicSnapshotUpdates((snapshot) => {
      logCopilotRootStartupTrace('config-state:subscription:received', {
        version: snapshot.version,
        runtimeUrl: snapshot.domains.hostConfig.runtimeUrl,
        agentName: snapshot.domains.assistantBehavior.agentName,
      })

      void refreshCopilotBootstrapStateFromPublicSnapshot({
        snapshot,
        applyState(nextState) {
          if (disposed) {
            return
          }

          setConfigState(nextState)
        },
      }).then((nextState) => {
        if (disposed) {
          return
        }

        logCopilotRootStartupTrace('config-state:subscription:resolved', {
          status: nextState.status,
        })
      })
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const handleRetryConfig = useCallback(() => {
    void readConfigState('retry')
  }, [readConfigState])

  const bootstrap = useMemo<CopilotBootstrapController>(() => ({
    state: configState,
    retrying,
    retry: handleRetryConfig,
  }), [configState, handleRetryConfig, retrying])

  return {
    bootstrap,
    configState,
    retrying,
    handleRetryConfig,
  }
}
