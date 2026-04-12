import type { ComponentProps } from 'react'

import { GeneralSettingsSection } from '../../GeneralSettingsSection'

export interface GeneralSettingsSectionDomains {
  general: ComponentProps<typeof GeneralSettingsSection>
}

export function createGeneralSettingsSectionDomains(
  general: ComponentProps<typeof GeneralSettingsSection>,
): GeneralSettingsSectionDomains {
  return {
    general: {
      ...general,
    },
  }
}
