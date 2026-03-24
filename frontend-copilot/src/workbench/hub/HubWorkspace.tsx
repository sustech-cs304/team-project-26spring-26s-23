import { hubWorkspaceContent } from '../config'
import type { HubWorkspaceView } from '../types'

interface HubWorkspaceProps {
  view: HubWorkspaceView
}

export function HubWorkspace({ view }: HubWorkspaceProps) {
  const content = hubWorkspaceContent[view]

  return (
    <section className="workspace-stage hub-workspace" aria-label={`${content.title}工作区`}>
      <aside className="workspace-panel hub-panel" aria-label={`${content.title}侧栏`}>
        <header className="panel-head">
          <p className="panel-head__eyebrow">{content.eyebrow}</p>
          <h1 className="panel-head__title">{content.panelTitle}</h1>
          <p className="panel-head__subtitle">{content.panelSubtitle}</p>
        </header>

        <ul className="hub-list">
          {content.entries.map((entry) => (
            <li key={entry.id}>
              <article className="hub-list__item">
                <h2 className="hub-list__title">{entry.title}</h2>
                <p className="hub-list__description">{entry.description}</p>
                <p className="hub-list__meta">{entry.meta}</p>
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
            <p className="workspace-main__subtitle">{content.subtitle}</p>
          </div>
          <span className="workspace-badge">占位工作区</span>
        </header>

        <section className="workspace-main__content">
          <div className="hub-main-grid">
            <section className="hub-card hub-card--highlight">
              <p className="hub-card__eyebrow">工作区定位</p>
              <h3 className="hub-card__title">{content.spotlightTitle}</h3>
              <p className="hub-card__description">{content.spotlightDescription}</p>
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
                <p className="hub-card__eyebrow">模块占位</p>
                <h3 className="hub-card__title">{entry.title}</h3>
                <p className="hub-card__description">{entry.description}</p>
                <p className="hub-card__meta">{entry.meta}</p>
              </section>
            ))}
          </div>
        </section>
      </main>
    </section>
  )
}
