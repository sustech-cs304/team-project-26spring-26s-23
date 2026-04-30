import {
  createDisplaySettingsSectionDomains,
  type DisplaySettingsSectionDomains,
} from './DisplaySettingsSectionDomain'
import { createDocsSettingsSectionDomains, type DocsSettingsSectionDomains } from './DocsSettingsSectionDomain'

export type MiscSettingsSectionDomains =
  & DisplaySettingsSectionDomains
  & DocsSettingsSectionDomains

export function createMiscSettingsSectionDomains(
  domains: MiscSettingsSectionDomains,
): MiscSettingsSectionDomains {
  return {
    ...createDisplaySettingsSectionDomains(domains.display),
    ...createDocsSettingsSectionDomains(domains.docs),
  }
}
