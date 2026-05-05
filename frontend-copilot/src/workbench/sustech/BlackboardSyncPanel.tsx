import { Ban, ChevronDown, ChevronUp, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WorkbenchLanguage } from '../_locale/types'

type SyncStatus = 'idle' | 'running' | 'completed' | 'failed'

interface SyncState {
  status: SyncStatus
  lastSyncAt: string | null
  nextSyncAt: string | null
  lastSyncError: string | null
  syncInterval: string
  progressMessage: string | null
  progressStage: string | null
  progressLogs?: string[]
  canCancel?: boolean
  timeoutSeconds?: number | null
}

const STAGES = [
  { key: 'authenticating', labelZh: '认证', labelEn: 'Auth' },
  { key: 'fetching_courses', labelZh: '课程列表', labelEn: 'Courses' },
  { key: 'fetching_details', labelZh: '课程详情', labelEn: 'Details' },
  { key: 'syncing_db', labelZh: '落库', labelEn: 'Sync DB' },
  { key: 'verifying', labelZh: '校验', labelEn: 'Verify' },
]

interface BlackboardSyncPanelProps {
  language: WorkbenchLanguage
  syncState: SyncState
  onCancelSync?: (() => void) | null
}

export function BlackboardSyncPanel({ language, syncState, onCancelSync = null }: BlackboardSyncPanelProps) {
  const isEnglish = language === 'en-US'
  const { status, progressMessage, progressStage } = syncState
  const progressLogs = Array.isArray(syncState.progressLogs) ? syncState.progressLogs : []
  const isRunning = status === 'running'
  const canCancel = syncState.canCancel !== false
  const [logOpen, setLogOpen] = useState(status === 'running')

  useEffect(() => {
    if (status === 'running' && progressLogs.length > 0) {
      setLogOpen(true)
      return
    }
    if (status !== 'running') {
      setLogOpen(false)
    }
  }, [status, progressLogs.length])

  if (!isRunning) {
    return null
  }

  return (
    <div className="settings-card">
      <div className="settings-card__header settings-card__header--spaced">
        <h3 className="settings-card__title">
          {isEnglish ? 'Sync Status' : '同步状态'}
        </h3>
        <div className="sustech-sync-panel__actions">
          {onCancelSync && (
            <button
              type="button"
              className="sustech-sync-cancel-button"
              onClick={onCancelSync}
              disabled={!canCancel}
              aria-label={isEnglish ? 'Cancel sync' : '取消同步'}
            >
              <Ban size={14} />
              <span>{isEnglish ? 'Cancel' : '取消'}</span>
            </button>
          )}
          <SyncStatusBadge isEnglish={isEnglish} />
        </div>
      </div>

      <div className="settings-stack settings-stack--compact">
        <div className="sustech-progress-box">
            <div className="sustech-progress-bar">
              <div className="sustech-progress-bar__fill--active" />
            </div>
            <div className="sustech-progress-stages">
              {STAGES.map((stage) => {
                const stageIdx = STAGES.findIndex((s) => s.key === stage.key)
                const activeIdx = progressStage ? STAGES.findIndex((s) => s.key === progressStage) : -1
                const isActive = progressStage === stage.key
                const isDone = activeIdx >= 0 && stageIdx < activeIdx
                return (
                  <span
                    key={stage.key}
                    className={`sustech-progress-stage${
                      isActive ? ' sustech-progress-stage--active' : ''
                    }${isDone ? ' sustech-progress-stage--done' : ''}`}
                  >
                    {isEnglish ? stage.labelEn : stage.labelZh}
                  </span>
                )
              })}
            </div>
            {progressMessage && (
              <div className="sustech-progress-msg">
                <LoaderCircle size={12} className="sustech-sync-spin" />
                <span>{progressMessage}</span>
              </div>
            )}
            <button type="button" className="sustech-log-toggle" onClick={() => setLogOpen(!logOpen)}>
              {isEnglish ? 'Log details' : '日志详情'}
              {logOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {logOpen && (
              <div className="sustech-log-drawer">
                {progressLogs.length > 0 ? (
                  <ol className="sustech-log-list">
                    {progressLogs.map((entry, index) => (
                      <li key={`${index}-${entry}`}>{entry}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="sustech-empty-hint">
                    {isEnglish ? 'Waiting for backend progress logs…' : '等待后端进度日志…'}
                  </p>
                )}
              </div>
            )}
          </div>
      </div>
    </div>
  )
}

function SyncStatusBadge({ isEnglish }: { isEnglish: boolean }) {
  return (
    <span className="sustech-pill sustech-pill--running">
      <LoaderCircle size={14} className="sustech-sync-spin" />
      {isEnglish ? 'Syncing…' : '同步中…'}
    </span>
  )
}
