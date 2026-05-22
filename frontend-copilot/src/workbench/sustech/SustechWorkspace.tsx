import { Database, GraduationCap, Settings } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import type { WorkbenchLanguage } from '../_locale/types'
import { loadSettingsWorkspaceState } from '../settings/workspace-state'
import { BlackboardDataBrowser } from './BlackboardDataBrowser'
import { BlackboardSyncPanel } from './BlackboardSyncPanel'
import { useBlackboardSync, type SyncState } from './use-blackboard-sync'
import { ANIM } from '../animation-utils'

function resolveRuntimeBaseUrl(state: CopilotBootstrapController['state']): string {
  if (state && 'runtimeUrl' in state && state.runtimeUrl) {
    return state.runtimeUrl
  }
  return 'http://127.0.0.1:8765'
}

type SustechModule = 'blackboard' | 'tis'

const SUSTECH_MODULE_FADE_OUT_MS = ANIM.DURATION_FEEDBACK

interface SustechWorkspaceProps {
  bootstrap: CopilotBootstrapController
  language?: WorkbenchLanguage
}

// eslint-disable-next-line max-lines-per-function
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
  const [showSettings, setShowSettings] = useState(false)
  const runtimeBaseUrl = useMemo(() => resolveRuntimeBaseUrl(bootstrap.state), [bootstrap.state])

  const {
    syncState,
    isSyncRunning,
    dataRefreshToken,
    fetchStatus,
    handleTriggerSync,
    handleCancelSync,
    handleSyncIntervalChange,
  } = useBlackboardSync({ runtimeBaseUrl, language: lang })

  useEffect(() => {
    void (async () => {
      const settingsResult = await loadSettingsWorkspaceState()
      if (!settingsResult.ok) return
      void handleSyncIntervalChange(
        settingsResult.state.sustech.blackboardSyncInterval as SyncState['syncInterval'],
      )
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { void fetchStatus() }, [fetchStatus])

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
        {renderSustechModules({
          visitedModules,
          exitingModule,
          visibleModule,
          isEnglish,
          handleTriggerSync,
          isSyncRunning,
          setShowSettings,
          lang,
          syncState,
          handleCancelSync,
          runtimeBaseUrl,
          dataRefreshToken,
        })}
      </main>

      {showSettings && renderSustechSyncSettingsDialog({
        isEnglish,
        syncState,
        handleSyncIntervalChange,
        onClose: () => setShowSettings(false),
      })}
    </section>
  )
}

function renderSustechModules(input: {
  visitedModules: Set<SustechModule>
  exitingModule: SustechModule | null
  visibleModule: SustechModule
  isEnglish: boolean
  handleTriggerSync: () => Promise<void>
  isSyncRunning: boolean
  setShowSettings: (value: boolean) => void
  lang: WorkbenchLanguage
  syncState: SyncState
  handleCancelSync: () => Promise<void>
  runtimeBaseUrl: string
  dataRefreshToken: number
}) {
  return (['blackboard', 'tis'] as SustechModule[]).map((module) => {
    if (!input.visitedModules.has(module)) {
      return null
    }

    const isExiting = module === input.exitingModule
    const isActive = module === input.visibleModule && !isExiting
    const isVisible = module === input.visibleModule || isExiting

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
        {module === 'blackboard'
          ? renderBlackboardModule(input)
          : renderTisModule(input.isEnglish)}
      </div>
    )
  })
}

function renderBlackboardModule(input: {
  isEnglish: boolean
  handleTriggerSync: () => Promise<void>
  isSyncRunning: boolean
  setShowSettings: (value: boolean) => void
  lang: WorkbenchLanguage
  syncState: SyncState
  handleCancelSync: () => Promise<void>
  runtimeBaseUrl: string
  dataRefreshToken: number
}) {
  return (
    <>
      <header className="workspace-main__header">
        <div>
          <p className="workspace-main__eyebrow">{input.isEnglish ? 'Blackboard' : 'Blackboard'}</p>
          <h2 className="workspace-main__title">
            {input.isEnglish ? 'Blackboard Management' : 'Blackboard 管理系统'}
          </h2>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="icon-button" title={input.isEnglish ? 'Sync now' : '手动同步'} onClick={input.handleTriggerSync} disabled={input.isSyncRunning}>
            <span className="icon-button__label">↻</span>
          </button>
          <button type="button" className="icon-button" title={input.isEnglish ? 'Settings' : '设置'} onClick={() => input.setShowSettings(true)}>
            <Settings size={16} />
          </button>
        </div>
      </header>
      <section className={`workspace-main__content sustech-workspace__content${input.isSyncRunning ? ' sustech-workspace__content--syncing' : ''}`}>
        <div className={`sustech-sync-panel-slot${input.isSyncRunning ? ' sustech-sync-panel-slot--visible' : ''}`}>
          <BlackboardSyncPanel language={input.lang} syncState={input.syncState} onCancelSync={input.handleCancelSync} />
        </div>
        <div className={`sustech-data-browser-slot${input.isSyncRunning ? ' sustech-data-browser-slot--shifted' : ''}`}>
          <BlackboardDataBrowser language={input.lang} baseUrl={input.runtimeBaseUrl} refreshToken={input.dataRefreshToken} />
        </div>
      </section>
    </>
  )
}

function renderTisModule(isEnglish: boolean) {
  return (
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
  )
}

function renderSustechSyncSettingsDialog(input: {
  isEnglish: boolean
  syncState: SyncState
  handleSyncIntervalChange: (nextInterval: SyncState['syncInterval']) => Promise<void>
  onClose: () => void
}) {
  return (
    <div className="capabilities-dialog-backdrop" onClick={input.onClose}>
      <div className="capabilities-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <header className="capabilities-dialog__header">
          <div>
            <p className="capabilities-dialog__eyebrow">Blackboard</p>
            <h2 className="capabilities-dialog__title">{input.isEnglish ? 'Sync Settings' : '同步设置'}</h2>
            <p className="capabilities-dialog__description">
              {input.isEnglish ? 'Configure automatic background sync interval.' : '配置后台自动同步间隔。'}
            </p>
          </div>
          <button type="button" className="capabilities-dialog__close" onClick={input.onClose}>✕</button>
        </header>
        <div className="capabilities-dialog__body">
          <div className="settings-stack">
            <label className="form-field">
              <span className="form-field__label">{input.isEnglish ? 'Sync interval' : '同步间隔'}</span>
              <select className="text-input" value={input.syncState.syncInterval}
                onChange={(e) => { void input.handleSyncIntervalChange(e.target.value as SyncState['syncInterval']) }}>
                <option value="off">{input.isEnglish ? 'Off' : '关闭'}</option>
                <option value="two_hours">{input.isEnglish ? 'Every 2 hours' : '每两小时'}</option>
                <option value="daily">{input.isEnglish ? 'Daily' : '每天'}</option>
              </select>
            </label>
            {input.syncState.lastSyncAt && (
              <p className="form-field__description">{input.isEnglish ? 'Last sync: ' : '上次同步：'}{input.syncState.lastSyncAt}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
