import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'

import type { ConfigCenterPublicSnapshot } from '../electron/config-center/public-snapshot'
import {
  BootstrapScreen,
  BOOTSTRAP_CONNECTING_MESSAGE,
  BOOTSTRAP_PREPARING_MESSAGE,
} from './components/BootstrapScreen'
import { RecoverableErrorBoundary } from './components/RecoverableErrorBoundary'
import {
  loadCopilotConfigState,
  loadCopilotConfigStateFromPublicSnapshot,
  retryCopilotConfigState,
} from './features/copilot/config'
import { subscribeToConfigCenterPublicSnapshotUpdates } from './features/copilot/config-center'
import type {
  CopilotBootstrapController,
  CopilotBootstrapState,
} from './features/copilot/types'

let workbenchImportAttempts = 0
let initialConfigStateCache: CopilotBootstrapState | null = null
let initialConfigStatePromise: Promise<CopilotBootstrapState> | null = null

function logStartupTrace(stage: string, data: Record<string, unknown> = {}) {
  console.info('[startup]', JSON.stringify({
    scope: 'CopilotAppRoot',
    stage,
    t: Math.round(performance.now()),
    ...data,
  }))
}

const loadWorkbenchApp = () => {
  const attempt = ++workbenchImportAttempts
  const startedAt = performance.now()
  logStartupTrace('workbench-import:start', { attempt })

  return import('./App.tsx')
    .then((module) => {
      logStartupTrace('workbench-import:resolved', {
        attempt,
        durationMs: Math.round(performance.now() - startedAt),
      })
      return module
    })
    .catch((error) => {
      logStartupTrace('workbench-import:failed', {
        attempt,
        durationMs: Math.round(performance.now() - startedAt),
        error: formatErrorMessage(error),
      })
      throw error
    })
}

const LazyApp = lazy(loadWorkbenchApp)

function loadInitialConfigState(): Promise<CopilotBootstrapState> {
  if (initialConfigStateCache !== null) {
    logStartupTrace('config-cache:hit', {
      status: initialConfigStateCache.status,
    })
    return Promise.resolve(initialConfigStateCache)
  }

  if (initialConfigStatePromise !== null) {
    logStartupTrace('config-cache:promise-hit')
    return initialConfigStatePromise
  }

  const startedAt = performance.now()
  logStartupTrace('config-cache:miss')

  initialConfigStatePromise = loadCopilotConfigState()
    .catch((error) => {
      const state = {
        status: 'error',
        error: formatErrorMessage(error),
      } satisfies CopilotBootstrapState

      logStartupTrace('config-cache:resolved', {
        durationMs: Math.round(performance.now() - startedAt),
        status: state.status,
        error: state.error,
      })

      return state
    })
    .then((state) => {
      initialConfigStateCache = state
      logStartupTrace('config-cache:stored', {
        durationMs: Math.round(performance.now() - startedAt),
        status: state.status,
      })
      return state
    })

  return initialConfigStatePromise
}

function rememberConfigState(state: CopilotBootstrapState) {
  initialConfigStateCache = state
  initialConfigStatePromise = Promise.resolve(state)
}

export async function refreshCopilotBootstrapStateFromPublicSnapshot(input: {
  snapshot: ConfigCenterPublicSnapshot
  applyState: (state: CopilotBootstrapState) => void
}): Promise<CopilotBootstrapState> {
  try {
    const nextState = await loadCopilotConfigStateFromPublicSnapshot(input.snapshot)
    rememberConfigState(nextState)
    input.applyState(nextState)
    return nextState
  } catch (error) {
    const nextState = {
      status: 'error',
      error: formatErrorMessage(error),
    } satisfies CopilotBootstrapState

    rememberConfigState(nextState)
    input.applyState(nextState)
    return nextState
  }
}

export function CopilotAppRoot() {
  const [configState, setConfigState] = useState<CopilotBootstrapState>({ status: 'loading' })
  const [retrying, setRetrying] = useState(false)

  const visibleStage = useMemo(() => {
    if (configState.status === 'loading' || configState.status === 'starting') {
      return `config:${configState.status}`
    }

    if (configState.status === 'error') {
      return 'config:error'
    }

    return 'workbench'
  }, [configState.status])

  const readConfigState = useCallback(async (source: 'initial' | 'retry') => {
    const startedAt = performance.now()
    logStartupTrace('config-state:read:start', { source })

    if (source === 'retry') {
      setRetrying(true)
    }

    try {
      const nextState = source === 'retry'
        ? await retryCopilotConfigState()
        : await loadInitialConfigState()

      rememberConfigState(nextState)
      setConfigState(nextState)
      logStartupTrace('config-state:read:resolved', {
        source,
        durationMs: Math.round(performance.now() - startedAt),
        status: nextState.status,
      })
    } catch (error) {
      const nextState: CopilotBootstrapState = {
        status: 'error',
        error: formatErrorMessage(error),
      }
      rememberConfigState(nextState)
      setConfigState(nextState)
      logStartupTrace('config-state:read:failed', {
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
    logStartupTrace('root-mounted')
    void loadWorkbenchApp()
    void readConfigState('initial')

    return () => {
      logStartupTrace('root-unmounted')
    }
  }, [readConfigState])

  useEffect(() => {
    let disposed = false
    const unsubscribe = subscribeToConfigCenterPublicSnapshotUpdates((snapshot) => {
      logStartupTrace('config-state:subscription:received', {
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

        logStartupTrace('config-state:subscription:resolved', {
          status: nextState.status,
        })
      })
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    logStartupTrace('visible-stage', {
      visibleStage,
      configStatus: configState.status,
      runtimeUrl: configState.status === 'ready' || configState.status === 'degraded'
        ? configState.runtimeUrl
        : null,
      agentName: configState.status === 'ready' || configState.status === 'degraded'
        ? configState.agentName
        : null,
    })
  }, [configState, visibleStage])

  const handleRetryConfig = useCallback(() => {
    void readConfigState('retry')
  }, [readConfigState])

  const bootstrap = useMemo<CopilotBootstrapController>(() => ({
    state: configState,
    retrying,
    retry: handleRetryConfig,
  }), [configState, handleRetryConfig, retrying])

  const workbench = (
    <RecoverableErrorBoundary
      resetKeys={[configState.status]}
      fallback={({ error, reset }) => (
        <BootstrapScreen
          title="工作台壳层加载失败"
          description="根装配层已完成状态决策，但工作台外壳模块懒加载或渲染失败。当前显示根级失败兜底，避免再次出现无解释白屏。"
          tone="error"
          details={<pre className="startup-shell__pre">{formatErrorMessage(error)}</pre>}
          actions={[
            {
              label: '重试加载工作台',
              onClick: reset,
            },
            {
              label: retrying ? '正在重试运行态…' : '重新读取运行态',
              onClick: handleRetryConfig,
              disabled: retrying,
              emphasis: 'secondary',
            },
          ]}
        />
      )}
    >
      <Suspense
        fallback={
          <BootstrapScreen message={BOOTSTRAP_PREPARING_MESSAGE} />
        }
      >
        <LazyApp bootstrap={bootstrap} />
      </Suspense>
    </RecoverableErrorBoundary>
  )

  if (configState.status === 'loading' || configState.status === 'starting') {
    return (
      <BootstrapScreen
        message={configState.status === 'starting'
          ? BOOTSTRAP_CONNECTING_MESSAGE
          : BOOTSTRAP_PREPARING_MESSAGE}
      />
    )
  }

  if (configState.status === 'error') {
    return (
      <BootstrapScreen
        title="运行态装配失败"
        description="当前无法完成根层配置/运行态装配。启动壳仍然保持可见，并由根层统一持有重试动作。"
        tone="error"
        details={<pre className="startup-shell__pre">{configState.error}</pre>}
        actions={[
          {
            label: retrying ? '正在重试…' : '重试读取运行态',
            onClick: handleRetryConfig,
            disabled: retrying,
          },
        ]}
      />
    )
  }

  return workbench
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
