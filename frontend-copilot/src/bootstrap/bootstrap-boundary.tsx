import { Suspense } from 'react'

import {
  BootstrapScreen,
  BOOTSTRAP_PREPARING_MESSAGE,
} from '../components/BootstrapScreen'
import { RecoverableErrorBoundary } from '../components/RecoverableErrorBoundary'
import type {
  CopilotBootstrapController,
  CopilotBootstrapState,
} from '../features/copilot/types'
import { LazyApp } from './bootstrap-cache'
import { formatErrorMessage } from './startup-tracing'

export interface CopilotAppRootBoundaryProps {
  bootstrap: CopilotBootstrapController
  configStatus: CopilotBootstrapState['status']
  retrying: boolean
  onRetryConfig: () => void
}

export function CopilotAppRootBoundary({
  bootstrap,
  configStatus,
  retrying,
  onRetryConfig,
}: CopilotAppRootBoundaryProps) {
  return (
    <RecoverableErrorBoundary
      resetKeys={[configStatus]}
      fallback={({ error, reset }) => (
        <BootstrapScreen
          title="界面加载失败"
          description="应用界面渲染时出现错误，请尝试重试加载。"
          tone="error"
          details={<pre className="startup-shell__pre">{formatErrorMessage(error)}</pre>}
          actions={[
            {
              label: '重试加载',
              onClick: reset,
            },
            {
              label: retrying ? '正在重试连接…' : '重新连接服务',
              onClick: onRetryConfig,
              disabled: retrying,
              emphasis: 'secondary',
            },
          ]}
        />
      )}
    >
      <Suspense fallback={<BootstrapScreen message={BOOTSTRAP_PREPARING_MESSAGE} />}>
        <LazyApp bootstrap={bootstrap} />
      </Suspense>
    </RecoverableErrorBoundary>
  )
}
