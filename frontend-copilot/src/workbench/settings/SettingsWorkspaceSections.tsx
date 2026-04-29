import { useEffect, useState, type ComponentProps, type ReactElement } from 'react'

import type { SettingsSection } from '../types'
import {
  DefaultModelRoutesSection,
  type DefaultModelRoutesSectionDomain,
} from './DefaultModelRoutesSection'
import {
  ExternalSourcesSection,
  type ExternalSourcesSectionDomain,
} from './ExternalSourcesSection'
import {
  ApiSettingsSection,
  DataSettingsSection,
  DisplaySettingsSection,
  DocsSettingsSection,
  GeneralSettingsSection,
  McpSettingsSection,
  MemorySettingsSection,
  SearchSettingsSection,
} from './MiscSettingsSections'
import { ProviderProfilesSection } from './ProviderProfilesSection'
import type { ProviderProfilesSectionDomain } from './ProviderProfilesSectionDomain'
import { SustechInfoSection, type SustechInfoSectionDomain } from './SustechInfoSection'

interface SettingsWorkspaceMiscSectionDomains {
  general: ComponentProps<typeof GeneralSettingsSection>
  display: ComponentProps<typeof DisplaySettingsSection>
  data: ComponentProps<typeof DataSettingsSection>
  mcp: ComponentProps<typeof McpSettingsSection>
  search: ComponentProps<typeof SearchSettingsSection>
  memory: ComponentProps<typeof MemorySettingsSection>
  api: ComponentProps<typeof ApiSettingsSection>
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
  data: ({ misc }) => <DataSettingsSection {...misc.data} language={misc.general.language} />,
  mcp: ({ misc }) => <McpSettingsSection {...misc.mcp} language={misc.general.language} />,
  search: ({ misc }) => <SearchSettingsSection {...misc.search} language={misc.general.language} />,
  memory: ({ misc }) => <MemorySettingsSection {...misc.memory} language={misc.general.language} />,
  api: ({ misc }) => <ApiSettingsSection {...misc.api} language={misc.general.language} />,
  docs: ({ misc }) => <DocsSettingsSection {...misc.docs} language={misc.general.language} />,
  'external-source': ({ externalSources, misc }) => (
    <ExternalSourcesSection externalSources={externalSources} language={misc.general.language} />
  ),
}

export function SettingsWorkspaceSections({ activeSection, ...sectionDomains }: SettingsWorkspaceSectionsProps) {
  const [visitedSections, setVisitedSections] = useState<Set<SettingsSection>>(
    () => new Set<SettingsSection>([activeSection]),
  )

  useEffect(() => {
    setVisitedSections((prev) => {
      if (prev.has(activeSection)) {
        return prev
      }
      const next = new Set(prev)
      next.add(activeSection)
      return next
    })
  }, [activeSection])

  return (
    <>
      {(Object.keys(sectionRenderers) as SettingsSection[]).map((section) => {
        if (!visitedSections.has(section)) {
          return null
        }

        const renderer = sectionRenderers[section]
        const isActive = section === activeSection

        return (
          <div
            key={section}
            className="settings-section-keepalive-panel"
            hidden={!isActive}
            aria-hidden={!isActive}
          >
            {renderer(sectionDomains)}
          </div>
        )
      })}
    </>
  )
}
