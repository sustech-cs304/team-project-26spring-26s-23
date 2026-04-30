import { useEffect, useRef, useState, type ComponentProps, type ReactElement } from 'react'

import type { SettingsSection } from '../types'
import { ApiSettingsSection } from './ApiSettingsSection'
import {
  DefaultModelRoutesSection,
  type DefaultModelRoutesSectionDomain,
} from './DefaultModelRoutesSection'
import {
  ExternalSourcesSection,
  type ExternalSourcesSectionDomain,
} from './ExternalSourcesSection'
import { McpSettingsSection } from './McpSettingsSection'
import {
  DisplaySettingsSection,
  DocsSettingsSection,
  GeneralSettingsSection,
} from './MiscSettingsSections'
import { ProviderProfilesSection } from './ProviderProfilesSection'
import { SearchSettingsSection } from './SearchSettingsSection'
import type { ProviderProfilesSectionDomain } from './ProviderProfilesSectionDomain'
import { SustechInfoSection, type SustechInfoSectionDomain } from './SustechInfoSection'

interface SettingsWorkspaceMiscSectionDomains {
  general: ComponentProps<typeof GeneralSettingsSection>
  display: ComponentProps<typeof DisplaySettingsSection>
  api: ComponentProps<typeof ApiSettingsSection>
  search: ComponentProps<typeof SearchSettingsSection>
  mcp: ComponentProps<typeof McpSettingsSection>
  docs: ComponentProps<typeof DocsSettingsSection>
}

interface SettingsWorkspaceSectionsProps {
  activeSection: SettingsSection
  provider: ProviderProfilesSectionDomain
  defaultModels: DefaultModelRoutesSectionDomain
  sustech: SustechInfoSectionDomain
  externalSources: ExternalSourcesSectionDomain
  misc: SettingsWorkspaceMiscSectionDomains
}

type SettingsWorkspaceSectionDomains = Omit<SettingsWorkspaceSectionsProps, 'activeSection'>

type SectionRenderer = (domains: SettingsWorkspaceSectionDomains) => ReactElement

const sectionRenderers: Record<SettingsSection, SectionRenderer> = {
  'sustech-info': ({ sustech, misc }) => <SustechInfoSection sustech={sustech} language={misc.general.language} />,
  'model-service': ({ provider, misc }) => <ProviderProfilesSection provider={provider} language={misc.general.language} />,
  'default-model': ({ defaultModels, misc }) => (
    <DefaultModelRoutesSection defaultModels={defaultModels} language={misc.general.language} />
  ),
  general: ({ misc }) => <GeneralSettingsSection {...misc.general} />,
  display: ({ misc }) => <DisplaySettingsSection {...misc.display} />,
  api: ({ misc }) => <ApiSettingsSection {...misc.api} language={misc.general.language} />,
  search: ({ misc }) => <SearchSettingsSection {...misc.search} language={misc.general.language} />,
  mcp: ({ misc }) => <McpSettingsSection {...misc.mcp} language={misc.general.language} />,
  docs: ({ misc }) => <DocsSettingsSection {...misc.docs} language={misc.general.language} />,
  'external-source': ({ externalSources, misc }) => (
    <ExternalSourcesSection externalSources={externalSources} language={misc.general.language} />
  ),
}

const SETTINGS_SECTION_FADE_OUT_MS = 110

export function SettingsWorkspaceSections({ activeSection, ...sectionDomains }: SettingsWorkspaceSectionsProps) {
  const [visitedSections, setVisitedSections] = useState<Set<SettingsSection>>(
    () => new Set<SettingsSection>([activeSection]),
  )
  const [visibleSection, setVisibleSection] = useState<SettingsSection>(activeSection)
  const [exitingSection, setExitingSection] = useState<SettingsSection | null>(null)
  const targetSectionRef = useRef<SettingsSection>(activeSection)
  const visibleSectionRef = useRef<SettingsSection>(activeSection)
  const sectionTransitionTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (sectionTransitionTimerRef.current !== null) {
        window.clearTimeout(sectionTransitionTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    targetSectionRef.current = activeSection
    setVisitedSections((prev) => {
      if (prev.has(activeSection)) {
        return prev
      }
      const next = new Set(prev)
      next.add(activeSection)
      return next
    })

    if (sectionTransitionTimerRef.current !== null) {
      window.clearTimeout(sectionTransitionTimerRef.current)
      sectionTransitionTimerRef.current = null
    }

    if (activeSection === visibleSectionRef.current) {
      setExitingSection(null)
      return
    }

    const sectionToFadeOut = visibleSectionRef.current
    setExitingSection(sectionToFadeOut)
    sectionTransitionTimerRef.current = window.setTimeout(() => {
      const sectionToFadeIn = targetSectionRef.current
      visibleSectionRef.current = sectionToFadeIn
      setVisibleSection(sectionToFadeIn)
      setExitingSection(null)
      sectionTransitionTimerRef.current = null
    }, SETTINGS_SECTION_FADE_OUT_MS)
  }, [activeSection])

  return (
    <>
      {(Object.keys(sectionRenderers) as SettingsSection[]).map((section) => {
        if (!visitedSections.has(section)) {
          return null
        }

        const renderer = sectionRenderers[section]
        const isExiting = section === exitingSection
        const isActive = section === visibleSection && !isExiting
        const isVisible = section === visibleSection || isExiting

        return (
          <div
            key={section}
            className={[
              'settings-section-keepalive-panel',
              isActive ? 'settings-section-keepalive-panel--active' : null,
              isExiting ? 'settings-section-keepalive-panel--exiting' : null,
            ].filter(Boolean).join(' ')}
            data-settings-section={section}
            hidden={!isVisible}
            aria-hidden={!isActive}
          >
            {renderer(sectionDomains)}
          </div>
        )
      })}
    </>
  )
}
