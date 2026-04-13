import { getHubWorkspaceContent, type WorkbenchLanguage } from '../locale'
import type { HubWorkspaceView } from '../types'

interface HubWorkspaceProps {
  view: HubWorkspaceView
  language?: WorkbenchLanguage
}

export function HubWorkspace({ view, language = 'zh-CN' }: HubWorkspaceProps) {
  const content = getHubWorkspaceContent(language, view)

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
          </div>
        </section>
      </main>
    </section>
  )
}
