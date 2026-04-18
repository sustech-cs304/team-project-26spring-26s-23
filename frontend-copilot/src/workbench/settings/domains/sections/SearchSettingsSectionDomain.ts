import type { ComponentProps } from 'react'

import { SearchSettingsSection } from '../../SearchSettingsSection'

export interface SearchSettingsSectionDomains {
  search: ComponentProps<typeof SearchSettingsSection>
}

export function createSearchSettingsSectionDomains(
  search: ComponentProps<typeof SearchSettingsSection>,
): SearchSettingsSectionDomains {
  return {
    search: {
      ...search,
    },
  }
}
