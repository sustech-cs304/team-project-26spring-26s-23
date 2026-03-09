import { CopilotKit } from '@copilotkit/react-core'
import { useEffect, useState, type ReactNode } from 'react'

import App from './App.tsx'
import { loadCopilotConfigState } from './features/copilot/config'
import type { CopilotConfigState } from './features/copilot/types'

type CopilotBootstrapState = CopilotConfigState | { status: 'loading' }

export function CopilotAppRoot() {
  const [configState, setConfigState] = useState<CopilotBootstrapState>({ status: 'loading' })

  useEffect(() => {
    let disposed = false

    const bootstrapCopilot = async () => {
      try {
        const nextState = await loadCopilotConfigState()

        if (!disposed) {
          setConfigState(nextState)
        }
      } catch (error) {
        if (!disposed) {
          setConfigState({
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown copilot bootstrap failure.',
          })
        }
      }
    }

    void bootstrapCopilot()

    return () => {
      disposed = true
    }
  }, [])

  return renderAppWithCopilotProvider(configState)
}

function renderAppWithCopilotProvider(configState: CopilotBootstrapState): ReactNode {
  const app = <App />

  if (configState.status !== 'ready') {
    return app
  }

  return (
    <CopilotKit runtimeUrl={configState.runtimeUrl} agent={configState.agentName}>
      {app}
    </CopilotKit>
  )
}
