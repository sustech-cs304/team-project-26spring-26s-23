import { useEffect, useState, useMemo } from 'react'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import { getHubWorkspaceContent, type WorkbenchLanguage } from '../locale'
import type { HubWorkspaceView } from '../types'
import { TimelineView } from './components/TimelineView'
import { KanbanTracker } from './components/KanbanTracker'

interface UnifiedCalendarEvent {
  id: string | number
  source: string
  source_id: string | null
  title: string
  description: string | null
  start_time: string
  end_time: string
  is_all_day: boolean
  location: string | null
  status: string
}

function resolveRuntimeBaseUrl(state?: CopilotBootstrapController['state']): string {
  if (state && 'runtimeUrl' in state && state.runtimeUrl) {
    return state.runtimeUrl
  }
  return 'http://127.0.0.1:8765'
}

interface HubWorkspaceProps {
  view: HubWorkspaceView
  language?: WorkbenchLanguage
  bootstrap?: CopilotBootstrapController
}

export function HubWorkspace({ view, language = 'zh-CN', bootstrap }: HubWorkspaceProps) {
  const content = getHubWorkspaceContent(language, view)
  const runtimeBaseUrl = useMemo(() => resolveRuntimeBaseUrl(bootstrap?.state), [bootstrap?.state])
  const [events, setEvents] = useState<UnifiedCalendarEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchEvents() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetch(`${runtimeBaseUrl}/calendar/events`)
        if (!response.ok) {
          throw new Error('Failed to fetch events')
        }
        const data = await response.json()
        setEvents(data)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setIsLoading(false)
      }
    }
    fetchEvents()
  }, [runtimeBaseUrl])

  return (
    <section className="workspace-stage hub-workspace" aria-label={`${content.title}工作区`}>
      <aside className="workspace-panel hub-panel" aria-label={`${content.title}侧栏`}>
        <header className="panel-head">
          <p className="panel-head__eyebrow">{content.eyebrow}</p>
          <h1 className="panel-head__title">{content.panelTitle}</h1>
        </header>

        <ul className="hub-list">
          {content.entries.map((entry) => (
            <li key={entry.id}>
              <article className="hub-list__item">
                <h2 className="hub-list__title">{entry.title}</h2>
              </article>
            </li>
          ))}
        </ul>
      </aside>

      <main className="workspace-main" aria-label={`${content.title}主内容区`}>
        <header className="workspace-main__header">
          <div>
            <p className="workspace-main__eyebrow">{content.eyebrow}</p>
            <h2 className="workspace-main__title">{content.title}</h2>
          </div>
        </header>

        <section className="workspace-main__content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%', overflow: 'hidden' }}>
          {/* 顶部：时间轴 (Timeline / Roadmap) 视图 */}
          <TimelineView />

          {/* 底部：任务跟踪器 (Kanban) 视图 */}
          <KanbanTracker />

          {/* 暂时保留原本获取的数据用于 debug 和对照，用一个折叠面板包起来 */}
          <details style={{ marginTop: 'auto', border: '1px solid var(--vscode-widget-border)', borderRadius: '4px', padding: '0.5rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9em' }}>
              后端原始事件数据 Debug (Error: {error || 'None'})
            </summary>
            <div style={{ marginTop: '0.5rem', maxHeight: '150px', overflowY: 'auto', fontSize: '0.85em' }}>
              {isLoading ? (
                <p>Loading events...</p>
              ) : events.length === 0 ? (
                <p>No events found.</p>
              ) : (
                <ul style={{ paddingLeft: '1rem' }}>
                  {events.map((evt) => (
                    <li key={evt.id} style={{ marginBottom: '0.25rem' }}>
                      <strong>{evt.title}</strong>
                      <div style={{ color: 'var(--vscode-descriptionForeground)' }}>
                        {new Date(evt.start_time).toLocaleString()} - {evt.source.toUpperCase()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </section>
      </main>
    </section>
  )
}
