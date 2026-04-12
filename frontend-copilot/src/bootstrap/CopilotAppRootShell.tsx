import { useEffect, useMemo } from 'react'

import {
  BootstrapScreen,
  BOOTSTRAP_CONNECTING_MESSAGE,
  BOOTSTRAP_PREPARING_MESSAGE,
} from '../components/BootstrapScreen'
import type { CopilotBootstrapState } from '../features/copilot/types'
import { CopilotAppRootBoundary } from './bootstrap-boundary'
import { logCopilotRootStartupTrace } from './startup-tracing'
import { useCopilotBootstrapState } from './bootstrap-state'

export function CopilotAppRootShell() {
  const {
    bootstrap,
    configState,
    retrying,
    handleRetryConfig,
  } = useCopilotBootstrapState()

  const visibleStage = useMemo(() => {
    if (configState.status === 'loading' || configState.status === 'starting') {
      return `config:${configState.status}`
    }

    if (configState.status === 'error') {
      return 'config:error'
    }

    return 'workbench'
  }, [configState.status])

  useEffect(() => {
    logCopilotRootStartupTrace('visible-stage', {
      visibleStage,
      configStatus: configState.status,
      runtimeUrl: isWorkbenchState(configState)
        ? configState.runtimeUrl
        : null,
      agentName: isWorkbenchState(configState)
        ? configState.agentName
        : null,
    })
  }, [configState, visibleStage])

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

  return (
    <CopilotAppRootBoundary
      bootstrap={bootstrap}
      configStatus={configState.status}
      retrying={retrying}
      onRetryConfig={handleRetryConfig}
    />
  )
}

function isWorkbenchState(
  state: CopilotBootstrapState,
): state is Extract<CopilotBootstrapState, { status: 'ready' | 'degraded' }> {
  return state.status === 'ready' || state.status === 'degraded'
}
