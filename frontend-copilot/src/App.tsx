import { lazy, Suspense, useEffect, useMemo, useState } from 'react'

import { BootstrapScreen, BOOTSTRAP_PREPARING_MESSAGE } from './components/BootstrapScreen'
import { RecoverableErrorBoundary } from './components/RecoverableErrorBoundary'
import type { CopilotBootstrapController } from './features/copilot/types'
import { isHubWorkspaceView, railPrimaryItems, railSecondaryItems } from './workbench/config'
import type { ThemeMode, WorkspaceView } from './workbench/types'
import './App.css'

function logStartupTrace(stage: string, data: Record<string, unknown> = {}) {
  console.info('[startup]', JSON.stringify({
    scope: 'App',
    stage,
    t: Math.round(performance.now()),
    ...data,
  }))
}

logStartupTrace('module-evaluated')

const AssistantWorkspace = lazy(async () => {
  const startedAt = performance.now()
  logStartupTrace('assistant-workspace-import:start')

  const module = await import('./workbench/assistant/AssistantWorkspace')

  logStartupTrace('assistant-workspace-import:resolved', {
    durationMs: Math.round(performance.now() - startedAt),
  })

  return {
    default: module.AssistantWorkspace,
  }
})

const HubWorkspace = lazy(async () => {
  const startedAt = performance.now()
  logStartupTrace('hub-workspace-import:start')

  const module = await import('./workbench/hub/HubWorkspace')

  logStartupTrace('hub-workspace-import:resolved', {
    durationMs: Math.round(performance.now() - startedAt),
  })

  return {
    default: module.HubWorkspace,
  }
})

const SettingsWorkspace = lazy(async () => {
  const startedAt = performance.now()
  logStartupTrace('settings-workspace-import:start')

  const module = await import('./workbench/settings/SettingsWorkspace')

  logStartupTrace('settings-workspace-import:resolved', {
    durationMs: Math.round(performance.now() - startedAt),
  })

  return {
    default: module.SettingsWorkspace,
  }
})

interface AppProps {
  bootstrap: CopilotBootstrapController
}

function App({ bootstrap }: AppProps) {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>('assistant')
  const [themeMode, setThemeMode] = useState<ThemeMode>('light')

  useEffect(() => {
    logStartupTrace('mounted')

    return () => {
      logStartupTrace('unmounted')
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
  }, [themeMode])

  useEffect(() => {
    logStartupTrace('active-workspace', {
      activeWorkspace,
      bootstrapStatus: bootstrap.state.status,
    })
  }, [activeWorkspace, bootstrap.state.status])

  const workspaceMeta = useMemo(() => resolveWorkspaceMeta(activeWorkspace), [activeWorkspace])

  return (
    <div className="workbench-shell" data-theme={themeMode}>
      <aside className="workbench-rail" aria-label="主图标栏">
        {railPrimaryItems.map((item) => {
          const Icon = item.icon
          const active = activeWorkspace === item.id

          return (
            <button
              key={item.id}
              type="button"
              className={`rail-button${active ? ' rail-button--active' : ''}`}
              title={item.label}
              aria-label={item.label}
              aria-pressed={active}
              onClick={() => setActiveWorkspace(item.id)}
            >
              <Icon size={18} className="rail-button__icon" />
            </button>
          )
        })}

        <div className="rail-spacer" />

        {railSecondaryItems.map((item) => {
          const Icon = item.icon
          const active = activeWorkspace === item.id

          return (
            <button
              key={item.id}
              type="button"
              className={`rail-button${active ? ' rail-button--active' : ''}`}
              title={item.label}
              aria-label={item.label}
              aria-pressed={active}
              onClick={() => setActiveWorkspace(item.id)}
            >
              <Icon size={18} className="rail-button__icon" />
            </button>
          )
        })}
      </aside>

      <RecoverableErrorBoundary
        resetKeys={[activeWorkspace]}
        fallback={({ error, reset }) => (
          <BootstrapScreen
            title={`${workspaceMeta.label}工作区加载失败`}
            description="当前工作区模块未能完成懒加载或渲染，但工作台外壳仍保持可解释失败态，不会退化为纯白屏。"
            tone="error"
            details={<pre className="startup-shell__pre">{formatErrorMessage(error)}</pre>}
            actions={[
              {
                label: activeWorkspace === 'assistant' ? '重试当前工作区' : '切换回助手工作区',
                onClick: () => {
                  if (activeWorkspace === 'assistant') {
                    reset()
                    return
                  }

                  setActiveWorkspace('assistant')
                },
              },
              {
                label: '重新加载页面',
                onClick: () => window.location.reload(),
                emphasis: 'secondary',
              },
            ]}
          />
        )}
      >
        <Suspense
          fallback={<BootstrapScreen message={BOOTSTRAP_PREPARING_MESSAGE} />}
        >
          {renderActiveWorkspace(activeWorkspace, bootstrap, themeMode, setThemeMode)}
        </Suspense>
      </RecoverableErrorBoundary>
    </div>
  )
}

function renderActiveWorkspace(
  activeWorkspace: WorkspaceView,
  bootstrap: CopilotBootstrapController,
  themeMode: ThemeMode,
  onThemeModeChange: (value: ThemeMode) => void,
) {
  if (activeWorkspace === 'assistant') {
    return <AssistantWorkspace bootstrap={bootstrap} />
  }

  if (activeWorkspace === 'settings') {
    return (
      <SettingsWorkspace
        bootstrap={bootstrap}
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
      />
    )
  }

  if (isHubWorkspaceView(activeWorkspace)) {
    return <HubWorkspace view={activeWorkspace} />
  }

  return null
}

function resolveWorkspaceMeta(view: WorkspaceView): { label: string; loadingDescription: string } {
  switch (view) {
    case 'assistant':
      return {
        label: '助手',
        loadingDescription: '助手工作区已从工作台壳拆分为独立懒加载模块；当前仅加载默认首屏所需代码。',
      }
    case 'settings':
      return {
        label: '设置',
        loadingDescription: '设置工作区已从入口壳层剥离，仅在切换到设置时再按需加载。',
      }
    case 'capabilities':
      return {
        label: '能力',
        loadingDescription: '能力工作区模块正在按需加载，不再与默认助手首屏共同打包在一个超级入口文件中。',
      }
    case 'files':
      return {
        label: '文件',
        loadingDescription: '文件工作区模块正在按需加载，以缩短默认首屏装配链。',
      }
    case 'developer':
      return {
        label: '开发',
        loadingDescription: '开发工作区模块正在按需加载，避免与默认助手首屏形成死耦合。',
      }
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default App
