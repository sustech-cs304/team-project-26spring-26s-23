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

        <section className="workspace-main__content">
          <div className="hub-main-grid">
            <section className="hub-card hub-card--highlight">
              <h3 className="hub-card__title">{content.spotlightTitle}</h3>
              <div className="hub-chip-row">
                {content.highlights.map((highlight) => (
                  <span key={highlight} className="hub-chip">
                    {highlight}
                  </span>
                ))}
              </div>
            </section>

            {content.entries.map((entry) => (
              <section key={entry.id} className="hub-card">
                <h3 className="hub-card__title">{entry.title}</h3>
              </section>
            ))}

            {content.sections.map((section) => (
              <section key={section.id} className="hub-card">
                <h3 className="hub-card__title">{section.title}</h3>
              </section>
            ))}

            <section className="hub-card">
              <h3 className="hub-card__title">Upcoming Events</h3>
              {isLoading ? (
                <p>Loading events...</p>
              ) : error ? (
                <p style={{ color: 'red' }}>Error: {error}</p>
              ) : events.length === 0 ? (
                <p>No events found.</p>
              ) : (
                <ul style={{ paddingLeft: '1rem', marginTop: '1rem' }}>
                  {events.map((evt) => (
                    <li key={evt.id} style={{ marginBottom: '0.5rem' }}>
                      <strong>{evt.title}</strong>
                      <div style={{ fontSize: '0.85em', color: 'var(--vscode-descriptionForeground)' }}>
                        {new Date(evt.start_time).toLocaleString()} - {evt.source.toUpperCase()}
                        {evt.location && ` • ${evt.location}`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </section>
      </main>
    </section>
  )
}
