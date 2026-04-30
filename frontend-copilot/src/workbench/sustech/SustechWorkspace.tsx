import { Database, GraduationCap, Settings } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import type { WorkbenchLanguage } from '../_locale/types'
import { BlackboardDataBrowser } from './BlackboardDataBrowser'
import { BlackboardSyncPanel } from './BlackboardSyncPanel'

function resolveRuntimeBaseUrl(state: CopilotBootstrapController['state']): string {
  if (state && 'runtimeUrl' in state && state.runtimeUrl) {
    return state.runtimeUrl
  }
  return 'http://127.0.0.1:8765'
}

interface SyncState {
  status: 'idle' | 'running' | 'completed' | 'failed'
  lastSyncAt: string | null
  nextSyncAt: string | null
  lastSyncError: string | null
  syncInterval: string
  progressMessage: string | null
  progressStage: string | null
  progressLogs: string[]
}

const DEFAULT_SYNC_STATE: SyncState = {
  status: 'idle', lastSyncAt: null, nextSyncAt: null,
  lastSyncError: null, syncInterval: 'off', progressMessage: null, progressStage: null, progressLogs: [],
}

type SustechModule = 'blackboard' | 'tis'

const SUSTECH_MODULE_FADE_OUT_MS = 120

interface SustechWorkspaceProps {
  bootstrap: CopilotBootstrapController
  language?: WorkbenchLanguage
}

export function SustechWorkspace({ bootstrap, language = 'zh-CN' }: SustechWorkspaceProps) {
  const lang: WorkbenchLanguage = language === 'en-US' ? 'en-US' : 'zh-CN'
  const isEnglish = lang === 'en-US'
  const [activeModule, setActiveModule] = useState<SustechModule>('blackboard')
  const [visitedModules, setVisitedModules] = useState<Set<SustechModule>>(() => new Set<SustechModule>(['blackboard']))
  const [visibleModule, setVisibleModule] = useState<SustechModule>('blackboard')
  const [exitingModule, setExitingModule] = useState<SustechModule | null>(null)
  const targetModuleRef = useRef<SustechModule>('blackboard')
  const visibleModuleRef = useRef<SustechModule>('blackboard')
  const moduleTransitionTimerRef = useRef<number | null>(null)
  const [syncState, setSyncState] = useState<SyncState>(DEFAULT_SYNC_STATE)
  const [showSettings, setShowSettings] = useState(false)
  const [dataRefreshToken, setDataRefreshToken] = useState(0)
  const runtimeBaseUrl = useMemo(() => resolveRuntimeBaseUrl(bootstrap.state), [bootstrap.state])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${runtimeBaseUrl}/api/blackboard/sync/status`)
      const data = await res.json()
      setSyncState((prev) => {
        const status = data.status ?? prev.status
        const progressLogs = Array.isArray(data.progressLogs) ? data.progressLogs : prev.progressLogs
        return {
          ...prev, status,
          lastSyncAt: data.lastSyncAt ?? prev.lastSyncAt,
          lastSyncError: data.lastSyncError ?? prev.lastSyncError,
          progressMessage: data.progressMessage ?? (status === 'completed' ? null : prev.progressMessage),
          progressStage: data.progressStage ?? (status === 'completed' ? null : prev.progressStage),
          progressLogs,
        }
      })
    } catch { /* backend not ready */ }
  }, [runtimeBaseUrl])

  useEffect(() => { void fetchStatus() }, [fetchStatus])

  const handleTriggerSync = useCallback(async () => {
    setSyncState((prev) => ({
      ...prev,
      status: 'running',
      lastSyncError: null,
      progressMessage: isEnglish ? 'Starting sync…' : '开始同步...',
      progressStage: 'authenticating',
      progressLogs: [isEnglish ? 'Starting sync…' : '开始同步...'],
    }))
    try {
      const res = await fetch(`${runtimeBaseUrl}/api/blackboard/sync/trigger`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const serverError = (body as { error?: string }).error ?? `HTTP ${res.status}`
        setSyncState((prev) => ({ ...prev, status: 'failed', lastSyncError: serverError }))
        return
      }
      const data = await res.json()
      const status = data.status ?? 'idle'
      setSyncState((prev) => ({
        ...prev, status,
        lastSyncAt: data.lastSyncAt ?? prev.lastSyncAt,
        lastSyncError: data.lastSyncError ?? null,
        progressMessage: data.progressMessage ?? (status === 'completed' ? null : prev.progressMessage),
        progressStage: data.progressStage ?? (status === 'completed' ? null : prev.progressStage),
        progressLogs: Array.isArray(data.progressLogs) ? data.progressLogs : prev.progressLogs,
      }))
      if (status === 'completed') {
        setDataRefreshToken((value) => value + 1)
      }
    } catch (err) {
      const message = err instanceof TypeError && err.message === 'Failed to fetch'
        ? `无法连接到后端 ${runtimeBaseUrl}，请确认桌面运行时已启动。`
        : String(err)
      setSyncState((prev) => ({
        ...prev,
        status: 'failed',
        lastSyncError: message,
        progressMessage: message,
        progressLogs: [...prev.progressLogs, message],
      }))
    }
  }, [runtimeBaseUrl, isEnglish])

  useEffect(() => {
    if (syncState.status === 'running') {
      const i = setInterval(() => { void fetchStatus() }, 2000)
      return () => clearInterval(i)
    }
  }, [syncState.status, fetchStatus])

  useEffect(() => () => {
    if (moduleTransitionTimerRef.current !== null) {
      window.clearTimeout(moduleTransitionTimerRef.current)
    }
  }, [])

  useEffect(() => {
    targetModuleRef.current = activeModule
    setVisitedModules((prev) => {
      if (prev.has(activeModule)) {
        return prev
      }
      const next = new Set(prev)
      next.add(activeModule)
      return next
    })

    if (moduleTransitionTimerRef.current !== null) {
      window.clearTimeout(moduleTransitionTimerRef.current)
      moduleTransitionTimerRef.current = null
    }

    if (activeModule === visibleModuleRef.current) {
      setExitingModule(null)
      return
    }

    const moduleToFadeOut = visibleModuleRef.current
    setExitingModule(moduleToFadeOut)
    moduleTransitionTimerRef.current = window.setTimeout(() => {
      const moduleToFadeIn = targetModuleRef.current
      visibleModuleRef.current = moduleToFadeIn
      setVisibleModule(moduleToFadeIn)
      setExitingModule(null)
      moduleTransitionTimerRef.current = null
    }, SUSTECH_MODULE_FADE_OUT_MS)
  }, [activeModule])

  return (
    <section className="workspace-stage sustech-workspace" aria-label={isEnglish ? 'SUSTech' : 'SUSTech'}>
      <aside className="workspace-panel hub-panel" aria-label={isEnglish ? 'Modules' : '模块'}>
        <header className="panel-head">
          <p className="panel-head__eyebrow">SUSTech</p>
          <h1 className="panel-head__title">{isEnglish ? 'Campus Services' : '校园服务'}</h1>
          <p className="panel-head__subtitle">{isEnglish ? 'Academic tools' : '学术工具'}</p>
        </header>
        <ul className="hub-list">
          <li>
            <button
              type="button"
              className={`hub-list__item${activeModule === 'blackboard' ? ' hub-list__item--active' : ''}`}
              onClick={() => setActiveModule('blackboard')}
            >
              <Database size={18} className="sustech-module-icon" />
              <span>Blackboard</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`hub-list__item${activeModule === 'tis' ? ' hub-list__item--active' : ''}`}
              onClick={() => setActiveModule('tis')}
              disabled
            >
              <GraduationCap size={18} className="sustech-module-icon" />
              <span>TIS</span>
            </button>
          </li>
        </ul>
      </aside>

      <main className="workspace-main sustech-workspace__main" aria-label={activeModule === 'blackboard' ? 'Blackboard' : 'TIS'}>
        {(['blackboard', 'tis'] as SustechModule[]).map((module) => {
          if (!visitedModules.has(module)) {
            return null
          }

          const isExiting = module === exitingModule
          const isActive = module === visibleModule && !isExiting
          const isVisible = module === visibleModule || isExiting

          return (
            <div
              key={module}
              className={[
                'sustech-module-keepalive-panel',
                isActive ? 'sustech-module-keepalive-panel--active' : null,
                isExiting ? 'sustech-module-keepalive-panel--exiting' : null,
              ].filter(Boolean).join(' ')}
              data-sustech-module={module}
              hidden={!isVisible}
              aria-hidden={!isActive}
            >
              {module === 'blackboard' ? (
                <>
                  <header className="workspace-main__header">
                    <div>
                      <p className="workspace-main__eyebrow">{isEnglish ? 'Blackboard' : 'Blackboard'}</p>
                      <h2 className="workspace-main__title">
                        {isEnglish ? 'Blackboard Management' : 'Blackboard 管理系统'}
                      </h2>
                    </div>
                    <div className="toolbar-actions">
                      <button type="button" className="icon-button" title={isEnglish ? 'Sync now' : '手动同步'} onClick={handleTriggerSync}>
                        <span className="icon-button__label">↻</span>
                      </button>
                      <button type="button" className="icon-button" title={isEnglish ? 'Settings' : '设置'} onClick={() => setShowSettings(true)}>
                        <Settings size={16} />
                      </button>
                    </div>
                  </header>
                  <section className="workspace-main__content sustech-workspace__content">
                    <BlackboardSyncPanel language={lang} syncState={syncState} />
                    <BlackboardDataBrowser language={lang} baseUrl={runtimeBaseUrl} refreshToken={dataRefreshToken} />
                  </section>
                </>
              ) : (
                <>
                  <header className="workspace-main__header">
                    <div>
                      <p className="workspace-main__eyebrow">TIS</p>
                      <h2 className="workspace-main__title">{isEnglish ? 'Teaching Information System' : '教学信息系统'}</h2>
                    </div>
                  </header>
                  <section className="workspace-main__content sustech-workspace__content">
                    <div className="hub-card">
                      <p className="sustech-home-card__desc">{isEnglish ? 'Coming soon.' : '即将推出。'}</p>
                    </div>
                  </section>
                </>
              )}
            </div>
          )
        })}
      </main>

      {showSettings && (
        <div className="capabilities-dialog-backdrop" onClick={() => setShowSettings(false)}>
          <div className="capabilities-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <header className="capabilities-dialog__header">
              <div>
                <p className="capabilities-dialog__eyebrow">Blackboard</p>
                <h2 className="capabilities-dialog__title">{isEnglish ? 'Sync Settings' : '同步设置'}</h2>
                <p className="capabilities-dialog__description">
                  {isEnglish ? 'Configure automatic background sync interval.' : '配置后台自动同步间隔。'}
                </p>
              </div>
              <button type="button" className="capabilities-dialog__close" onClick={() => setShowSettings(false)}>✕</button>
            </header>
            <div className="capabilities-dialog__body">
              <div className="settings-stack">
                <label className="form-field">
                  <span className="form-field__label">{isEnglish ? 'Sync interval' : '同步间隔'}</span>
                  <select className="text-input" value={syncState.syncInterval}
                    onChange={(e) => setSyncState((prev) => ({ ...prev, syncInterval: e.target.value as SyncState['syncInterval'] }))}>
                    <option value="off">{isEnglish ? 'Off' : '关闭'}</option>
                    <option value="two_hours">{isEnglish ? 'Every 2 hours' : '每两小时'}</option>
                    <option value="daily">{isEnglish ? 'Daily' : '每天'}</option>
                  </select>
                </label>
                {syncState.lastSyncAt && (
                  <p className="form-field__description">{isEnglish ? 'Last sync: ' : '上次同步：'}{syncState.lastSyncAt}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
