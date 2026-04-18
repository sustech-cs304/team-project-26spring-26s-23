import type { ComponentProps } from 'react'

import { DocsSettingsSection } from '../../DocsSettingsSection'

export interface DocsSettingsSectionDomains {
  docs: ComponentProps<typeof DocsSettingsSection>
}

export function createDocsSettingsSectionDomains(
  docs: ComponentProps<typeof DocsSettingsSection>,
): DocsSettingsSectionDomains {
  return {
    docs: {
      ...docs,
    },
  }
}
