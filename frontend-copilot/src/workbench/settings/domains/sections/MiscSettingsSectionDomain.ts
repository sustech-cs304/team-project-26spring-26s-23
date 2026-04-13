import { createApiSettingsSectionDomains, type ApiSettingsSectionDomains } from './ApiSettingsSectionDomain'
import { createDataSettingsSectionDomains, type DataSettingsSectionDomains } from './DataSettingsSectionDomain'
import {
  createDisplaySettingsSectionDomains,
  type DisplaySettingsSectionDomains,
} from './DisplaySettingsSectionDomain'
import { createDocsSettingsSectionDomains, type DocsSettingsSectionDomains } from './DocsSettingsSectionDomain'

export type MiscSettingsSectionDomains =
  & DisplaySettingsSectionDomains
  & DataSettingsSectionDomains
  & ApiSettingsSectionDomains
  & DocsSettingsSectionDomains

export function createMiscSettingsSectionDomains(
  domains: MiscSettingsSectionDomains,
): MiscSettingsSectionDomains {
  return {
    ...createDisplaySettingsSectionDomains(domains.display),
    ...createDataSettingsSectionDomains(domains.data),
    ...createApiSettingsSectionDomains(domains.api),
    ...createDocsSettingsSectionDomains(domains.docs),
  }
}
