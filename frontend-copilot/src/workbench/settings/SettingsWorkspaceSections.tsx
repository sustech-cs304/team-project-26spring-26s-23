import type { ComponentProps, ReactElement } from 'react'

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
import { ProviderProfilesSection, type ProviderProfilesSectionDomain } from './ProviderProfilesSection'
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
  'sustech-info': ({ sustech }) => <SustechInfoSection sustech={sustech} />,
  'model-service': ({ provider }) => <ProviderProfilesSection provider={provider} />,
  'default-model': ({ defaultModels }) => <DefaultModelRoutesSection defaultModels={defaultModels} />,
  general: ({ misc }) => <GeneralSettingsSection {...misc.general} />,
  display: ({ misc }) => <DisplaySettingsSection {...misc.display} />,
  data: ({ misc }) => <DataSettingsSection {...misc.data} />,
  mcp: ({ misc }) => <McpSettingsSection {...misc.mcp} />,
  search: ({ misc }) => <SearchSettingsSection {...misc.search} />,
  memory: ({ misc }) => <MemorySettingsSection {...misc.memory} />,
  api: ({ misc }) => <ApiSettingsSection {...misc.api} />,
  docs: ({ misc }) => <DocsSettingsSection {...misc.docs} />,
  'external-source': ({ externalSources }) => <ExternalSourcesSection externalSources={externalSources} />,
}

export function SettingsWorkspaceSections({ activeSection, ...sectionDomains }: SettingsWorkspaceSectionsProps) {
  return sectionRenderers[activeSection](sectionDomains)
}
