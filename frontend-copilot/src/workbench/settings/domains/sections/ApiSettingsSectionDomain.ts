import type { ComponentProps } from 'react'

import { ApiSettingsSection } from '../../ApiSettingsSection'

export interface ApiSettingsSectionDomains {
  api: ComponentProps<typeof ApiSettingsSection>
}

export function createApiSettingsSectionDomains(
  api: ComponentProps<typeof ApiSettingsSection>,
): ApiSettingsSectionDomains {
  return {
    api: {
      ...api,
    },
  }
}
