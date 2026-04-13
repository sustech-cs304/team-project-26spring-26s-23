import type { ComponentProps } from 'react'

import { DisplaySettingsSection } from '../../DisplaySettingsSection'

export interface DisplaySettingsSectionDomains {
  display: ComponentProps<typeof DisplaySettingsSection>
}

export function createDisplaySettingsSectionDomains(
  display: ComponentProps<typeof DisplaySettingsSection>,
): DisplaySettingsSectionDomains {
  return {
    display: {
      ...display,
    },
  }
}
