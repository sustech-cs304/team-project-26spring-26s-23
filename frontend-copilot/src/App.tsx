import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BootstrapScreen, BOOTSTRAP_PREPARING_MESSAGE } from './components/BootstrapScreen'
import { RecoverableErrorBoundary } from './components/RecoverableErrorBoundary'
import type { CopilotBootstrapController } from './features/copilot/types'
import {
  getWorkbenchShellCopy,
  getWorkspaceLabel,
  getWorkspaceMeta,
  normalizeWorkbenchLanguage,
  type WorkbenchLanguage,
} from './workbench/locale'
import { isHubWorkspaceView, railPrimaryItems, railSecondaryItems } from './workbench/config'
import { CapabilitiesWorkspace } from './workbench/capabilities/CapabilitiesWorkspace'
import {
  loadAnimationsEnabledPreference,
  subscribeToAnimationsEnabledPreferenceUpdates,
} from './workbench/animation-config'
import {
  loadThemeModePreference,
  persistThemeModePreference,
  subscribeToThemeModePreferenceUpdates,
} from './workbench/theme-config'
import type { ThemeMode, WorkspaceView } from './workbench/types'
import { loadSettingsWorkspaceState } from './workbench/settings/workspace-state'
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

const ALL_WORKSPACE_VIEWS: WorkspaceView[] = ['assistant', 'capabilities', 'files', 'sustech', 'developer', 'settings']
const WORKBENCH_WORKSPACE_TRANSITION_MS = 180

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

const FilesWorkspace = lazy(async () => {
  const startedAt = performance.now()
  logStartupTrace('files-workspace-import:start')

  const module = await import('./workbench/files/FilesWorkspace')

  logStartupTrace('files-workspace-import:resolved', {
    durationMs: Math.round(performance.now() - startedAt),
  })

  return {
    default: module.FilesWorkspace,
  }
})

const SustechWorkspace = lazy(async () => {
  const startedAt = performance.now()
  logStartupTrace('sustech-workspace-import:start')

  const module = await import('./workbench/sustech/SustechWorkspace')

  logStartupTrace('sustech-workspace-import:resolved', {
    durationMs: Math.round(performance.now() - startedAt),
  })

  return {
    default: module.SustechWorkspace,
  }
})

interface AppProps {
  bootstrap: CopilotBootstrapController
}

function App({ bootstrap }: AppProps) {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>('assistant')
  const [visitedWorkspaces, setVisitedWorkspaces] = useState<Set<WorkspaceView>>(
    () => new Set<WorkspaceView>(['assistant']),
  )
  const [exitingWorkspace, setExitingWorkspace] = useState<WorkspaceView | null>(null)
  const workspaceTransitionTimerRef = useRef<number | null>(null)
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveInitialThemeMode)
  const [animationsEnabled, setAnimationsEnabled] = useState(resolveInitialAnimationsEnabled)
  const [workbenchLanguage, setWorkbenchLanguage] = useState<WorkbenchLanguage>('zh-CN')

  const applyThemeMode = useCallback((nextThemeMode: ThemeMode) => {
    setThemeMode(nextThemeMode)
  }, [])

  const applyAnimationsEnabled = useCallback((nextAnimationsEnabled: boolean) => {
    setAnimationsEnabled(nextAnimationsEnabled)
  }, [])

  const applyWorkbenchLanguage = useCallback((nextLanguage: string) => {
    setWorkbenchLanguage(normalizeWorkbenchLanguage(nextLanguage))
  }, [])

  const handleThemeModeChange = useCallback((nextThemeMode: ThemeMode) => {
    if (nextThemeMode === themeMode) {
      return
    }

    void persistThemeModePreference({
      previousThemeMode: themeMode,
      themeMode: nextThemeMode,
      applyThemeMode,
    })
  }, [applyThemeMode, themeMode])

  useEffect(() => {
    logStartupTrace('mounted')

    return () => {
      logStartupTrace('unmounted')
    }
  }, [])

  useEffect(() => {
    let disposed = false

    void loadThemeModePreference().then((result) => {
      if (disposed || !result.ok) {
        return
      }

      applyThemeMode(result.themeMode)
    })

    const unsubscribe = subscribeToThemeModePreferenceUpdates((nextThemeMode) => {
      if (disposed) {
        return
      }

      applyThemeMode(nextThemeMode)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [applyThemeMode])

  useEffect(() => {
    let disposed = false

    void loadAnimationsEnabledPreference().then((result) => {
      if (disposed || !result.ok) {
        return
      }

      applyAnimationsEnabled(result.animationsEnabled)
    })

    const unsubscribe = subscribeToAnimationsEnabledPreferenceUpdates((nextAnimationsEnabled) => {
      if (disposed) {
        return
      }

      applyAnimationsEnabled(nextAnimationsEnabled)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [applyAnimationsEnabled])

  useEffect(() => {
    let disposed = false

    void loadSettingsWorkspaceState().then((result) => {
      if (disposed || !result.ok) {
        return
      }

      applyWorkbenchLanguage(result.state.general.language)
    })

    return () => {
      disposed = true
    }
  }, [applyWorkbenchLanguage])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
  }, [themeMode])

  useEffect(() => {
    document.documentElement.dataset.animations = animationsEnabled ? 'enabled' : 'disabled'
  }, [animationsEnabled])

  useEffect(() => {
    logStartupTrace('active-workspace', {
      activeWorkspace,
      bootstrapStatus: bootstrap.state.status,
    })
  }, [activeWorkspace, bootstrap.state.status])

  useEffect(() => {
    return () => {
      if (workspaceTransitionTimerRef.current !== null) {
        window.clearTimeout(workspaceTransitionTimerRef.current)
      }
    }
  }, [])

  const activateWorkspace = useCallback((target: WorkspaceView) => {
    if (target === activeWorkspace) {
      return
    }

    setVisitedWorkspaces((prev) => {
      if (prev.has(target)) {
        return prev
      }
      const next = new Set(prev)
      next.add(target)
      return next
    })

    if (workspaceTransitionTimerRef.current !== null) {
      window.clearTimeout(workspaceTransitionTimerRef.current)
    }

    const previousWorkspace = activeWorkspace
    setExitingWorkspace(previousWorkspace)
    setActiveWorkspace(target)
    workspaceTransitionTimerRef.current = window.setTimeout(() => {
      setExitingWorkspace((current) => (current === previousWorkspace ? null : current))
      workspaceTransitionTimerRef.current = null
    }, WORKBENCH_WORKSPACE_TRANSITION_MS)
  }, [activeWorkspace])

  const workspaceMeta = useMemo(
    () => getWorkspaceMeta(workbenchLanguage, activeWorkspace),
    [activeWorkspace, workbenchLanguage],
  )
  const workbenchShellCopy = useMemo(
    () => getWorkbenchShellCopy(workbenchLanguage),
    [workbenchLanguage],
  )

  return (
    <div
      className="workbench-shell"
      data-theme={themeMode}
      data-animations={animationsEnabled ? 'enabled' : 'disabled'}
    >
        <aside className="workbench-rail" aria-label={workbenchShellCopy.railAriaLabel}>
          {railPrimaryItems.map((item) => {
            const Icon = item.icon
            const active = activeWorkspace === item.id
            const label = getWorkspaceLabel(workbenchLanguage, item.id)

            return (
              <button
                key={item.id}
                type="button"
                className={`rail-button${active ? ' rail-button--active' : ''}`}
                title={label}
                aria-label={label}
                aria-pressed={active}
                onClick={() => activateWorkspace(item.id)}
              >
                <Icon size={18} className="rail-button__icon" />
              </button>
            )
          })}

          <div className="rail-spacer" />

          {railSecondaryItems.map((item) => {
            const Icon = item.icon
            const active = activeWorkspace === item.id
            const label = getWorkspaceLabel(workbenchLanguage, item.id)

            return (
              <button
                key={item.id}
                type="button"
                className={`rail-button${active ? ' rail-button--active' : ''}`}
                title={label}
                aria-label={label}
                aria-pressed={active}
                onClick={() => activateWorkspace(item.id)}
              >
                <Icon size={18} className="rail-button__icon" />
              </button>
            )
          })}
        </aside>

        <div className="workbench-viewport">
          <RecoverableErrorBoundary
            fallback={({ error, reset }) => (
              <BootstrapScreen
                title={workbenchLanguage === 'en-US'
                  ? `${workspaceMeta.label} workspace failed to load`
                  : `${workspaceMeta.label}工作区加载失败`}
                description={workbenchShellCopy.workspaceLoadFailureDescription}
                tone="error"
                details={<pre className="startup-shell__pre">{formatErrorMessage(error)}</pre>}
                actions={[
                  {
                    label: activeWorkspace === 'assistant'
                      ? workbenchShellCopy.retryCurrentWorkspace
                      : workbenchShellCopy.switchBackToAssistant,
                    onClick: () => {
                      if (activeWorkspace === 'assistant') {
                        reset()
                        return
                      }

                      activateWorkspace('assistant')
                    },
                  },
                  {
                    label: workbenchShellCopy.reloadPage,
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
              {ALL_WORKSPACE_VIEWS.map((view) => {
                if (!visitedWorkspaces.has(view)) {
                  return null
                }

                const isActive = view === activeWorkspace
                const isExiting = exitingWorkspace === view && !isActive
                const isVisible = isActive || isExiting

                return (
                  <div
                    key={view}
                    className={[
                      'workbench-view',
                      isActive ? 'workbench-view--active' : null,
                      isExiting ? 'workbench-view--exiting' : null,
                    ].filter(Boolean).join(' ')}
                    data-workspace-view={view}
                    hidden={!isVisible}
                    aria-hidden={!isActive}
                  >
                    {renderWorkspace(
                      view,
                      bootstrap,
                      themeMode,
                      handleThemeModeChange,
                      workbenchLanguage,
                      applyWorkbenchLanguage,
                    )}
                  </div>
                )
              })}
            </Suspense>
          </RecoverableErrorBoundary>
      </div>
    </div>
  )
}

function renderWorkspace(
  view: WorkspaceView,
  bootstrap: CopilotBootstrapController,
  themeMode: ThemeMode,
  onThemeModeChange: (value: ThemeMode) => void,
  workbenchLanguage: WorkbenchLanguage,
  onWorkbenchLanguageChange: (value: string) => void,
) {
  if (view === 'assistant') {
    return <AssistantWorkspace bootstrap={bootstrap} language={workbenchLanguage} />
  }

  if (view === 'settings') {
    return (
      <SettingsWorkspace
        bootstrap={bootstrap}
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
        onLanguageChange={onWorkbenchLanguageChange}
      />
    )
  }

  if (view === 'sustech') {
    return <SustechWorkspace bootstrap={bootstrap} language={workbenchLanguage} />
  }

  if (view === 'capabilities') {
    return <CapabilitiesWorkspace />
  }

  if (view === 'files') {
    return <FilesWorkspace />
  }

  if (isHubWorkspaceView(view)) {
    return <HubWorkspace view={view} language={workbenchLanguage} bootstrap={bootstrap} />
  }

  return null
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveInitialThemeMode(): ThemeMode {
  if (typeof document === 'undefined') {
    return 'light'
  }

  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function resolveInitialAnimationsEnabled(): boolean {
  if (typeof document === 'undefined') {
    return true
  }

  return document.documentElement.dataset.animations !== 'disabled'
}

export default App
