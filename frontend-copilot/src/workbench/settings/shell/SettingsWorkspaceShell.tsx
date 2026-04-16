import { useMemo, useState } from 'react'

import type { CopilotBootstrapController } from '../../../features/copilot/types'
import {
  getSettingsSectionLabel,
  getSettingsShellCopy,
} from '../../locale'
import { settingsItems } from '../../config'
import type { SettingsSection, ThemeMode } from '../../types'
import { useSettingsWorkspaceSectionsDomain } from '../domains/SettingsWorkspaceSectionsDomain'
import { SettingsWorkspaceSections } from '../SettingsWorkspaceSections'

export interface SettingsWorkspaceShellProps {
  bootstrap: CopilotBootstrapController
  themeMode: ThemeMode
  onThemeModeChange: (value: ThemeMode) => void
  onLanguageChange?: (value: string) => void
  initialSection?: SettingsSection
}

export function SettingsWorkspaceShell({
  bootstrap,
  themeMode,
  onThemeModeChange,
  onLanguageChange,
  initialSection,
}: SettingsWorkspaceShellProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? settingsItems[0]?.id ?? 'sustech-info')
  const sectionDomains = useSettingsWorkspaceSectionsDomain({
    bootstrap,
    themeMode,
    onThemeModeChange,
    onLanguageChange,
  })
  const currentLanguage = sectionDomains.misc.general.language
  const shellCopy = useMemo(() => getSettingsShellCopy(currentLanguage), [currentLanguage])

  const activeSettingsItem = useMemo(
    () => settingsItems.find((item) => item.id === activeSection) ?? settingsItems[0],
    [activeSection],
  )

  return (
    <section className="workspace-stage settings-workspace" aria-label={shellCopy.workspaceAriaLabel}>
      <aside className="workspace-panel settings-panel" aria-label={shellCopy.navAriaLabel}>
        <header className="panel-head">
          <p className="panel-head__eyebrow">{shellCopy.eyebrow}</p>
          <h1 className="panel-head__title">{shellCopy.title}</h1>
        </header>

        <ul className="settings-nav-list">
          {settingsItems.map((item) => {
            const Icon = item.icon
            const active = item.id === activeSection

            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`settings-nav-item${active ? ' settings-nav-item--active' : ''}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <Icon size={16} className="settings-nav-item__icon" />
                  <span className="settings-nav-item__body">
                    <span className="settings-nav-item__title">{getSettingsSectionLabel(currentLanguage, item.id)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <main className="workspace-main" aria-label={shellCopy.mainAriaLabel}>
        <header className="workspace-main__header">
          <h2 className="workspace-main__title">{getSettingsSectionLabel(currentLanguage, activeSettingsItem.id)}</h2>
        </header>

        <section className="workspace-main__content workspace-main__content--flush workspace-main__content--settings">
          <SettingsWorkspaceSections
            activeSection={activeSection}
            {...sectionDomains}
          />
        </section>
      </main>
    </section>
  )
}
