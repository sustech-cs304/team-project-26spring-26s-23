import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'

import { BootstrapScreen, BOOTSTRAP_PREPARING_MESSAGE } from './components/BootstrapScreen'
import { primeStartupTheme } from './startup-theme'

const rootElement = document.getElementById('root')

if (rootElement === null) {
  throw new Error('Failed to locate #root for renderer bootstrap.')
}

const rootContainer: HTMLElement = rootElement

let root: ReturnType<typeof ReactDOM.createRoot> | null = null

function logStartupTrace(stage: string, data: Record<string, unknown> = {}) {
  console.info('[startup]', JSON.stringify({
    scope: 'renderer-entry',
    stage,
    t: Math.round(performance.now()),
    ...data,
  }))
}

function getRoot() {
  if (root === null) {
    logStartupTrace('react-root:create')
    root = ReactDOM.createRoot(rootContainer)
  }

  return root
}

logStartupTrace('main-module-evaluated', {
  hasStaticStartupShell: rootContainer.querySelector('[data-startup-shell="static"]') !== null,
})

void bootstrapRenderer()

function formatBootstrapError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function bootstrapRenderer() {
  logStartupTrace('startup-theme:prime:start')
  const themeMode = await primeStartupTheme()
  logStartupTrace('startup-theme:prime:resolved', { themeMode })

  getRoot().render(
    <StrictMode>
      <BootstrapScreen message={BOOTSTRAP_PREPARING_MESSAGE} />
    </StrictMode>,
  )

  logStartupTrace('react-root-loading:rendered')
  logStartupTrace('copilot-root-import:start')

  void import('./CopilotAppRoot.tsx')
    .then(({ CopilotAppRoot }) => {
      logStartupTrace('copilot-root-import:resolved')

      getRoot().render(
        <StrictMode>
          <CopilotAppRoot />
        </StrictMode>,
      )

      logStartupTrace('react-root-render:scheduled')
    })
    .catch((error: unknown) => {
      console.error('[renderer] Failed to bootstrap CopilotAppRoot.', error)
      logStartupTrace('copilot-root-import:failed', {
        error: formatBootstrapError(error),
      })

      getRoot().render(
        <BootstrapScreen
          title="桌面界面启动失败"
          description="Renderer 根装配层入口加载失败。当前保留可解释失败态，避免重新退化为纯白。"
          tone="error"
          details={<pre className="startup-shell__pre">{formatBootstrapError(error)}</pre>}
          actions={[
            {
              label: '重新加载页面',
              onClick: () => window.location.reload(),
            },
          ]}
        />,
      )
    })
}
