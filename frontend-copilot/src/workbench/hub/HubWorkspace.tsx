import { useEffect, useState, useMemo } from 'react'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import { getHubWorkspaceContent, type WorkbenchLanguage } from '../locale'
import type { HubWorkspaceView } from '../types'

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
          <section
            className="calendar-timeline-view"
            style={{
              flex: '1 1 50%',
              minHeight: '250px',
              backgroundColor: 'var(--vscode-editor-background)',
              borderRadius: '8px',
              border: '1px solid var(--vscode-widget-border)',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1em', fontWeight: 600 }}>时间轴 (Timeline)</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85em', color: 'var(--vscode-descriptionForeground)' }}>*静待接入甘特图/Timeline组件*</span>
              </div>
            </header>
            
            {/* 静态骨架区域 - Timeline 空壳 */}
            <div style={{ flex: 1, backgroundColor: 'var(--vscode-editorWidget-background)', borderRadius: '4px', border: '1px dashed var(--vscode-widget-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--vscode-descriptionForeground)' }}>
              Timeline Component Placeholder
            </div>
          </section>

          {/* 底部：任务跟踪器 (Kanban) 视图 */}
          <section
            className="calendar-kanban-view"
            style={{
              flex: '1 1 50%',
              minHeight: '300px',
              backgroundColor: 'var(--vscode-editor-background)',
              borderRadius: '8px',
              border: '1px solid var(--vscode-widget-border)',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1em', fontWeight: 600 }}>任务跟踪器</h3>
            </header>

            {/* 静态骨架区域 - Kanban 看板空壳 (分为未开始、进行中、已完成) */}
            <div style={{ flex: 1, display: 'flex', gap: '1rem', overflowX: 'auto' }}>
              {/* Kanban Column: 未开始 */}
              <div style={{ flex: 1, minWidth: '220px', backgroundColor: 'var(--vscode-editorWidget-background)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--vscode-list-warningForeground)' }}>●</span> 未开始
                </div>
                <div style={{ backgroundColor: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-widget-border)', borderRadius: '4px', padding: '0.5rem', fontSize: '0.85em' }}>
                  <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>四级考试</div>
                  <div style={{ color: 'var(--vscode-descriptionForeground)' }}>中优先级</div>
                </div>
                <button style={{ background: 'none', border: '1px dashed var(--vscode-widget-border)', color: 'var(--vscode-textLink-foreground)', borderRadius: '4px', padding: '0.25rem', cursor: 'pointer', marginTop: '0.5rem', textAlign: 'center' }}>+ 新建任务</button>
              </div>

              {/* Kanban Column: 进行中 */}
              <div style={{ flex: 1, minWidth: '220px', backgroundColor: 'var(--vscode-editorWidget-background)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--vscode-list-activeSelectionBackground)' }}>●</span> 进行中
                </div>
                <button style={{ background: 'none', border: '1px dashed var(--vscode-widget-border)', color: 'var(--vscode-textLink-foreground)', borderRadius: '4px', padding: '0.25rem', cursor: 'pointer', marginTop: '0.5rem', textAlign: 'center' }}>+ 新建任务</button>
              </div>

              {/* Kanban Column: 已完成 */}
              <div style={{ flex: 1, minWidth: '220px', backgroundColor: 'var(--vscode-editorWidget-background)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--vscode-testing-iconPassed)' }}>●</span> 已完成
                </div>
                <div style={{ backgroundColor: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-widget-border)', borderRadius: '4px', padding: '0.5rem', fontSize: '0.85em' }}>
                  <div style={{ fontWeight: 500, marginBottom: '0.25rem', textDecoration: 'line-through', color: 'var(--vscode-descriptionForeground)' }}>DSAA Lab.6</div>
                  <div style={{ color: 'var(--vscode-descriptionForeground)' }}>中优先级 • 课程作业</div>
                </div>
              </div>
            </div>
          </section>

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
