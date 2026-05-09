import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'

import { notifyBootstrapScreenReady, waitForNextPaint } from './bootstrap-window'
import { BootstrapScreen, BOOTSTRAP_PREPARING_MESSAGE } from './components/BootstrapScreen'
import { DesktopChrome } from './components/DesktopChrome'
import { primeStartupTheme } from './startup-theme'

const rootElement = document.getElementById('root')

if (rootElement === null) {
  throw new Error('Failed to locate #root for renderer bootstrap.')
}

const rootContainer: HTMLElement = rootElement

let root: ReturnType<typeof ReactDOM.createRoot> | null = null
let bootstrapWindowReadySignalSent = false

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

function scheduleBootstrapWindowReadyNotification() {
  if (bootstrapWindowReadySignalSent) {
    return
  }

  bootstrapWindowReadySignalSent = true

  void waitForNextPaint()
    .then(async () => {
      logStartupTrace('bootstrap-screen-ready:notify:start')
      await notifyBootstrapScreenReady()
      logStartupTrace('bootstrap-screen-ready:notify:resolved')
    })
    .catch((error: unknown) => {
      logStartupTrace('bootstrap-screen-ready:notify:failed', {
        error: formatBootstrapError(error),
      })
    })
}

async function bootstrapRenderer() {
  getRoot().render(
    <StrictMode>
      <DesktopChrome>
        <BootstrapScreen message={BOOTSTRAP_PREPARING_MESSAGE} />
      </DesktopChrome>
    </StrictMode>,
  )

  logStartupTrace('react-root-loading:rendered')
  scheduleBootstrapWindowReadyNotification()
  logStartupTrace('startup-theme:prime:start')

  void primeStartupTheme()
    .then((themeMode) => {
      logStartupTrace('startup-theme:prime:resolved', { themeMode })
    })
    .catch((error: unknown) => {
      logStartupTrace('startup-theme:prime:failed', {
        error: formatBootstrapError(error),
      })
    })

  logStartupTrace('copilot-root-import:start')

  void import('./CopilotAppRoot')
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
        <DesktopChrome>
          <BootstrapScreen
            title="应用启动失败"
            description="应用入口加载失败，请刷新页面重试。如果问题持续出现，请联系技术支持。"
            tone="error"
            details={<pre className="startup-shell__pre">{formatBootstrapError(error)}</pre>}
            actions={[
              {
                label: '重新加载页面',
                onClick: () => window.location.reload(),
              },
            ]}
          />
        </DesktopChrome>,
      )
    })
}
