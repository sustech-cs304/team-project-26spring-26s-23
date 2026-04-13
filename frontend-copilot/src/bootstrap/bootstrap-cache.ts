import { lazy } from 'react'

import {
  loadCopilotConfigState,
} from '../features/copilot/config'
import type { CopilotBootstrapState } from '../features/copilot/types'
import {
  formatErrorMessage,
  logCopilotRootStartupTrace,
} from './startup-tracing'

let workbenchImportAttempts = 0
let initialConfigStateCache: CopilotBootstrapState | null = null
let initialConfigStatePromise: Promise<CopilotBootstrapState> | null = null

export const loadWorkbenchApp = () => {
  const attempt = ++workbenchImportAttempts
  const startedAt = performance.now()
  logCopilotRootStartupTrace('workbench-import:start', { attempt })

  return import('../App')
    .then((module) => {
      logCopilotRootStartupTrace('workbench-import:resolved', {
        attempt,
        durationMs: Math.round(performance.now() - startedAt),
      })
      return module
    })
    .catch((error) => {
      logCopilotRootStartupTrace('workbench-import:failed', {
        attempt,
        durationMs: Math.round(performance.now() - startedAt),
        error: formatErrorMessage(error),
      })
      throw error
    })
}

export const LazyApp = lazy(loadWorkbenchApp)

export function loadInitialConfigState(): Promise<CopilotBootstrapState> {
  if (initialConfigStateCache !== null) {
    logCopilotRootStartupTrace('config-cache:hit', {
      status: initialConfigStateCache.status,
    })
    return Promise.resolve(initialConfigStateCache)
  }

  if (initialConfigStatePromise !== null) {
    logCopilotRootStartupTrace('config-cache:promise-hit')
    return initialConfigStatePromise
  }

  const startedAt = performance.now()
  logCopilotRootStartupTrace('config-cache:miss')

  initialConfigStatePromise = loadCopilotConfigState()
    .catch((error) => {
      const state = {
        status: 'error',
        error: formatErrorMessage(error),
      } satisfies CopilotBootstrapState

      logCopilotRootStartupTrace('config-cache:resolved', {
        durationMs: Math.round(performance.now() - startedAt),
        status: state.status,
        error: state.error,
      })

      return state
    })
    .then((state) => {
      initialConfigStateCache = state
      logCopilotRootStartupTrace('config-cache:stored', {
        durationMs: Math.round(performance.now() - startedAt),
        status: state.status,
      })
      return state
    })

  return initialConfigStatePromise
}

export function rememberCopilotBootstrapState(state: CopilotBootstrapState) {
  initialConfigStateCache = state
  initialConfigStatePromise = Promise.resolve(state)
}
