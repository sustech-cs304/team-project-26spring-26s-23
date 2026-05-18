import { useEffect, useMemo } from 'react'

import {
  BootstrapScreen,
  BOOTSTRAP_CONNECTING_MESSAGE,
  BOOTSTRAP_PREPARING_MESSAGE,
} from '../components/BootstrapScreen'
import { DesktopChrome } from '../components/DesktopChrome'
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
      <DesktopChrome>
        <BootstrapScreen
          message={configState.status === 'starting'
            ? BOOTSTRAP_CONNECTING_MESSAGE
            : BOOTSTRAP_PREPARING_MESSAGE}
        />
      </DesktopChrome>
    )
  }

  if (configState.status === 'error') {
    return (
      <DesktopChrome>
        <BootstrapScreen
          title="服务连接失败"
          description="无法连接到后端服务，请检查服务是否正常运行并重试。"
          tone="error"
          details={<pre className="startup-shell__pre">{configState.error}</pre>}
          actions={[
            {
              label: retrying ? '正在重试…' : '重试连接',
              onClick: handleRetryConfig,
              disabled: retrying,
            },
          ]}
        />
      </DesktopChrome>
    )
  }

  return (
    <DesktopChrome>
      <CopilotAppRootBoundary
        bootstrap={bootstrap}
        configStatus={configState.status}
        retrying={retrying}
        onRetryConfig={handleRetryConfig}
      />
    </DesktopChrome>
  )
}

function isWorkbenchState(
  state: CopilotBootstrapState,
): state is Extract<CopilotBootstrapState, { status: 'ready' | 'degraded' }> {
  return state.status === 'ready' || state.status === 'degraded'
}
