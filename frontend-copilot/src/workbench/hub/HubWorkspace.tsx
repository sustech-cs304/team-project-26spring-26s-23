import { useCallback, useEffect, useState } from 'react'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import { getHubWorkspaceContent, type WorkbenchLanguage } from '../locale'
import type { HubWorkspaceView } from '../types'
import { CalendarGanttView } from './components/CalendarGanttView'
import { KanbanTracker } from './components/KanbanTracker'
import type { CalendarEventPatch, UnifiedCalendarEvent } from './calendar-types'
import { mergeCalendarEventPatch } from './calendar-gantt-model'

interface HubWorkspaceProps {
  view: HubWorkspaceView
  language?: WorkbenchLanguage
  bootstrap?: CopilotBootstrapController
}

export function HubWorkspace({ view, language = 'zh-CN', bootstrap }: HubWorkspaceProps) {
  const content = getHubWorkspaceContent(language, view)
  const [events, setEvents] = useState<UnifiedCalendarEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let actualRuntimeUrl = 'http://127.0.0.1:8765'
    if (bootstrap) {
      if (bootstrap.state.status === 'ready' || bootstrap.state.status === 'degraded') {
        actualRuntimeUrl = bootstrap.state.runtimeUrl
      } else {
        return
      }
    }

    async function fetchEvents() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetch(`${actualRuntimeUrl}/calendar/events`)
        if (!response.ok) {
          const errText = await response.text().catch(() => 'No text')
          throw new Error(`Failed to fetch events: ${response.status} ${response.statusText} ${errText}`)
        }
        const data = await response.json()
        setEvents(data.items || [])
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsLoading(false)
      }
    }
    fetchEvents()
  }, [bootstrap])

  const handleCalendarEventChange = useCallback((eventId: string | number, patch: CalendarEventPatch) => {
    setEvents((currentEvents) => mergeCalendarEventPatch(currentEvents, eventId, patch))
  }, [])

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

        <section className="workspace-main__content calendar-workspace-content" style={{ display: 'flex', flexDirection: 'column' }}>
          <CalendarGanttView events={events} onEventChange={handleCalendarEventChange} />

          <KanbanTracker events={events} />

          <CalendarDebugPanel events={events} error={error} isLoading={isLoading} />
        </section>
      </main>
    </section>
  )
}

function CalendarDebugPanel({ events, error, isLoading }: {
  events: UnifiedCalendarEvent[]
  error: string | null
  isLoading: boolean
}) {
  return (
    <details className="calendar-debug-panel">
      <summary className="calendar-debug-panel__summary">
        后端原始事件数据 Debug (Error: {error || 'None'})
      </summary>
      <div className="calendar-debug-panel__body">
        {isLoading ? (
          <p>Loading events...</p>
        ) : events.length === 0 ? (
          <p>No events found.</p>
        ) : (
          <ul>
            {events.map((event) => (
              <li key={event.id}>
                <strong>{event.title}</strong>
                <div>
                  {new Date(event.start_time).toLocaleString()} - {event.source.toUpperCase()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
