import type { ComponentProps } from 'react'

import { DataSettingsSection } from '../../DataSettingsSection'

export interface DataSettingsSectionDomains {
  data: ComponentProps<typeof DataSettingsSection>
}

export function createDataSettingsSectionDomains(
  data: ComponentProps<typeof DataSettingsSection>,
): DataSettingsSectionDomains {
  return {
    data: {
      ...data,
    },
  }
}
