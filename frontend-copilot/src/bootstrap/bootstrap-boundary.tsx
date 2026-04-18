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
              onClick: onRetryConfig,
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
}
