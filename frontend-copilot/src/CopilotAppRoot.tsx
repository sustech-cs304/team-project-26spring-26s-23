import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'

import {
  BootstrapScreen,
  BOOTSTRAP_CONNECTING_MESSAGE,
  BOOTSTRAP_PREPARING_MESSAGE,
} from './components/BootstrapScreen'
import { RecoverableErrorBoundary } from './components/RecoverableErrorBoundary'
import { loadCopilotConfigState, retryCopilotConfigState } from './features/copilot/config'
import type {
  CopilotBootstrapController,
  CopilotBootstrapState,
  CopilotConnectableState,
} from './features/copilot/types'

let workbenchImportAttempts = 0
let providerImportAttempts = 0
let cachedCopilotKitModule: typeof import('@copilotkit/react-core') | null = null
let cachedCopilotKitPromise: Promise<typeof import('@copilotkit/react-core')> | null = null

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
const loadCopilotKit = () => {
  if (cachedCopilotKitModule !== null) {
    logStartupTrace('provider-import:cache-hit')
    return Promise.resolve(cachedCopilotKitModule)
  }

  if (cachedCopilotKitPromise !== null) {
    logStartupTrace('provider-import:promise-hit')
    return cachedCopilotKitPromise
  }

  const attempt = ++providerImportAttempts
  const startedAt = performance.now()
  logStartupTrace('provider-import:start', { attempt })

  cachedCopilotKitPromise = import('@copilotkit/react-core')
    .then((module) => {
      cachedCopilotKitModule = module
      logStartupTrace('provider-import:resolved', {
        attempt,
        durationMs: Math.round(performance.now() - startedAt),
      })
      return module
    })
    .catch((error) => {
      cachedCopilotKitPromise = null
      logStartupTrace('provider-import:failed', {
        attempt,
        durationMs: Math.round(performance.now() - startedAt),
        error: formatErrorMessage(error),
      })
      throw error
    })

  return cachedCopilotKitPromise
}

type CopilotKitComponent = typeof import('@copilotkit/react-core')['CopilotKit']
type ProviderLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; error: string }

let initialConfigStateCache: CopilotBootstrapState | null = null
let initialConfigStatePromise: Promise<CopilotBootstrapState> | null = null

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

export function shouldLoadCopilotProvider(input: {
  configState: CopilotBootstrapState
  providerLoadState: ProviderLoadState
  allowWorkbenchWithoutProvider: boolean
  providerLoaded: boolean
}): boolean {
  return isCopilotConnectableState(input.configState)
    && !input.allowWorkbenchWithoutProvider
    && !input.providerLoaded
    && (input.providerLoadState.status === 'idle' || input.providerLoadState.status === 'loading')
}

export function CopilotAppRoot() {
  const [configState, setConfigState] = useState<CopilotBootstrapState>({ status: 'loading' })
  const [retrying, setRetrying] = useState(false)
  const [copilotKit, setCopilotKit] = useState<CopilotKitComponent | null>(null)
  const [providerLoadState, setProviderLoadState] = useState<ProviderLoadState>({ status: 'idle' })
  const [allowWorkbenchWithoutProvider, setAllowWorkbenchWithoutProvider] = useState(false)

  const visibleStage = useMemo(() => {
    if (configState.status === 'loading' || configState.status === 'starting') {
      return `config:${configState.status}`
    }

    if (configState.status === 'error') {
      return 'config:error'
    }

    if (isCopilotConnectableState(configState) && !allowWorkbenchWithoutProvider) {
      if (providerLoadState.status === 'idle' || providerLoadState.status === 'loading') {
        return `provider:${providerLoadState.status}`
      }

      if (providerLoadState.status === 'error') {
        return 'provider:error'
      }
    }

    return 'workbench'
  }, [allowWorkbenchWithoutProvider, configState, providerLoadState.status])

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
    logStartupTrace('visible-stage', {
      visibleStage,
      configStatus: configState.status,
      providerStatus: providerLoadState.status,
      allowWorkbenchWithoutProvider,
      providerLoaded: copilotKit !== null,
      runtimeUrl: isCopilotConnectableState(configState) ? configState.runtimeUrl : null,
      agentName: isCopilotConnectableState(configState) ? configState.agentName : null,
    })
  }, [allowWorkbenchWithoutProvider, configState, copilotKit, providerLoadState.status, visibleStage])

  useEffect(() => {
    if (!isCopilotConnectableState(configState)) {
      if (copilotKit !== null) {
        setCopilotKit(null)
      }

      if (providerLoadState.status !== 'idle') {
        setProviderLoadState({ status: 'idle' })
      }

      if (allowWorkbenchWithoutProvider) {
        setAllowWorkbenchWithoutProvider(false)
      }

      return
    }

    if (!shouldLoadCopilotProvider({
      configState,
      providerLoadState,
      allowWorkbenchWithoutProvider,
      providerLoaded: copilotKit !== null,
    })) {
      return
    }

    let disposed = false
    setProviderLoadState((current) => {
      if (current.status === 'loading') {
        return current
      }

      return { status: 'loading' }
    })

    void loadCopilotKit()
      .then((module) => {
        if (disposed) {
          return
        }

        setCopilotKit(() => module.CopilotKit as CopilotKitComponent)
        setProviderLoadState({ status: 'ready' })
      })
      .catch((error) => {
        if (disposed) {
          return
        }

        setCopilotKit(null)
        setProviderLoadState({
          status: 'error',
          error: formatErrorMessage(error),
        })
      })

    return () => {
      disposed = true
    }
  }, [allowWorkbenchWithoutProvider, configState, copilotKit, providerLoadState.status])

  const handleRetryConfig = useCallback(() => {
    void readConfigState('retry')
  }, [readConfigState])

  const handleRetryProvider = useCallback(() => {
    setAllowWorkbenchWithoutProvider(false)
    setProviderLoadState({ status: 'idle' })
  }, [])

  const bootstrap = useMemo<CopilotBootstrapController>(() => ({
    state: configState,
    retrying,
    retry: handleRetryConfig,
  }), [configState, handleRetryConfig, retrying])

  const workbench = (
    <RecoverableErrorBoundary
      resetKeys={[configState.status, allowWorkbenchWithoutProvider]}
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

  if (isCopilotConnectableState(configState) && !allowWorkbenchWithoutProvider) {
    if (providerLoadState.status === 'idle' || providerLoadState.status === 'loading') {
      return (
        <BootstrapScreen message={BOOTSTRAP_PREPARING_MESSAGE} />
      )
    }

    if (providerLoadState.status === 'error') {
      return (
        <BootstrapScreen
          title="Copilot Provider 注入失败"
          description="运行态已经解析成功，但 Provider 模块未能完成按需加载。当前显示根级失败兜底，避免助手工作区在无解释情况下空白。"
          tone="error"
          details={<pre className="startup-shell__pre">{providerLoadState.error}</pre>}
          actions={[
            {
              label: '重试注入 Provider',
              onClick: handleRetryProvider,
            },
            {
              label: '继续进入工作台',
              onClick: () => setAllowWorkbenchWithoutProvider(true),
              emphasis: 'secondary',
            },
          ]}
        />
      )
    }
  }

  if (
    isCopilotConnectableState(configState)
    && !allowWorkbenchWithoutProvider
    && providerLoadState.status === 'ready'
    && copilotKit !== null
  ) {
    const CopilotProvider = copilotKit

    return (
      <CopilotProvider runtimeUrl={configState.runtimeUrl} agent={configState.agentName}>
        {workbench}
      </CopilotProvider>
    )
  }

  return workbench
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isCopilotConnectableState(
  state: CopilotBootstrapState,
): state is CopilotConnectableState {
  return state.status === 'ready' || state.status === 'degraded'
}
